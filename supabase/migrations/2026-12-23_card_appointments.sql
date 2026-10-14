-- Card appointments (WhatsApp: "Buy a card -> Meet a Ringo agent") — PROPOSED, NOT APPLIED. FOR OWNER REVIEW ONLY.
--
-- Purely additive: TWO new tables, TWO read policies each, and FIVE new server-side functions. No existing table, column, index, constraint, trigger, policy or function is
-- created, altered or dropped, and no row is touched when this file is applied. The existing `bookings` system is not used and not changed. Nothing here touches a signup
-- request, a payment, a price, a plan or a subscription: an appointment request can never activate a card or record a payment.
--
--   NEW TABLE  card_appointments        one row per request a customer made through the WhatsApp sales bot: who (name, the VERIFIED WhatsApp number), when and where they would like to
--                                       meet, an optional note, the language, and the status: pending | confirmed | declined | cancelled | completed. A request starts PENDING and only an authorized
--                                       person changes it. At most ONE open (pending or confirmed) request exists per Inbox conversation (a partial unique index); a declined, cancelled or completed request is closed and no longer counts.
--   NEW TABLE  card_appointment_events  append-only audit trail: every status change with the real actor (customer / owner / staff) and the status before and after.
--
--   ACCESS (the existing Inbox model, no new permission):
--       READ    the organization OWNER, or a team member whose role grants inbox.view (inbox_staff_can_read, the same function the Inbox staff read policies use, which also
--               applies the Team-plan gate). Row level security, SELECT only.
--       WRITE   nobody through the API: no INSERT / UPDATE / DELETE privilege or policy exists for any role. Every change goes through the functions below (service_role only).
--       CHANGE  the owner, or a team member holding inbox.reply (inbox_actor_access(actor, conversation, 'inbox.reply'), re-checked inside the function).
--
--   NEW FUNCTIONS (SECURITY DEFINER, search_path = public, pg_temp, EXECUTE for service_role only):
--       card_appt_create(conversation, name, phone, time, place, note, lang)   the bot submits a request. The profile is derived from the conversation, the phone must equal the
--                                                                              conversation's verified WhatsApp number, every field is validated again here, and a repeat returns the
--                                                                              existing open request (idempotent).
--       card_appt_status(conversation)                                         the newest request of a conversation (for the bot's status answer).
--       card_appt_locate(appointment)                                          which conversation an appointment belongs to (so the route can authorize against that conversation).
--       card_appt_set_status(actor, appointment, to_status, details)           confirm / decline / cancel with the transition rules, the permission re-check, a row lock and an event.
--       card_appt_record_notify(actor, appointment, outcome)                   records whether the customer could be told (sent / window_closed / failed).
--
-- Depends on: 2026-12-07_whatsapp_inbox_foundation.sql (inbox_conversations, inbox_contacts), 2026-12-14_whatsapp_inbox_staff.sql (inbox_staff_can_read, inbox_actor_access),
--             profiles, public.users.
-- Rollback: supabase/support/2026-12-23_card_appointments.rollback.sql (drops these two tables and five functions only).

begin;

create table if not exists public.card_appointments (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null,
  conversation_id uuid not null,
  customer_name text not null check (char_length(customer_name) between 2 and 80),
  customer_phone text not null check (customer_phone ~ '^[0-9]{6,20}$'),
  preferred_time text not null check (char_length(preferred_time) between 3 and 80),
  meeting_place text not null check (char_length(meeting_place) between 3 and 160),
  note text check (note is null or char_length(note) <= 200),
  lang text not null default 'en' check (lang in ('en', 'fr')),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'declined', 'cancelled', 'completed')),
  decided_by uuid references public.users (id) on delete set null,
  decided_at timestamptz,
  decision_details text check (decision_details is null or char_length(decision_details) <= 300),
  customer_notify_status text check (customer_notify_status is null or customer_notify_status in ('sent', 'window_closed', 'failed')),
  customer_notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (profile_id, conversation_id) references public.inbox_conversations (profile_id, id) on delete cascade
);
-- one open request per conversation: a webhook retry or a second tap can never create a second one
create unique index if not exists card_appointments_one_open_idx on public.card_appointments (conversation_id) where status in ('pending', 'confirmed');
create index if not exists card_appointments_profile_idx on public.card_appointments (profile_id, status, created_at desc);

create table if not exists public.card_appointment_events (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.card_appointments (id) on delete cascade,
  actor_kind text not null check (actor_kind in ('customer', 'owner', 'staff')),
  actor_user_id uuid references public.users (id) on delete set null,
  from_status text check (from_status is null or from_status in ('pending', 'confirmed', 'declined', 'cancelled', 'completed')),
  to_status text not null check (to_status in ('pending', 'confirmed', 'declined', 'cancelled', 'completed')),
  note text check (note is null or char_length(note) <= 300),
  created_at timestamptz not null default now()
);
create index if not exists card_appointment_events_appt_idx on public.card_appointment_events (appointment_id, created_at);

-- ============================================================================
-- 1. THE BOT SUBMITS A REQUEST
--    Returns jsonb { result: 'created' | 'exists' | 'invalid' | 'skip', id, status, profile_id }.
-- ============================================================================
create or replace function public.card_appt_create(p_conversation_id uuid, p_name text, p_phone text, p_time text, p_place text, p_note text, p_lang text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile uuid;
  v_wa text;
  v_name text := btrim(regexp_replace(regexp_replace(coalesce(p_name, ''), '[[:cntrl:]]+', ' ', 'g'), '[[:space:]]+', ' ', 'g'));
  v_time text := btrim(regexp_replace(regexp_replace(coalesce(p_time, ''), '[[:cntrl:]]+', ' ', 'g'), '[[:space:]]+', ' ', 'g'));
  v_place text := btrim(regexp_replace(regexp_replace(coalesce(p_place, ''), '[[:cntrl:]]+', ' ', 'g'), '[[:space:]]+', ' ', 'g'));
  v_note text := nullif(btrim(regexp_replace(regexp_replace(coalesce(p_note, ''), '[[:cntrl:]]+', ' ', 'g'), '[[:space:]]+', ' ', 'g')), '');
  v_lang text := case when p_lang = 'fr' then 'fr' else 'en' end;
  v_id uuid;
  v_ex public.card_appointments%rowtype;
begin
  if p_conversation_id is null then return jsonb_build_object('result', 'invalid'); end if;
  select cv.profile_id, regexp_replace(c.external_id, '[^0-9]', '', 'g') into v_profile, v_wa
    from public.inbox_conversations cv join public.inbox_contacts c on c.id = cv.contact_id
   where cv.id = p_conversation_id;
  if not found then return jsonb_build_object('result', 'skip'); end if;
  -- the number is never taken on trust: it must be the conversation's own verified WhatsApp number
  if p_phone is null or p_phone <> v_wa then return jsonb_build_object('result', 'invalid'); end if;
  if char_length(v_name) not between 2 and 80 or char_length(v_time) not between 3 and 80 or char_length(v_place) not between 3 and 160
     or (v_note is not null and char_length(v_note) > 200) then
    return jsonb_build_object('result', 'invalid');
  end if;

  insert into public.card_appointments (profile_id, conversation_id, customer_name, customer_phone, preferred_time, meeting_place, note, lang)
  values (v_profile, p_conversation_id, v_name, v_wa, v_time, v_place, v_note, v_lang)
  on conflict (conversation_id) where status in ('pending', 'confirmed') do nothing
  returning id into v_id;

  if v_id is null then
    select * into v_ex from public.card_appointments a where a.conversation_id = p_conversation_id and a.status in ('pending', 'confirmed') order by a.created_at desc limit 1;
    return jsonb_build_object('result', 'exists', 'id', v_ex.id, 'status', v_ex.status, 'profile_id', v_profile);
  end if;
  insert into public.card_appointment_events (appointment_id, actor_kind, actor_user_id, from_status, to_status) values (v_id, 'customer', null, null, 'pending');
  return jsonb_build_object('result', 'created', 'id', v_id, 'status', 'pending', 'profile_id', v_profile);
end;
$$;

-- ============================================================================
-- 2. THE NEWEST REQUEST OF A CONVERSATION (for the bot's status answer)
-- ============================================================================
create or replace function public.card_appt_status(p_conversation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v public.card_appointments%rowtype;
begin
  if p_conversation_id is null then return jsonb_build_object('result', 'none'); end if;
  select * into v from public.card_appointments a where a.conversation_id = p_conversation_id order by a.created_at desc limit 1;
  if not found then return jsonb_build_object('result', 'none'); end if;
  return jsonb_build_object('result', 'ok', 'id', v.id, 'status', v.status, 'open', v.status in ('pending', 'confirmed'));
end;
$$;

-- ============================================================================
-- 3. WHICH CONVERSATION DOES AN APPOINTMENT BELONG TO (the route then authorizes against THAT conversation)
-- ============================================================================
create or replace function public.card_appt_locate(p_appointment_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v public.card_appointments%rowtype;
begin
  if p_appointment_id is null then return jsonb_build_object('result', 'not_found'); end if;
  select * into v from public.card_appointments a where a.id = p_appointment_id;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  return jsonb_build_object('result', 'ok', 'conversation_id', v.conversation_id, 'profile_id', v.profile_id);
end;
$$;

-- ============================================================================
-- 4. CONFIRM / DECLINE / CANCEL
--    Allowed transitions: pending -> confirmed | declined | cancelled, confirmed -> cancelled | completed. Declined, cancelled and completed are final (and closed: the customer may ask again).
--    Asking for the status it already has is a no-op that changes nothing, including the stored notification outcome. A REAL change clears that outcome in the same statement, so the
--    previous notification can never be mistaken for the new one.
--    Returns jsonb { result: 'ok' | 'noop' | 'invalid' | 'invalid_transition' | 'forbidden' | 'not_found', status, conversation_id, profile_id, lang }.
-- ============================================================================
create or replace function public.card_appt_set_status(p_actor_user_id uuid, p_appointment_id uuid, p_to text, p_details text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v public.card_appointments%rowtype;
  v_rel text;
  v_details text := nullif(btrim(regexp_replace(regexp_replace(coalesce(p_details, ''), '[[:cntrl:]]+', ' ', 'g'), '[[:space:]]+', ' ', 'g')), '');
begin
  if p_actor_user_id is null or p_appointment_id is null then return jsonb_build_object('result', 'not_found'); end if;
  if p_to is null or p_to not in ('confirmed', 'declined', 'cancelled', 'completed') then return jsonb_build_object('result', 'invalid'); end if;
  if v_details is not null and char_length(v_details) > 300 then return jsonb_build_object('result', 'invalid'); end if;

  select * into v from public.card_appointments a where a.id = p_appointment_id for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;

  -- the owner of the organization, or a team member with inbox.reply (Team plan, active membership of THIS organization): decided here, whatever the caller checked before
  v_rel := public.inbox_actor_access(p_actor_user_id, v.conversation_id, 'inbox.reply');
  if v_rel not in ('owner', 'member') then
    return jsonb_build_object('result', case when v_rel = 'forbidden' then 'forbidden' else 'not_found' end);
  end if;

  if v.status = p_to then
    return jsonb_build_object('result', 'noop', 'status', v.status, 'conversation_id', v.conversation_id, 'profile_id', v.profile_id, 'lang', v.lang);
  end if;
  if not ((v.status = 'pending' and p_to in ('confirmed', 'declined', 'cancelled')) or (v.status = 'confirmed' and p_to in ('cancelled', 'completed'))) then
    return jsonb_build_object('result', 'invalid_transition', 'status', v.status);
  end if;

  update public.card_appointments
     set status = p_to, decided_by = p_actor_user_id, decided_at = now(), decision_details = v_details, updated_at = now(),
         customer_notify_status = null, customer_notified_at = null   -- the outcome of telling the customer belongs to the previous status: it is cleared with the change, atomically
   where id = v.id;
  insert into public.card_appointment_events (appointment_id, actor_kind, actor_user_id, from_status, to_status, note)
  values (v.id, case when v_rel = 'owner' then 'owner' else 'staff' end, p_actor_user_id, v.status, p_to, v_details);
  return jsonb_build_object('result', 'ok', 'status', p_to, 'from', v.status, 'conversation_id', v.conversation_id, 'profile_id', v.profile_id, 'lang', v.lang);
end;
$$;

-- ============================================================================
-- 5. WAS THE CUSTOMER TOLD? (recorded by the route after it tried; never decides anything)
-- ============================================================================
create or replace function public.card_appt_record_notify(p_actor_user_id uuid, p_appointment_id uuid, p_outcome text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v public.card_appointments%rowtype;
begin
  if p_actor_user_id is null or p_appointment_id is null or p_outcome is null or p_outcome not in ('sent', 'window_closed', 'failed') then return 'invalid'; end if;
  select * into v from public.card_appointments a where a.id = p_appointment_id;
  if not found then return 'not_found'; end if;
  if public.inbox_actor_access(p_actor_user_id, v.conversation_id, 'inbox.reply') not in ('owner', 'member') then return 'not_found'; end if;
  update public.card_appointments
     set customer_notify_status = p_outcome, customer_notified_at = case when p_outcome = 'sent' then now() else null end, updated_at = now()
   where id = v.id;
  return 'ok';
end;
$$;

do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('card_appt_create', 'card_appt_status', 'card_appt_locate', 'card_appt_set_status', 'card_appt_record_notify')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;

-- ============================================================================
-- 6. ROW LEVEL SECURITY: read only, for the owner and for staff with inbox.view; no write privilege for any API role
-- ============================================================================
alter table public.card_appointments enable row level security;
alter table public.card_appointment_events enable row level security;
revoke all on public.card_appointments, public.card_appointment_events from anon, authenticated, service_role;
grant select on public.card_appointments, public.card_appointment_events to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'card_appointments' and policyname = 'card_appointments owner read') then
    create policy "card_appointments owner read" on public.card_appointments for select to authenticated
      using (exists (select 1 from public.profiles p where p.id = card_appointments.profile_id and p.user_id = auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'card_appointments' and policyname = 'card_appointments staff read') then
    create policy "card_appointments staff read" on public.card_appointments for select to authenticated
      using (public.inbox_staff_can_read(profile_id, 'inbox.view'));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'card_appointment_events' and policyname = 'card_appointment_events owner read') then
    create policy "card_appointment_events owner read" on public.card_appointment_events for select to authenticated
      using (exists (select 1 from public.card_appointments a join public.profiles p on p.id = a.profile_id where a.id = card_appointment_events.appointment_id and p.user_id = auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'card_appointment_events' and policyname = 'card_appointment_events staff read') then
    create policy "card_appointment_events staff read" on public.card_appointment_events for select to authenticated
      using (exists (select 1 from public.card_appointments a where a.id = card_appointment_events.appointment_id and public.inbox_staff_can_read(a.profile_id, 'inbox.view')));
  end if;
end $$;

commit;
