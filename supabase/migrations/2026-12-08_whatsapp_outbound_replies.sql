-- WhatsApp human replies (Phase 7) — PROPOSED, NOT APPLIED. FOR OWNER REVIEW ONLY.
--
-- Three NEW server-side functions and nothing else. NO new table, column, index, constraint, trigger or policy; no existing object is
-- modified. The Phase 4 schema already models outbound messages (direction, status 'queued', provider_message_id nullable until Meta
-- accepts, sent_by_user_id, client_request_id with UNIQUE (profile_id, client_request_id), conversations.last_outbound_at). What is
-- missing is a WRITE PATH: service_role has SELECT only on those tables (Phase 4 decision), so the server cannot insert an outbound row.
-- These functions are that path, granted to service_role only, exactly like the two ingestion functions.
--
--   inbox_prepare_outbound_text(actor, conversation, client_request_id, body)
--       Before calling Meta. Creates ONE 'queued' outbound row (idempotent on client_request_id) and returns the recipient and the
--       business phone_number_id, both read from the database. Never accepts a recipient, phone number id, WABA id or profile id.
--   inbox_complete_outbound(actor, message, provider_message_id)
--       After Meta ACCEPTED the message: stores the wamid, attaches any status events that arrived first, sets the current status
--       ('sent' or higher by the Phase 4 ranking), and updates the conversation (last_outbound_at, last_message_at, reopens).
--   inbox_fail_outbound(actor, message, error_codes)
--       After Meta definitively REJECTED the message: marks it 'failed' with numeric provider codes. Only while it has no wamid.
--
-- AUTHORIZATION: the caller (the authenticated Next.js route) passes the signed-in user id as p_actor_user_id. Every function re-derives
-- the owner inside the database (conversation/message -> profile -> profiles.user_id = actor) and returns 'not_found' otherwise, so even a
-- bug in the route could not send into, or read, another profile's conversation. A guessed id is indistinguishable from a missing one.
--
-- IDEMPOTENCY: UNIQUE (profile_id, client_request_id) decides. A replay with the same key returns the ORIGINAL row (never a second
-- message); the same key with a different conversation or body is 'conflict'. Meta has no idempotency key, so one window cannot be closed
-- by the database: if the process dies (or the response is lost) AFTER Meta accepted but BEFORE inbox_complete_outbound, the row stays
-- 'queued' with no wamid. The application never re-sends such a row automatically; it is shown as "not confirmed". See the report.
--
-- 24-HOUR WINDOW: free-form text is only allowed within 24h of the customer's last message. prepare refuses earlier ('window_closed')
-- instead of creating a row Meta would reject.
--
-- Depends on: 2026-12-07_whatsapp_inbox_foundation.sql (tables, inbox_status_rank, guards), profiles.
-- Rollback: supabase/support/2026-12-08_whatsapp_outbound_replies.rollback.sql (drops only these three functions; stored messages stay).

begin;

-- ============================================================================
-- 1. PREPARE: one queued row per client_request_id
--    Returns jsonb: { result: 'created' | 'existing' | 'not_found' | 'invalid' | 'conflict' | 'account_disabled' | 'window_closed', ... }
--      created  -> message_id, to (the contact's WhatsApp id), phone_number_id (the business number to send from)
--      existing -> message_id, status, provider_message_id (the original row; the caller must NOT send again)
-- ============================================================================
create or replace function public.inbox_prepare_outbound_text(
  p_actor_user_id uuid, p_conversation_id uuid, p_client_request_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cv public.inbox_conversations%rowtype;
  v_acct public.wa_accounts%rowtype;
  v_msg public.inbox_messages%rowtype;
  v_body text := btrim(coalesce(p_body, ''));
  v_to text;
begin
  if p_actor_user_id is null or p_conversation_id is null or p_client_request_id is null then
    return jsonb_build_object('result', 'invalid');
  end if;

  -- Ownership is decided here, from the database: the conversation's profile must belong to the actor.
  select cv.* into v_cv
    from public.inbox_conversations cv
    join public.profiles p on p.id = cv.profile_id
   where cv.id = p_conversation_id and p.user_id = p_actor_user_id;
  if not found then return jsonb_build_object('result', 'not_found'); end if;

  -- Replay first: a retry of the same request always gets the original answer, whatever the window/account state is now.
  select * into v_msg from public.inbox_messages m where m.profile_id = v_cv.profile_id and m.client_request_id = p_client_request_id;
  if found then
    if v_msg.conversation_id <> v_cv.id or v_msg.direction <> 'outbound' or v_msg.body is distinct from v_body then
      return jsonb_build_object('result', 'conflict');
    end if;
    return jsonb_build_object('result', 'existing', 'message_id', v_msg.id, 'status', v_msg.status, 'provider_message_id', v_msg.provider_message_id);
  end if;

  if v_body = '' or char_length(v_body) > 4096 then return jsonb_build_object('result', 'invalid'); end if;

  select * into v_acct from public.wa_accounts a where a.id = v_cv.account_id and a.profile_id = v_cv.profile_id;
  if not found or v_acct.status <> 'active' then return jsonb_build_object('result', 'account_disabled'); end if;

  if v_cv.last_inbound_at is null or v_cv.last_inbound_at < now() - interval '24 hours' then
    return jsonb_build_object('result', 'window_closed');
  end if;

  select c.external_id into v_to from public.inbox_contacts c where c.id = v_cv.contact_id and c.profile_id = v_cv.profile_id;
  if v_to is null then return jsonb_build_object('result', 'invalid'); end if;

  insert into public.inbox_messages (profile_id, conversation_id, channel, direction, type, body, status, sent_by_user_id, client_request_id)
  values (v_cv.profile_id, v_cv.id, 'whatsapp', 'outbound', 'text', v_body, 'queued', p_actor_user_id, p_client_request_id)
  on conflict (profile_id, client_request_id) where client_request_id is not null do nothing
  returning * into v_msg;

  if v_msg.id is null then
    -- Lost a race with an identical request: return the winner's row, never a second message.
    select * into v_msg from public.inbox_messages m where m.profile_id = v_cv.profile_id and m.client_request_id = p_client_request_id;
    if v_msg.conversation_id <> v_cv.id or v_msg.body is distinct from v_body then return jsonb_build_object('result', 'conflict'); end if;
    return jsonb_build_object('result', 'existing', 'message_id', v_msg.id, 'status', v_msg.status, 'provider_message_id', v_msg.provider_message_id);
  end if;

  return jsonb_build_object('result', 'created', 'message_id', v_msg.id, 'to', v_to, 'phone_number_id', v_acct.phone_number_id);
end;
$$;

-- ============================================================================
-- 2. COMPLETE: Meta accepted the message (it returned a wamid)
--    Returns text: 'ok' | 'duplicate' | 'conflict' | 'not_found' | 'invalid'
-- ============================================================================
create or replace function public.inbox_complete_outbound(p_actor_user_id uuid, p_message_id uuid, p_provider_message_id text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_m public.inbox_messages%rowtype;
  v_wamid text := nullif(btrim(p_provider_message_id), '');
  v_status text;
  v_codes integer[];
begin
  if p_actor_user_id is null or p_message_id is null or v_wamid is null or char_length(v_wamid) > 256 then return 'invalid'; end if;

  select m.* into v_m
    from public.inbox_messages m
    join public.profiles p on p.id = m.profile_id
   where m.id = p_message_id and m.direction = 'outbound' and p.user_id = p_actor_user_id;
  if not found then return 'not_found'; end if;

  if v_m.provider_message_id is not null then
    return case when v_m.provider_message_id = v_wamid then 'duplicate' else 'conflict' end;
  end if;

  begin
    update public.inbox_messages set provider_message_id = v_wamid where id = v_m.id;
  exception when unique_violation then
    return 'conflict';   -- that wamid already belongs to another message
  end;

  -- Status events that arrived BEFORE the wamid was known were stored unattached: attach them to this message.
  update public.inbox_status_events e set message_id = v_m.id
   where e.channel = 'whatsapp' and e.provider_message_id = v_wamid and e.message_id is null and e.profile_id = v_m.profile_id;

  -- Current status = the highest-ranked of "accepted by Meta" (sent) and every attached event (Phase 4 ranking; deleted/unknown rank null).
  select s.status, s.codes into v_status, v_codes
    from (
      select 'sent'::text as status, '{}'::integer[] as codes
      union all
      select e.status, e.error_codes from public.inbox_status_events e
       where e.message_id = v_m.id and public.inbox_status_rank(e.status) is not null
    ) s
   order by public.inbox_status_rank(s.status) desc
   limit 1;

  update public.inbox_messages m
     set status = v_status,
         status_updated_at = now(),
         error_codes = case when v_status = 'failed' then v_codes else m.error_codes end
   where m.id = v_m.id and public.inbox_status_rank(v_status) > public.inbox_status_rank(m.status);

  update public.inbox_conversations cv
     set last_outbound_at = greatest(coalesce(cv.last_outbound_at, now()), now()),
         last_message_at = greatest(cv.last_message_at, now()),
         status = 'open'
   where cv.id = v_m.conversation_id and cv.profile_id = v_m.profile_id;

  return 'ok';
end;
$$;

-- ============================================================================
-- 3. FAIL: Meta definitively rejected the message (no wamid exists)
--    Returns text: 'ok' | 'noop' | 'not_found' | 'invalid'.  'noop' = it already has a wamid or a higher status; nothing is changed.
-- ============================================================================
create or replace function public.inbox_fail_outbound(p_actor_user_id uuid, p_message_id uuid, p_error_codes integer[])
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_m public.inbox_messages%rowtype;
begin
  if p_actor_user_id is null or p_message_id is null then return 'invalid'; end if;

  select m.* into v_m
    from public.inbox_messages m
    join public.profiles p on p.id = m.profile_id
   where m.id = p_message_id and m.direction = 'outbound' and p.user_id = p_actor_user_id;
  if not found then return 'not_found'; end if;

  update public.inbox_messages m
     set status = 'failed', status_updated_at = now(), error_codes = coalesce(p_error_codes[1:20], '{}')
   where m.id = v_m.id and m.provider_message_id is null and public.inbox_status_rank('failed') > public.inbox_status_rank(m.status);
  return case when found then 'ok' else 'noop' end;
end;
$$;

-- ============================================================================
-- 4. GRANTS — service_role only (same convention as 2026-12-07)
-- ============================================================================
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('inbox_prepare_outbound_text', 'inbox_complete_outbound', 'inbox_fail_outbound')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;

commit;
