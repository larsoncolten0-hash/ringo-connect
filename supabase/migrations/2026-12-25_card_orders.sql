-- Paid card orders (WhatsApp: a customer paid for a card through the sales bot) — PROPOSED, NOT APPLIED. FOR OWNER REVIEW ONLY.
--
-- Purely additive: TWO new tables, TWO read policies each, and FOUR new server-side functions. No existing table, column, index, constraint, trigger, policy or function is
-- created, altered or dropped, and no row is touched when this file is applied. Nothing here changes a signup request, a payment, a price, a plan or a subscription: this only
-- keeps a list of the orders the existing payment code already recorded as paid, so the team can mark each one completed once the card has been delivered.
--
--   NEW TABLE  card_orders        one row per signup request that came from the WhatsApp sales bot AND was confirmed paid by the existing payment code (the payment-confirmed hook calls
--                                 card_order_record_paid once): who (name, the VERIFIED WhatsApp number), the card, the amount paid, the delivery place, the language, and the status:
--                                 paid | completed. A row starts PAID; only an authorized person marks it COMPLETED (the card was delivered). Exactly one row per signup request (unique).
--   NEW TABLE  card_order_events  append-only audit trail: every status change with the real actor (system / owner / staff) and the status before and after.
--
--   ACCESS (the existing Inbox model, no new permission; identical to card_appointments):
--       READ    the organization OWNER, or a team member whose role grants inbox.view (inbox_staff_can_read, which also applies the Team-plan gate). Row level security, SELECT only.
--       WRITE   nobody through the API: no INSERT / UPDATE / DELETE privilege or policy exists for any role. Every change goes through the functions below (service_role only).
--       CHANGE  the owner, or a team member holding inbox.reply (inbox_actor_access(actor, conversation, 'inbox.reply'), re-checked inside the function).
--
--   NEW FUNCTIONS (SECURITY DEFINER, search_path = public, pg_temp, EXECUTE for service_role only):
--       card_order_record_paid(signup_request, name, place, amount)   the payment hook records a paid order. Conversation, organization, WhatsApp number, card and language are derived
--                                                                    from the sales-bot session linked to that signup request (nothing about them comes from the caller); a repeat returns the
--                                                                    existing row (idempotent).
--       card_order_locate(order)                                      which conversation an order belongs to (so the route can authorize against that conversation).
--       card_order_set_status(actor, order, to_status, details)       mark completed (only from paid), with the permission re-check, a row lock and an event.
--       card_order_record_notify(actor, order, outcome)               records whether the customer could be thanked (sent / window_closed / failed).
--
-- Depends on: 2026-12-07_whatsapp_inbox_foundation.sql (inbox_conversations, inbox_contacts), 2026-12-14_whatsapp_inbox_staff.sql (inbox_staff_can_read, inbox_actor_access),
--             2026-12-19_whatsapp_sales_bot.sql (wa_sales_sessions), profiles, public.users.
-- Rollback: supabase/support/2026-12-25_card_orders.rollback.sql (drops these two tables and four functions only).

begin;

create table if not exists public.card_orders (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null,
  conversation_id uuid not null,
  signup_request_id uuid not null,
  customer_name text not null check (char_length(customer_name) between 1 and 120),
  customer_phone text not null check (customer_phone ~ '^[0-9]{6,20}$'),
  card_tier text check (card_tier is null or card_tier in ('standard', 'pro', 'premium')),
  amount_xaf integer check (amount_xaf is null or amount_xaf >= 0),
  delivery_place text check (delivery_place is null or char_length(delivery_place) <= 200),
  lang text not null default 'en' check (lang in ('en', 'fr')),
  status text not null default 'paid' check (status in ('paid', 'completed')),
  completed_by uuid references public.users (id) on delete set null,
  completed_at timestamptz,
  completion_details text check (completion_details is null or char_length(completion_details) <= 300),
  customer_notify_status text check (customer_notify_status is null or customer_notify_status in ('sent', 'window_closed', 'failed')),
  customer_notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (profile_id, conversation_id) references public.inbox_conversations (profile_id, id) on delete cascade
);
-- one row per paid signup request: a payment-confirmed retry can never create a second one
create unique index if not exists card_orders_signup_idx on public.card_orders (signup_request_id);
create index if not exists card_orders_profile_idx on public.card_orders (profile_id, status, created_at desc);

create table if not exists public.card_order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.card_orders (id) on delete cascade,
  actor_kind text not null check (actor_kind in ('system', 'owner', 'staff')),
  actor_user_id uuid references public.users (id) on delete set null,
  from_status text check (from_status is null or from_status in ('paid', 'completed')),
  to_status text not null check (to_status in ('paid', 'completed')),
  note text check (note is null or char_length(note) <= 300),
  created_at timestamptz not null default now()
);
create index if not exists card_order_events_order_idx on public.card_order_events (order_id, created_at);

-- ============================================================================
-- 1. THE PAYMENT HOOK RECORDS A PAID ORDER
--    Returns jsonb { result: 'created' | 'exists' | 'none' | 'invalid', id, status }.
-- ============================================================================
create or replace function public.card_order_record_paid(p_signup_request_id uuid, p_name text, p_place text, p_amount integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_s public.wa_sales_sessions%rowtype;
  v_wa text;
  v_name text := btrim(regexp_replace(regexp_replace(coalesce(p_name, ''), '[[:cntrl:]]+', ' ', 'g'), '[[:space:]]+', ' ', 'g'));
  v_place text := nullif(btrim(regexp_replace(regexp_replace(coalesce(p_place, ''), '[[:cntrl:]]+', ' ', 'g'), '[[:space:]]+', ' ', 'g')), '');
  v_tier text;
  v_lang text;
  v_id uuid;
  v_ex public.card_orders%rowtype;
begin
  if p_signup_request_id is null then return jsonb_build_object('result', 'none'); end if;
  select * into v_s from public.wa_sales_sessions s where s.signup_request_id = p_signup_request_id;
  if not found then return jsonb_build_object('result', 'none'); end if;
  select regexp_replace(c.external_id, '[^0-9]', '', 'g') into v_wa
    from public.inbox_conversations cv join public.inbox_contacts c on c.id = cv.contact_id
   where cv.id = v_s.conversation_id and cv.profile_id = v_s.profile_id;
  if v_wa is null then return jsonb_build_object('result', 'none'); end if;
  if char_length(v_name) < 1 then v_name := '-'; end if;
  v_name := left(v_name, 120);
  if v_place is not null then v_place := left(v_place, 200); end if;
  if p_amount is not null and p_amount < 0 then return jsonb_build_object('result', 'invalid'); end if;
  v_tier := case when v_s.data ->> 'tier' in ('standard', 'pro', 'premium') then v_s.data ->> 'tier' else null end;
  v_lang := case when v_s.data ->> 'lang' = 'fr' then 'fr' else 'en' end;

  insert into public.card_orders (profile_id, conversation_id, signup_request_id, customer_name, customer_phone, card_tier, amount_xaf, delivery_place, lang)
  values (v_s.profile_id, v_s.conversation_id, p_signup_request_id, v_name, v_wa, v_tier, p_amount, v_place, v_lang)
  on conflict (signup_request_id) do nothing
  returning id into v_id;

  if v_id is null then
    select * into v_ex from public.card_orders o where o.signup_request_id = p_signup_request_id;
    return jsonb_build_object('result', 'exists', 'id', v_ex.id, 'status', v_ex.status);
  end if;
  insert into public.card_order_events (order_id, actor_kind, actor_user_id, from_status, to_status) values (v_id, 'system', null, null, 'paid');
  return jsonb_build_object('result', 'created', 'id', v_id, 'status', 'paid');
end;
$$;

-- ============================================================================
-- 2. WHICH CONVERSATION DOES AN ORDER BELONG TO (the route then authorizes against THAT conversation)
-- ============================================================================
create or replace function public.card_order_locate(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v public.card_orders%rowtype;
begin
  if p_order_id is null then return jsonb_build_object('result', 'not_found'); end if;
  select * into v from public.card_orders o where o.id = p_order_id;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  return jsonb_build_object('result', 'ok', 'conversation_id', v.conversation_id, 'profile_id', v.profile_id);
end;
$$;

-- ============================================================================
-- 3. MARK COMPLETED (the card was delivered)
--    Allowed transition: paid -> completed. Completed is final. Asking for the status it already has is a no-op that changes nothing, including the stored notification outcome.
--    A REAL change clears that outcome in the same statement, so a previous notification can never be mistaken for the new one.
--    Returns jsonb { result: 'ok' | 'noop' | 'invalid' | 'invalid_transition' | 'forbidden' | 'not_found', status, conversation_id, profile_id, lang, customer_name }.
-- ============================================================================
create or replace function public.card_order_set_status(p_actor_user_id uuid, p_order_id uuid, p_to text, p_details text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v public.card_orders%rowtype;
  v_rel text;
  v_details text := nullif(btrim(regexp_replace(regexp_replace(coalesce(p_details, ''), '[[:cntrl:]]+', ' ', 'g'), '[[:space:]]+', ' ', 'g')), '');
begin
  if p_actor_user_id is null or p_order_id is null then return jsonb_build_object('result', 'not_found'); end if;
  if p_to is null or p_to <> 'completed' then return jsonb_build_object('result', 'invalid'); end if;
  if v_details is not null and char_length(v_details) > 300 then return jsonb_build_object('result', 'invalid'); end if;

  select * into v from public.card_orders o where o.id = p_order_id for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;

  -- the owner of the organization, or a team member with inbox.reply (Team plan, active membership of THIS organization): decided here, whatever the caller checked before
  v_rel := public.inbox_actor_access(p_actor_user_id, v.conversation_id, 'inbox.reply');
  if v_rel not in ('owner', 'member') then
    return jsonb_build_object('result', case when v_rel = 'forbidden' then 'forbidden' else 'not_found' end);
  end if;

  if v.status = p_to then
    return jsonb_build_object('result', 'noop', 'status', v.status, 'conversation_id', v.conversation_id, 'profile_id', v.profile_id, 'lang', v.lang, 'customer_name', v.customer_name);
  end if;
  if not (v.status = 'paid' and p_to = 'completed') then
    return jsonb_build_object('result', 'invalid_transition', 'status', v.status);
  end if;

  update public.card_orders
     set status = p_to, completed_by = p_actor_user_id, completed_at = now(), completion_details = v_details, updated_at = now(),
         customer_notify_status = null, customer_notified_at = null   -- the outcome of thanking the customer belongs to the previous status: it is cleared with the change, atomically
   where id = v.id;
  insert into public.card_order_events (order_id, actor_kind, actor_user_id, from_status, to_status, note)
  values (v.id, case when v_rel = 'owner' then 'owner' else 'staff' end, p_actor_user_id, v.status, p_to, v_details);
  return jsonb_build_object('result', 'ok', 'status', p_to, 'from', v.status, 'conversation_id', v.conversation_id, 'profile_id', v.profile_id, 'lang', v.lang, 'customer_name', v.customer_name);
end;
$$;

-- ============================================================================
-- 4. WAS THE CUSTOMER THANKED? (recorded by the route after it tried; never decides anything)
-- ============================================================================
create or replace function public.card_order_record_notify(p_actor_user_id uuid, p_order_id uuid, p_outcome text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v public.card_orders%rowtype;
begin
  if p_actor_user_id is null or p_order_id is null or p_outcome is null or p_outcome not in ('sent', 'window_closed', 'failed') then return 'invalid'; end if;
  select * into v from public.card_orders o where o.id = p_order_id;
  if not found then return 'not_found'; end if;
  if public.inbox_actor_access(p_actor_user_id, v.conversation_id, 'inbox.reply') not in ('owner', 'member') then return 'not_found'; end if;
  update public.card_orders
     set customer_notify_status = p_outcome, customer_notified_at = case when p_outcome = 'sent' then now() else null end, updated_at = now()
   where id = v.id;
  return 'ok';
end;
$$;

do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('card_order_record_paid', 'card_order_locate', 'card_order_set_status', 'card_order_record_notify')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;

-- ============================================================================
-- 5. ROW LEVEL SECURITY: read only, for the owner and for staff with inbox.view; no write privilege for any API role
-- ============================================================================
alter table public.card_orders enable row level security;
alter table public.card_order_events enable row level security;
revoke all on public.card_orders, public.card_order_events from anon, authenticated, service_role;
grant select on public.card_orders, public.card_order_events to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'card_orders' and policyname = 'card_orders owner read') then
    create policy "card_orders owner read" on public.card_orders for select to authenticated
      using (exists (select 1 from public.profiles p where p.id = card_orders.profile_id and p.user_id = auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'card_orders' and policyname = 'card_orders staff read') then
    create policy "card_orders staff read" on public.card_orders for select to authenticated
      using (public.inbox_staff_can_read(profile_id, 'inbox.view'));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'card_order_events' and policyname = 'card_order_events owner read') then
    create policy "card_order_events owner read" on public.card_order_events for select to authenticated
      using (exists (select 1 from public.card_orders o join public.profiles p on p.id = o.profile_id where o.id = card_order_events.order_id and p.user_id = auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'card_order_events' and policyname = 'card_order_events staff read') then
    create policy "card_order_events staff read" on public.card_order_events for select to authenticated
      using (exists (select 1 from public.card_orders o where o.id = card_order_events.order_id and public.inbox_staff_can_read(o.profile_id, 'inbox.view')));
  end if;
end $$;

commit;
