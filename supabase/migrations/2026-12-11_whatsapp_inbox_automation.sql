-- WhatsApp Inbox automation (Phase 10) — PROPOSED, NOT APPLIED. FOR OWNER REVIEW ONLY.
--
-- Purely additive: TWO new tables (per-profile settings, per-conversation automation bookkeeping), their guard triggers, two owner-read RLS
-- policies and SEVEN server-side functions. No existing table, column, index, constraint, trigger, function or policy is modified: the Phase 4/7/8/9
-- objects are only READ. Dropping everything below leaves no trace on anything that existed before.
--
--   NEW TABLE  inbox_settings            one row per profile (created on first save): timezone, weekly business hours, automatic acknowledgement
--                                        (mode off / outside_hours / always, plus the owner's own text), follow-up reminder rule, notification switches.
--                                        EVERYTHING DEFAULTS TO OFF (a profile with no row behaves as: no acknowledgement, no follow-up reminders).
--   NEW TABLE  inbox_conversation_state  automation bookkeeping per conversation: when the last automatic acknowledgement was claimed (12-hour cooldown),
--                                        which outbound messages were automatic (so they are never mistaken for a human reply) and which unanswered
--                                        customer message a follow-up reminder was already raised for (one reminder per unanswered message).
--       RLS: owner READ only. No write policy and no write grant: every write goes through the functions below.
--   NEW FUNCTIONS (SECURITY DEFINER, search_path = public, pg_temp, EXECUTE for service_role only; the two pure helpers are plain, same grants):
--       inbox_hours_valid(hours)                       pure: is this weekly-hours document well formed
--       inbox_within_hours(hours, timezone, at)        pure: is this instant inside the hours (true when no hours are configured)
--       inbox_settings_save(actor, profile, settings)  validated upsert of the owner's settings
--       inbox_automation_inbound(phone_number_id, wamid)   called by the webhook AFTER a NEW inbound message was stored: decides (atomically) whether an
--                                                          automatic acknowledgement is due and whether a "new conversation" notice is due
--       inbox_automation_record_ack(conversation, message) marks an outbound message as automatic
--       inbox_automation_failed(phone_number_id, wamid)    called by the webhook after a delivery FAILURE was recorded: is a notice due
--       inbox_claim_follow_ups(limit)                      called by the daily cron: atomically claims conversations whose last customer message is
--                                                          still unanswered by a HUMAN after the owner's chosen number of hours
--
-- WHAT THIS DOES NOT DO, by design: it never sends anything to a customer by itself except ONE short owner-written acknowledgement per 12 hours
-- per conversation, and only when the owner switched it on, only inside the 24-hour window (the customer has just written) and only through the
-- existing, audited text sender. It sends NO follow-up messages: a follow-up after the window needs an approved template, which is NOT built
-- (the reminder only tells the OWNER). It never closes a conversation. It stores no message text of its own (the acknowledgement text is the
-- owner's setting). It accepts no recipient, phone number, WABA id or token from the caller.
--
-- Depends on: 2026-12-07_whatsapp_inbox_foundation.sql (wa_accounts, inbox_contacts, inbox_conversations, inbox_messages), profiles.
-- Rollback: supabase/support/2026-12-11_whatsapp_inbox_automation.rollback.sql (DESTROYS the owners' automation settings).

begin;

-- ============================================================================
-- 1. PURE HELPERS: weekly business hours
--    Document shape: { "mon": [["09:00","18:00"]], "tue": [...], ... }  (keys mon..sun, at most 3 intervals a day, "HH:MM" 24h, start < end).
--    An empty document {} means "no hours configured" = always open. A day that is missing from a non-empty document is closed that day.
-- ============================================================================
create or replace function public.inbox_hours_valid(p_hours jsonb)
returns boolean
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  k text;
  v jsonb;
  i jsonb;
  s text;
  e text;
begin
  if p_hours is null or jsonb_typeof(p_hours) <> 'object' then return false; end if;
  for k, v in select t.key, t.value from jsonb_each(p_hours) t loop
    if k not in ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun') then return false; end if;
    if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 3 then return false; end if;
    for i in select t.value from jsonb_array_elements(v) t loop
      if jsonb_typeof(i) <> 'array' or jsonb_array_length(i) <> 2 then return false; end if;
      if jsonb_typeof(i -> 0) <> 'string' or jsonb_typeof(i -> 1) <> 'string' then return false; end if;
      s := i ->> 0;
      e := i ->> 1;
      if s !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or e !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or s >= e then return false; end if;
    end loop;
  end loop;
  return true;
end;
$$;

create or replace function public.inbox_within_hours(p_hours jsonb, p_timezone text, p_at timestamptz)
returns boolean
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_local timestamp;
  v_day text;
  v_time text;
  i jsonb;
begin
  if p_hours is null or p_hours = '{}'::jsonb then return true; end if;
  v_local := p_at at time zone p_timezone;
  v_day := (array['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])[extract(isodow from v_local)::int];
  v_time := to_char(v_local, 'HH24:MI');
  for i in select t.value from jsonb_array_elements(coalesce(p_hours -> v_day, '[]'::jsonb)) t loop
    if v_time >= (i ->> 0) and v_time < (i ->> 1) then return true; end if;
  end loop;
  return false;
end;
$$;

-- ============================================================================
-- 2. TABLES
-- ============================================================================
create table if not exists public.inbox_settings (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  timezone text not null default 'Africa/Douala' check (char_length(timezone) between 1 and 64),
  business_hours jsonb not null default '{}'::jsonb check (public.inbox_hours_valid(business_hours)),
  auto_ack_mode text not null default 'off' check (auto_ack_mode in ('off', 'outside_hours', 'always')),
  auto_ack_text text check (auto_ack_text is null or char_length(auto_ack_text) between 1 and 500),
  follow_up_enabled boolean not null default false,
  follow_up_after_hours integer not null default 24 check (follow_up_after_hours between 1 and 168),
  notify_new_conversation boolean not null default true,
  notify_failed_message boolean not null default true,
  notify_follow_up boolean not null default true,
  notification_locale text not null default 'fr' check (notification_locale in ('en', 'fr')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (auto_ack_mode = 'off' or auto_ack_text is not null)
);

create or replace function public.inbox_settings_guard() returns trigger language plpgsql as $$
begin
  if new.profile_id <> old.profile_id or new.created_at <> old.created_at then
    raise exception 'inbox_settings: identity columns are immutable';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists inbox_settings_guard_trg on public.inbox_settings;
create trigger inbox_settings_guard_trg before update on public.inbox_settings for each row execute function public.inbox_settings_guard();

create table if not exists public.inbox_conversation_state (
  conversation_id uuid primary key,
  profile_id uuid not null,
  last_auto_ack_at timestamptz,
  auto_ack_message_ids uuid[] not null default '{}' check (cardinality(auto_ack_message_ids) <= 20),
  follow_up_notified_for timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (profile_id, conversation_id) references public.inbox_conversations (profile_id, id) on delete cascade
);
create index if not exists inbox_conversation_state_profile_idx on public.inbox_conversation_state (profile_id);

create or replace function public.inbox_conversation_state_guard() returns trigger language plpgsql as $$
begin
  if new.conversation_id <> old.conversation_id or new.profile_id <> old.profile_id or new.created_at <> old.created_at then
    raise exception 'inbox_conversation_state: identity columns are immutable';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists inbox_conversation_state_guard_trg on public.inbox_conversation_state;
create trigger inbox_conversation_state_guard_trg before update on public.inbox_conversation_state for each row execute function public.inbox_conversation_state_guard();

-- ============================================================================
-- 3. SAVE SETTINGS (validated upsert; only the keys that are present change)
--    Returns jsonb { result: 'saved' | 'not_found' | 'invalid' }
-- ============================================================================
create or replace function public.inbox_settings_save(p_actor_user_id uuid, p_profile_id uuid, p_settings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cur public.inbox_settings%rowtype;
  v_key text;
  v_tz text;
  v_hours jsonb;
  v_mode text;
  v_text text;
  v_fu boolean;
  v_fu_hours integer;
  v_n_new boolean;
  v_n_failed boolean;
  v_n_fu boolean;
  v_loc text;
begin
  if p_actor_user_id is null or p_profile_id is null or p_settings is null or jsonb_typeof(p_settings) <> 'object' then
    return jsonb_build_object('result', 'invalid');
  end if;

  perform 1 from public.profiles p
   where p.id = p_profile_id and p.user_id = p_actor_user_id
     and exists (select 1 from public.wa_accounts a where a.profile_id = p.id);
  if not found then return jsonb_build_object('result', 'not_found'); end if;

  for v_key in select jsonb_object_keys(p_settings) loop
    if v_key not in ('timezone', 'business_hours', 'auto_ack_mode', 'auto_ack_text', 'follow_up_enabled', 'follow_up_after_hours',
                     'notify_new_conversation', 'notify_failed_message', 'notify_follow_up', 'notification_locale') then
      return jsonb_build_object('result', 'invalid');
    end if;
  end loop;

  select * into v_cur from public.inbox_settings s where s.profile_id = p_profile_id;
  if not found then
    v_cur.timezone := 'Africa/Douala'; v_cur.business_hours := '{}'::jsonb; v_cur.auto_ack_mode := 'off'; v_cur.auto_ack_text := null;
    v_cur.follow_up_enabled := false; v_cur.follow_up_after_hours := 24;
    v_cur.notify_new_conversation := true; v_cur.notify_failed_message := true; v_cur.notify_follow_up := true; v_cur.notification_locale := 'fr';
  end if;

  v_tz := v_cur.timezone; v_hours := v_cur.business_hours; v_mode := v_cur.auto_ack_mode; v_text := v_cur.auto_ack_text;
  v_fu := v_cur.follow_up_enabled; v_fu_hours := v_cur.follow_up_after_hours;
  v_n_new := v_cur.notify_new_conversation; v_n_failed := v_cur.notify_failed_message; v_n_fu := v_cur.notify_follow_up; v_loc := v_cur.notification_locale;

  if p_settings ? 'timezone' then
    if jsonb_typeof(p_settings -> 'timezone') <> 'string' then return jsonb_build_object('result', 'invalid'); end if;
    v_tz := btrim(p_settings ->> 'timezone');
    if not exists (select 1 from pg_timezone_names z where z.name = v_tz) then return jsonb_build_object('result', 'invalid'); end if;
  end if;
  if p_settings ? 'business_hours' then
    if not public.inbox_hours_valid(p_settings -> 'business_hours') then return jsonb_build_object('result', 'invalid'); end if;
    v_hours := p_settings -> 'business_hours';
  end if;
  if p_settings ? 'auto_ack_mode' then
    if jsonb_typeof(p_settings -> 'auto_ack_mode') <> 'string' or (p_settings ->> 'auto_ack_mode') not in ('off', 'outside_hours', 'always') then
      return jsonb_build_object('result', 'invalid');
    end if;
    v_mode := p_settings ->> 'auto_ack_mode';
  end if;
  if p_settings ? 'auto_ack_text' then
    if jsonb_typeof(p_settings -> 'auto_ack_text') = 'null' then
      v_text := null;
    elsif jsonb_typeof(p_settings -> 'auto_ack_text') <> 'string' then
      return jsonb_build_object('result', 'invalid');
    else
      v_text := btrim(p_settings ->> 'auto_ack_text');
      if v_text = '' then v_text := null; end if;
      if v_text is not null and (char_length(v_text) > 500 or translate(v_text, E'\n', '') ~ '[[:cntrl:]]') then return jsonb_build_object('result', 'invalid'); end if;
    end if;
  end if;
  if p_settings ? 'follow_up_enabled' then
    if jsonb_typeof(p_settings -> 'follow_up_enabled') <> 'boolean' then return jsonb_build_object('result', 'invalid'); end if;
    v_fu := (p_settings ->> 'follow_up_enabled')::boolean;
  end if;
  if p_settings ? 'follow_up_after_hours' then
    if jsonb_typeof(p_settings -> 'follow_up_after_hours') <> 'number' or (p_settings ->> 'follow_up_after_hours') !~ '^[0-9]{1,3}$' then
      return jsonb_build_object('result', 'invalid');
    end if;
    v_fu_hours := (p_settings ->> 'follow_up_after_hours')::integer;
    if v_fu_hours < 1 or v_fu_hours > 168 then return jsonb_build_object('result', 'invalid'); end if;
  end if;
  if p_settings ? 'notify_new_conversation' then
    if jsonb_typeof(p_settings -> 'notify_new_conversation') <> 'boolean' then return jsonb_build_object('result', 'invalid'); end if;
    v_n_new := (p_settings ->> 'notify_new_conversation')::boolean;
  end if;
  if p_settings ? 'notify_failed_message' then
    if jsonb_typeof(p_settings -> 'notify_failed_message') <> 'boolean' then return jsonb_build_object('result', 'invalid'); end if;
    v_n_failed := (p_settings ->> 'notify_failed_message')::boolean;
  end if;
  if p_settings ? 'notify_follow_up' then
    if jsonb_typeof(p_settings -> 'notify_follow_up') <> 'boolean' then return jsonb_build_object('result', 'invalid'); end if;
    v_n_fu := (p_settings ->> 'notify_follow_up')::boolean;
  end if;

  if p_settings ? 'notification_locale' then
    if jsonb_typeof(p_settings -> 'notification_locale') <> 'string' or (p_settings ->> 'notification_locale') not in ('en', 'fr') then return jsonb_build_object('result', 'invalid'); end if;
    v_loc := p_settings ->> 'notification_locale';
  end if;

  -- an acknowledgement can only be switched on with a text to send
  if v_mode <> 'off' and v_text is null then return jsonb_build_object('result', 'invalid'); end if;

  insert into public.inbox_settings (profile_id, timezone, business_hours, auto_ack_mode, auto_ack_text, follow_up_enabled, follow_up_after_hours,
                                     notify_new_conversation, notify_failed_message, notify_follow_up, notification_locale)
  values (p_profile_id, v_tz, v_hours, v_mode, v_text, v_fu, v_fu_hours, v_n_new, v_n_failed, v_n_fu, v_loc)
  on conflict (profile_id) do update
     set timezone = excluded.timezone, business_hours = excluded.business_hours, auto_ack_mode = excluded.auto_ack_mode,
         auto_ack_text = excluded.auto_ack_text, follow_up_enabled = excluded.follow_up_enabled, follow_up_after_hours = excluded.follow_up_after_hours,
         notify_new_conversation = excluded.notify_new_conversation, notify_failed_message = excluded.notify_failed_message,
         notify_follow_up = excluded.notify_follow_up, notification_locale = excluded.notification_locale;
  return jsonb_build_object('result', 'saved');
end;
$$;

-- ============================================================================
-- 4. A NEW INBOUND MESSAGE WAS STORED: is an acknowledgement and/or a notice due?
--    Returns jsonb { result: 'skip' } or
--      { result: 'ok', conversation_id, owner_user_id, notify_new (bool), ack_text (text or null), locale, contact_name }
--    The acknowledgement is decided AND claimed here in one atomic statement (12-hour cooldown per conversation), so concurrent webhook
--    deliveries can never both pass. A claimed acknowledgement is never claimed again, even if sending it fails: no retry storms.
--    Skipped silently: unknown message, outbound message, disabled account.
-- ============================================================================
create or replace function public.inbox_automation_inbound(p_phone_number_id text, p_provider_message_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_acct public.wa_accounts%rowtype;
  v_msg public.inbox_messages%rowtype;
  v_cv public.inbox_conversations%rowtype;
  v_set public.inbox_settings%rowtype;
  v_owner uuid;
  v_new_state boolean := false;
  v_is_new boolean := false;
  v_ack text := null;
  v_claimed uuid;
  v_name text;
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
  select left(c.display_name, 60) into v_name from public.inbox_contacts c where c.id = v_cv.contact_id and c.profile_id = v_cv.profile_id;

  with ins as (
    insert into public.inbox_conversation_state (conversation_id, profile_id) values (v_cv.id, v_cv.profile_id)
    on conflict (conversation_id) do nothing returning 1
  ) select exists (select 1 from ins) into v_new_state;
  -- a conversation counts as NEW only when its state row was just created AND the conversation itself was created moments ago
  v_is_new := v_new_state and v_cv.created_at > now() - interval '2 minutes';

  select * into v_set from public.inbox_settings s where s.profile_id = v_acct.profile_id;
  if not found then
    v_set.auto_ack_mode := 'off'; v_set.notify_new_conversation := true; v_set.notification_locale := 'fr';
  end if;

  if v_set.auto_ack_mode <> 'off' and v_set.auto_ack_text is not null
     and (v_set.auto_ack_mode = 'always' or not public.inbox_within_hours(v_set.business_hours, v_set.timezone, now())) then
    update public.inbox_conversation_state st set last_auto_ack_at = now()
     where st.conversation_id = v_cv.id and (st.last_auto_ack_at is null or st.last_auto_ack_at < now() - interval '12 hours')
    returning st.conversation_id into v_claimed;
    if v_claimed is not null then v_ack := v_set.auto_ack_text; end if;
  end if;

  return jsonb_build_object('result', 'ok', 'conversation_id', v_cv.id, 'owner_user_id', v_owner,
                            'notify_new', (v_is_new and coalesce(v_set.notify_new_conversation, true)), 'ack_text', v_ack,
                            'locale', coalesce(v_set.notification_locale, 'fr'), 'contact_name', v_name);
end;
$$;

-- ============================================================================
-- 5. MARK an outbound message as the automatic acknowledgement.   Returns text: 'ok' | 'not_found'
-- ============================================================================
create or replace function public.inbox_automation_record_ack(p_conversation_id uuid, p_message_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_conversation_id is null or p_message_id is null then return 'not_found'; end if;
  perform 1 from public.inbox_messages m
   where m.id = p_message_id and m.conversation_id = p_conversation_id and m.direction = 'outbound';
  if not found then return 'not_found'; end if;
  update public.inbox_conversation_state st
     set auto_ack_message_ids = case when p_message_id = any (st.auto_ack_message_ids) then st.auto_ack_message_ids
                                     else (st.auto_ack_message_ids || p_message_id)[greatest(1, cardinality(st.auto_ack_message_ids) + 2 - 20):] end
   where st.conversation_id = p_conversation_id;
  return case when found then 'ok' else 'not_found' end;
end;
$$;

-- ============================================================================
-- 6. A DELIVERY FAILURE was recorded for an outbound message: is a notice due?
--    Returns jsonb { result: 'skip' } or { result: 'notify', owner_user_id, conversation_id }.
--    Only when the message's CURRENT status is 'failed' (a late failure after 'read' never changes the status, so it never notifies).
-- ============================================================================
create or replace function public.inbox_automation_failed(p_phone_number_id text, p_provider_message_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_acct public.wa_accounts%rowtype;
  v_msg public.inbox_messages%rowtype;
  v_owner uuid;
  v_notify boolean;
  v_loc text;
begin
  if p_phone_number_id is null or p_provider_message_id is null then return jsonb_build_object('result', 'skip'); end if;
  select * into v_acct from public.wa_accounts a where a.phone_number_id = p_phone_number_id;
  if not found then return jsonb_build_object('result', 'skip'); end if;
  select * into v_msg from public.inbox_messages m
   where m.profile_id = v_acct.profile_id and m.provider_message_id = p_provider_message_id and m.direction = 'outbound';
  if not found or v_msg.status <> 'failed' then return jsonb_build_object('result', 'skip'); end if;
  select coalesce((select s.notify_failed_message from public.inbox_settings s where s.profile_id = v_acct.profile_id), true),
         coalesce((select s.notification_locale from public.inbox_settings s where s.profile_id = v_acct.profile_id), 'fr') into v_notify, v_loc;
  if not v_notify then return jsonb_build_object('result', 'skip'); end if;
  select p.user_id into v_owner from public.profiles p where p.id = v_acct.profile_id;
  if v_owner is null then return jsonb_build_object('result', 'skip'); end if;
  return jsonb_build_object('result', 'notify', 'owner_user_id', v_owner, 'conversation_id', v_msg.conversation_id, 'locale', v_loc);
end;
$$;

-- ============================================================================
-- 7. DAILY CRON: claim conversations that need a follow-up reminder.
--    A conversation is due when: its profile enabled follow-up reminders (and notices), it is open, the customer's last message is between
--    the owner's chosen number of hours and 7 days old, and NO HUMAN reply was sent after it (an automatic acknowledgement does not count).
--    Each unanswered customer message is claimed ONCE (follow_up_notified_for = that message's time), atomically, so overlapping or retried
--    cron runs never remind twice. Returns jsonb array of { conversation_id, owner_user_id, window_open, locale, contact_name }.
--    window_open tells the owner whether a free-form reply is still possible (otherwise a template would be needed, which is not built).
-- ============================================================================
create or replace function public.inbox_claim_follow_ups(p_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_out jsonb;
begin
  insert into public.inbox_conversation_state (conversation_id, profile_id)
  select cv.id, cv.profile_id
    from public.inbox_conversations cv
    join public.inbox_settings s on s.profile_id = cv.profile_id and s.follow_up_enabled and s.notify_follow_up
   where cv.status = 'open' and cv.last_inbound_at is not null and cv.last_inbound_at > now() - interval '7 days'
  on conflict (conversation_id) do nothing;

  with due as (
    select st.conversation_id, cv.last_inbound_at, cv.profile_id, cv.contact_id
      from public.inbox_conversation_state st
      join public.inbox_conversations cv on cv.id = st.conversation_id and cv.profile_id = st.profile_id
      join public.inbox_settings s on s.profile_id = cv.profile_id
     where s.follow_up_enabled and s.notify_follow_up
       and cv.status = 'open'
       and cv.last_inbound_at is not null
       and cv.last_inbound_at <= now() - make_interval(hours => s.follow_up_after_hours)
       and cv.last_inbound_at > now() - interval '7 days'
       and st.follow_up_notified_for is distinct from cv.last_inbound_at
       and not exists (select 1 from public.inbox_messages m
                        where m.conversation_id = cv.id and m.profile_id = cv.profile_id and m.direction = 'outbound'
                          and m.created_at >= cv.last_inbound_at and m.id <> all (st.auto_ack_message_ids))
     order by cv.last_inbound_at
     limit v_limit
       for update of st skip locked
  ), upd as (
    update public.inbox_conversation_state st set follow_up_notified_for = due.last_inbound_at
      from due where st.conversation_id = due.conversation_id
    returning st.conversation_id, due.last_inbound_at, due.profile_id, due.contact_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'conversation_id', u.conversation_id,
           'owner_user_id', p.user_id,
           'window_open', u.last_inbound_at > now() - interval '24 hours',
           'locale', s2.notification_locale,
           'contact_name', left(c.display_name, 60))), '[]'::jsonb)
    into v_out
    from upd u
    join public.profiles p on p.id = u.profile_id
    join public.inbox_settings s2 on s2.profile_id = u.profile_id
    left join public.inbox_contacts c on c.id = u.contact_id and c.profile_id = u.profile_id;
  return v_out;
end;
$$;

-- ============================================================================
-- 8. FUNCTION GRANTS (service_role only) AND TABLE RLS / PRIVILEGES (owner read only)
-- ============================================================================
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig, p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('inbox_hours_valid', 'inbox_within_hours', 'inbox_settings_guard', 'inbox_conversation_state_guard',
                   'inbox_settings_save', 'inbox_automation_inbound', 'inbox_automation_record_ack', 'inbox_automation_failed', 'inbox_claim_follow_ups')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', r.sig);
    if r.name not in ('inbox_settings_guard', 'inbox_conversation_state_guard') then
      execute format('grant execute on function %s to service_role', r.sig);
    end if;
  end loop;
end $$;

alter table public.inbox_settings enable row level security;
alter table public.inbox_conversation_state enable row level security;
revoke all on public.inbox_settings, public.inbox_conversation_state from anon, authenticated, service_role;
grant select on public.inbox_settings, public.inbox_conversation_state to authenticated, service_role;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'inbox_settings' and policyname = 'inbox_settings owner read') then
    create policy "inbox_settings owner read" on public.inbox_settings for select to authenticated
      using (exists (select 1 from public.profiles p where p.id = profile_id and p.user_id = auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'inbox_conversation_state' and policyname = 'inbox_conversation_state owner read') then
    create policy "inbox_conversation_state owner read" on public.inbox_conversation_state for select to authenticated
      using (exists (select 1 from public.profiles p where p.id = profile_id and p.user_id = auth.uid()));
  end if;
end $$;

commit;
