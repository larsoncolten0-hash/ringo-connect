-- WhatsApp Smart Card sales bot: conversation state, reply idempotency, human hand-off, order link — PROPOSED, NOT APPLIED. FOR OWNER REVIEW ONLY.
--
-- Purely additive: TWO new tables and FOUR new server-side functions. No existing table, column, index, constraint, trigger, policy or function is created,
-- altered or dropped, and no row is touched when this file is applied. The bot reuses the existing Inbox for ALL message storage (inbox_messages, inbox_contacts,
-- inbox_conversations): nothing here stores a message.
--
--   NEW TABLE  wa_sales_sessions   one row per Inbox conversation the bot has talked in: the deterministic state, the answers collected so far (small jsonb),
--                                  the human hand-off switch, the link to the signup request the order created, and a version number for safe concurrent updates.
--   NEW TABLE  wa_sales_processed  one row per inbound provider message id the bot has claimed. The primary key IS the idempotency: a message is processed once.
--       Both: row level security ON, no policy, no grant for anon / authenticated / service_role. Only the SECURITY DEFINER functions below touch them.
--   NEW FUNCTIONS (SECURITY DEFINER, search_path = public, pg_temp, EXECUTE for service_role only):
--       wa_sales_begin(phone_number_id, provider_message_id)    called by the webhook AFTER a NEW inbound message was stored: derives the owner / conversation /
--                                                               sender from the database, claims the message id exactly once, returns the state and the text.
--       wa_sales_save(...)                                      compare-and-set update of the state (expected version); the bot can switch hand-off ON but never OFF.
--       wa_sales_set_handoff(actor, conversation, on_off)       the OWNER switches hand-off on or off (off restarts the flow at the welcome message).
--       wa_sales_payment_context(signup_request_id)             called by the payment-confirmed hook: who to tell, in which language; marks the flow completed.
--
-- WHAT THIS DOES NOT DO: it never decides whether anything was paid, never calculates a price, never creates an order itself (the Next.js code calls the existing signup
-- and payment endpoints), never reads or stores more than the message text it is handed, and accepts no owner, profile, phone number id or recipient from the caller.
--
-- Depends on: 2026-12-07_whatsapp_inbox_foundation.sql (wa_accounts, inbox_conversations, inbox_messages, inbox_contacts), profiles.
-- Rollback: supabase/support/2026-12-19_whatsapp_sales_bot.rollback.sql (drops the four functions and the two tables; the Inbox itself is untouched).

begin;

create table if not exists public.wa_sales_sessions (
  conversation_id uuid primary key,
  profile_id uuid not null,
  state text not null default 'WELCOME' check (state in ('WELCOME', 'CARDS', 'COMPARE', 'CARD_DETAIL', 'HOW_IT_WORKS', 'FAQ', 'RECOMMEND_1', 'RECOMMEND_2', 'ASK_NAME', 'ASK_ADDRESS', 'ASK_USERNAME', 'ASK_OPERATOR', 'ASK_PAY_PHONE', 'REVIEW', 'EDIT_MENU', 'CREATING', 'PAYMENT', 'COMPLETED', 'HUMAN_HANDOFF')),
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 4096),
  handoff boolean not null default false,
  signup_request_id uuid,
  version integer not null default 0 check (version >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (profile_id, conversation_id) references public.inbox_conversations (profile_id, id) on delete cascade
);
create unique index if not exists wa_sales_sessions_signup_idx on public.wa_sales_sessions (signup_request_id) where signup_request_id is not null;
create index if not exists wa_sales_sessions_profile_idx on public.wa_sales_sessions (profile_id);

create table if not exists public.wa_sales_processed (
  provider_message_id text primary key check (char_length(provider_message_id) between 1 and 256),
  conversation_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (conversation_id) references public.wa_sales_sessions (conversation_id) on delete cascade
);

-- ============================================================================
-- 1. A NEW INBOUND MESSAGE WAS STORED: claim it once and hand back the state.
--    Returns jsonb { result: 'skip' } (unknown or disabled account, unknown or outbound message, no owner),
--                  { result: 'duplicate' } (this provider message id was already claimed),
--                  { result: 'ok', conversation_id, owner_user_id, wa_id, type, text, age_seconds, session: { state, data, handoff, signup_request_id, version } }.
--    The sender (wa_id) is the contact Meta verified for this conversation; the owner is wa_accounts -> profiles.user_id. Nothing comes from the caller but two lookup keys.
-- ============================================================================
create or replace function public.wa_sales_begin(p_phone_number_id text, p_provider_message_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_acct public.wa_accounts%rowtype;
  v_msg public.inbox_messages%rowtype;
  v_cv public.inbox_conversations%rowtype;
  v_s public.wa_sales_sessions%rowtype;
  v_owner uuid;
  v_wa text;
  v_claimed text;
begin
  if p_phone_number_id is null or p_provider_message_id is null then return jsonb_build_object('result', 'skip'); end if;

  select * into v_acct from public.wa_accounts a where a.phone_number_id = p_phone_number_id;
  if not found or v_acct.status <> 'active' then return jsonb_build_object('result', 'skip'); end if;

  select * into v_msg from public.inbox_messages m
   where m.profile_id = v_acct.profile_id and m.provider_message_id = p_provider_message_id and m.direction = 'inbound';
  if not found then return jsonb_build_object('result', 'skip'); end if;

  select * into v_cv from public.inbox_conversations cv where cv.id = v_msg.conversation_id and cv.profile_id = v_acct.profile_id;
  if not found then return jsonb_build_object('result', 'skip'); end if;

  select p.user_id into v_owner from public.profiles p where p.id = v_acct.profile_id;
  if v_owner is null then return jsonb_build_object('result', 'skip'); end if;

  select c.external_id into v_wa from public.inbox_contacts c where c.id = v_cv.contact_id and c.profile_id = v_cv.profile_id;
  if v_wa is null then return jsonb_build_object('result', 'skip'); end if;

  insert into public.wa_sales_sessions (conversation_id, profile_id) values (v_cv.id, v_cv.profile_id) on conflict (conversation_id) do nothing;

  insert into public.wa_sales_processed (provider_message_id, conversation_id) values (p_provider_message_id, v_cv.id)
  on conflict (provider_message_id) do nothing returning provider_message_id into v_claimed;
  if v_claimed is null then return jsonb_build_object('result', 'duplicate'); end if;

  select * into v_s from public.wa_sales_sessions s where s.conversation_id = v_cv.id;
  return jsonb_build_object(
    'result', 'ok', 'conversation_id', v_cv.id, 'owner_user_id', v_owner, 'wa_id', v_wa, 'type', v_msg.type,
    'text', left(coalesce(v_msg.body, ''), 1000),
    'age_seconds', greatest(0, extract(epoch from (now() - v_s.updated_at)))::int,
    'session', jsonb_build_object('state', v_s.state, 'data', v_s.data, 'handoff', v_s.handoff, 'signup_request_id', v_s.signup_request_id, 'version', v_s.version));
end;
$$;

-- ============================================================================
-- 2. SAVE the new state (compare-and-set on the version).   Returns text: 'ok' | 'conflict' | 'not_found' | 'invalid'
--    The bot may switch hand-off ON; only wa_sales_set_handoff (the owner) can switch it OFF. A signup request id, once set, is only replaced by another id.
-- ============================================================================
create or replace function public.wa_sales_save(p_conversation_id uuid, p_expected_version integer, p_state text, p_data jsonb, p_handoff boolean, p_signup_request_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  if p_conversation_id is null or p_expected_version is null or p_state is null or p_data is null or p_handoff is null then return 'invalid'; end if;
  if jsonb_typeof(p_data) <> 'object' or pg_column_size(p_data) > 4096 then return 'invalid'; end if;
  if p_state not in ('WELCOME', 'CARDS', 'COMPARE', 'CARD_DETAIL', 'HOW_IT_WORKS', 'FAQ', 'RECOMMEND_1', 'RECOMMEND_2', 'ASK_NAME', 'ASK_ADDRESS', 'ASK_USERNAME', 'ASK_OPERATOR', 'ASK_PAY_PHONE', 'REVIEW', 'EDIT_MENU', 'CREATING', 'PAYMENT', 'COMPLETED', 'HUMAN_HANDOFF') then return 'invalid'; end if;

  update public.wa_sales_sessions s
     set state = case when s.handoff or p_handoff then 'HUMAN_HANDOFF' else p_state end,
         data = p_data,
         handoff = s.handoff or p_handoff,
         signup_request_id = coalesce(p_signup_request_id, s.signup_request_id),
         version = s.version + 1,
         updated_at = now()
   where s.conversation_id = p_conversation_id and s.version = p_expected_version;
  get diagnostics v_n = row_count;
  if v_n = 1 then return 'ok'; end if;

  perform 1 from public.wa_sales_sessions s where s.conversation_id = p_conversation_id;
  return case when found then 'conflict' else 'not_found' end;
end;
$$;

-- ============================================================================
-- 3. THE OWNER switches human hand-off on or off.   Returns text: 'ok' | 'noop' (resume on a conversation that is not in hand-off) | 'not_found' | 'invalid'
--    Ownership is re-derived (conversation -> profile -> profiles.user_id = actor); another owner's conversation is indistinguishable from a missing one.
--    Off restarts the flow at the welcome message (the language is kept), and only for a conversation that is in hand-off. On makes sure a session row exists and silences the bot.
-- ============================================================================
create or replace function public.wa_sales_set_handoff(p_actor_user_id uuid, p_conversation_id uuid, p_on boolean)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cv public.inbox_conversations%rowtype;
  v_n integer;
begin
  if p_actor_user_id is null or p_conversation_id is null or p_on is null then return 'invalid'; end if;
  select cv.* into v_cv from public.inbox_conversations cv join public.profiles p on p.id = cv.profile_id
   where cv.id = p_conversation_id and p.user_id = p_actor_user_id;
  if not found then return 'not_found'; end if;

  if p_on then
    insert into public.wa_sales_sessions (conversation_id, profile_id) values (v_cv.id, v_cv.profile_id) on conflict (conversation_id) do nothing;
    update public.wa_sales_sessions s set handoff = true, state = 'HUMAN_HANDOFF', version = s.version + 1, updated_at = now() where s.conversation_id = v_cv.id;
    return 'ok';
  end if;
  -- Resume: ONLY a conversation that is in hand-off is touched. A conversation with no session, or one the bot is still handling, is left exactly as it is ('noop').
  update public.wa_sales_sessions s
     set handoff = false, state = 'WELCOME', version = s.version + 1, updated_at = now(),
         data = case when s.data ? 'lang' then jsonb_build_object('lang', s.data -> 'lang') else '{}'::jsonb end
   where s.conversation_id = v_cv.id and s.handoff;
  get diagnostics v_n = row_count;
  return case when v_n = 1 then 'ok' else 'noop' end;
end;
$$;

-- ============================================================================
-- 4. THE PAYMENT SYSTEM recorded a payment for a signup request: who should the WhatsApp confirmation go to?
--    Returns jsonb { result: 'none' } (this request did not come from the bot) or { result: 'ok', conversation_id, owner_user_id, lang, tier, handoff }.
--    It only reads the link the bot stored and marks the flow completed; whether the payment succeeded was decided by the existing payment code, not here.
-- ============================================================================
create or replace function public.wa_sales_payment_context(p_signup_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_s public.wa_sales_sessions%rowtype;
  v_owner uuid;
begin
  if p_signup_request_id is null then return jsonb_build_object('result', 'none'); end if;
  select * into v_s from public.wa_sales_sessions s where s.signup_request_id = p_signup_request_id;
  if not found then return jsonb_build_object('result', 'none'); end if;
  select p.user_id into v_owner from public.profiles p where p.id = v_s.profile_id;
  if v_owner is null then return jsonb_build_object('result', 'none'); end if;

  if not v_s.handoff and v_s.state in ('PAYMENT', 'CREATING') then
    update public.wa_sales_sessions s set state = 'COMPLETED', version = s.version + 1, updated_at = now() where s.conversation_id = v_s.conversation_id;
  end if;
  return jsonb_build_object('result', 'ok', 'conversation_id', v_s.conversation_id, 'owner_user_id', v_owner,
                            'lang', case when v_s.data ->> 'lang' = 'fr' then 'fr' else 'en' end, 'tier', v_s.data ->> 'tier', 'handoff', v_s.handoff);
end;
$$;

do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('wa_sales_begin', 'wa_sales_save', 'wa_sales_set_handoff', 'wa_sales_payment_context')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;

alter table public.wa_sales_sessions enable row level security;
alter table public.wa_sales_processed enable row level security;
revoke all on public.wa_sales_sessions, public.wa_sales_processed from anon, authenticated, service_role;

commit;
