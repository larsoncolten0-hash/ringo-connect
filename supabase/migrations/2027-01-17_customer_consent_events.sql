-- Customer marketing consent, Phase 3A: an append-only consent ledger and its one writer — PROPOSED, NOT APPLIED. FOR OWNER REVIEW ONLY.
--
-- A Ringo customer (a My Ringo visitor) who is CONNECTED to a profile (any category, a church included) may agree to marketing updates from it, SEPARATELY for each channel (email, push), and may
-- withdraw at any time. This file adds the record of those decisions. It sends nothing and changes no message flow.
--
--   NEW  public.customer_consent_events     one row per decision: who (customer), which profile/organization, which channel, granted or revoked, where it was made (source) and which notice text was
--                                           shown (notice_version). APPEND-ONLY: no UPDATE and no DELETE is possible for any API role, and a direct DELETE is refused even for the table owner;
--                                           only the removal of the customer or the profile itself (foreign-key cascade) removes rows.
--   NEW  function customer_consent_set(...) the ONLY writer. Service role only. In ONE transaction it takes a lock for (customer, profile, channel), checks the connection, appends the event and,
--                                           for the email channel, keeps customer_connections.marketing_consent / marketing_consent_at in step with it. Granting needs an ACTIVE connection;
--                                           withdrawing never does. A repeated request that changes nothing appends nothing.
--
-- WHAT THIS DOES NOT DO: it fabricates no history. The marketing_consent = true rows that exist today stay exactly as they are (their timestamps untouched) and are treated as LEGACY consent by the
-- application: still revocable, and never able to override a later withdrawal. No ledger row is written for them. It does not touch customer_connections, community_subscribers or
-- community_subscription_preferences structurally; the only existing data it ever writes is the two consent columns of the ONE connection a decision is about. Transactional notifications (orders,
-- bookings, loyalty progress), church membership, giving and attendance are not consent and are not read here. There is no WhatsApp channel.
--
-- PRIVACY: closed to every API role (RLS on, no policy, no privilege). Only the service role - the My Ringo routes after they verified the visitor's cookie, and the Community unsubscribe route after it
-- verified the unsubscribe token - can read or append. Church staff and creators cannot read it.
--
-- SELF-VERIFYING, one transaction: preconditions first, postconditions last. Any RAISE rolls everything back. Re-runnable.
--
-- Depends on: 2026-10-17_ringo_customers_core.sql (ringo_customers, customer_connections incl. marketing_consent / marketing_consent_at), profiles.
-- Verify (read-only, run AFTER): supabase/support/2027-01-17_customer_consent_events.verify.sql
-- Rollback: supabase/support/2027-01-17_customer_consent_events.rollback.sql (refuses to run while any row exists unless data loss is explicitly confirmed).
-- APPLY THIS BEFORE deploying the application code that calls it: without it, granting consent is refused (fail closed) and withdrawing falls back to clearing the live flags only.

begin;

set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- 0. PRECONDITIONS
-- ----------------------------------------------------------------------------
do $$
declare
  v_marker constant text := 'managed by 2027-01-17_customer_consent_events.sql';
  v_missing text;
  v_have boolean := to_regclass('public.customer_consent_events') is not null;
begin
  select string_agg(t, ', ') into v_missing from unnest(array['profiles', 'ringo_customers', 'customer_connections']) t where to_regclass('public.' || t) is null;
  if v_missing is not null then raise exception 'precondition failed: missing tables: %', v_missing; end if;

  select string_agg(c, ', ') into v_missing from unnest(array['marketing_consent', 'marketing_consent_at', 'status', 'customer_id', 'profile_id']) c
   where not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'customer_connections' and column_name = c);
  if v_missing is not null then raise exception 'precondition failed: public.customer_connections is missing columns: %', v_missing; end if;

  select string_agg(r, ', ') into v_missing from unnest(array['anon', 'authenticated', 'service_role']) r where not exists (select 1 from pg_roles where rolname = r);
  if v_missing is not null then raise exception 'precondition failed: missing database roles: %', v_missing; end if;

  if v_have and coalesce(obj_description(to_regclass('public.customer_consent_events'), 'pg_class'), '') <> v_marker then
    raise exception 'precondition failed: public.customer_consent_events already exists and is not managed by this migration; refusing to adopt or re-mark it';
  end if;
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('customer_consent_set', 'customer_consent_events_immutable', 'customer_consent_events_no_truncate')
               and (not v_have or coalesce(obj_description(p.oid, 'pg_proc'), '') <> v_marker)) then
    raise exception 'precondition failed: a function named like one of this file''s exists and is not managed by it';
  end if;

  perform set_config('customer_consent_events.pre', jsonb_build_object(
    'connections', (select count(*) from public.customer_connections),
    'consenting',  (select count(*) from public.customer_connections where marketing_consent),
    'stamps',      (select coalesce(md5(string_agg(id::text || coalesce(marketing_consent_at::text, '-'), ',' order by id)), '') from public.customer_connections where marketing_consent)
  )::text, true);
end $$;

-- ----------------------------------------------------------------------------
-- 1. TABLE
-- ----------------------------------------------------------------------------
create table if not exists public.customer_consent_events (
  -- strict order of decisions (clock values can tie); the uuid is the stable public identity of a row
  seq bigint generated always as identity,
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.ringo_customers(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  purpose text not null default 'marketing_updates',
  channel text not null,
  action text not null,
  -- where the decision was made: the Stay Connected form, the My Ringo toggle, the Community unsubscribe link, the Community preferences page, or the reset that a reconnect performs
  source text not null,
  -- which wording of the consent text the person saw (1 = the first version)
  notice_version smallint not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  constraint customer_consent_events_purpose_check check (purpose = 'marketing_updates'),
  constraint customer_consent_events_channel_check check (channel in ('email', 'push')),
  constraint customer_consent_events_action_check check (action in ('granted', 'revoked')),
  constraint customer_consent_events_source_check check (source in ('connect_form', 'my_ringo', 'community_unsubscribe', 'community_manage', 'reconnect_reset')),
  constraint customer_consent_events_notice_check check (notice_version between 1 and 1000)
);
create unique index if not exists customer_consent_events_seq_key on public.customer_consent_events (seq);
create index if not exists customer_consent_events_lookup_idx on public.customer_consent_events (customer_id, profile_id, channel, seq desc);

comment on table public.customer_consent_events is 'managed by 2027-01-17_customer_consent_events.sql';

-- ----------------------------------------------------------------------------
-- 2. FUNCTIONS
-- ----------------------------------------------------------------------------
-- Append-only for everyone: an UPDATE is always refused; a DELETE is refused unless it is the cascade of removing the customer or the profile (depth 2: the foreign-key trigger fired this one).
create or replace function public.customer_consent_events_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() >= 2 then
    return old;
  end if;
  raise exception 'consent_ledger_append_only' using errcode = '42501', detail = 'consent decisions are never edited or deleted';
end;
$$;
comment on function public.customer_consent_events_immutable() is 'managed by 2027-01-17_customer_consent_events.sql';
revoke all on function public.customer_consent_events_immutable() from public, anon, authenticated;

drop trigger if exists customer_consent_events_immutable_trg on public.customer_consent_events;
create trigger customer_consent_events_immutable_trg before update or delete on public.customer_consent_events for each row execute function public.customer_consent_events_immutable();
comment on trigger customer_consent_events_immutable_trg on public.customer_consent_events is 'managed by 2027-01-17_customer_consent_events.sql';

-- TRUNCATE is refused for everyone, too (it would empty the ledger without firing the row trigger above).
create or replace function public.customer_consent_events_no_truncate()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  raise exception 'consent_ledger_append_only' using errcode = '42501', detail = 'the consent ledger is never emptied';
end;
$$;
comment on function public.customer_consent_events_no_truncate() is 'managed by 2027-01-17_customer_consent_events.sql';
revoke all on function public.customer_consent_events_no_truncate() from public, anon, authenticated;

drop trigger if exists customer_consent_events_no_truncate_trg on public.customer_consent_events;
create trigger customer_consent_events_no_truncate_trg before truncate on public.customer_consent_events for each statement execute function public.customer_consent_events_no_truncate();
comment on trigger customer_consent_events_no_truncate_trg on public.customer_consent_events is 'managed by 2027-01-17_customer_consent_events.sql';

-- The one writer. Returns whether a row was appended (false = the decision was already in force).
create or replace function public.customer_consent_set(p_customer uuid, p_profile uuid, p_channel text, p_action text, p_source text)
returns table (out_changed boolean, out_event_id uuid)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_conn record;
  v_last text;
  v_id uuid;
begin
  if p_customer is null or p_profile is null then raise exception 'consent_invalid' using errcode = '22023'; end if;
  if p_channel is null or p_channel not in ('email', 'push') then raise exception 'consent_invalid_channel' using errcode = '22023'; end if;
  if p_action is null or p_action not in ('granted', 'revoked') then raise exception 'consent_invalid_action' using errcode = '22023'; end if;
  if p_source is null or p_source not in ('connect_form', 'my_ringo', 'community_unsubscribe', 'community_manage', 'reconnect_reset') then raise exception 'consent_invalid_source' using errcode = '22023'; end if;

  -- one decision at a time for this customer, profile and channel
  perform pg_advisory_xact_lock(hashtextextended('customer_consent:' || p_customer::text || ':' || p_profile::text || ':' || p_channel, 0));

  select id, status, marketing_consent into v_conn from public.customer_connections where customer_id = p_customer and profile_id = p_profile for update;
  if not found then
    -- nothing was ever agreed with this profile, so there is nothing to withdraw; but nobody can agree without connecting first
    if p_action = 'revoked' then
      out_changed := false; out_event_id := null; return next; return;
    end if;
    raise exception 'consent_not_connected' using errcode = 'P0001';
  end if;
  if p_action = 'granted' and v_conn.status <> 'active' then raise exception 'consent_not_connected' using errcode = 'P0001'; end if;

  select e.action into v_last from public.customer_consent_events e
   where e.customer_id = p_customer and e.profile_id = p_profile and e.channel = p_channel order by e.seq desc limit 1;

  -- already in force: no new row (the email flag must agree, too, or this is a repair and is recorded)
  if p_action = 'granted' and v_last = 'granted' and (p_channel = 'push' or v_conn.marketing_consent) then
    out_changed := false; out_event_id := null; return next; return;
  end if;
  if p_action = 'revoked' and v_last = 'revoked' and (p_channel = 'push' or not v_conn.marketing_consent) then
    out_changed := false; out_event_id := null; return next; return;
  end if;

  insert into public.customer_consent_events (customer_id, profile_id, channel, action, source)
  values (p_customer, p_profile, p_channel, p_action, p_source) returning id into v_id;

  if p_channel = 'email' then
    if p_action = 'granted' then
      -- an existing legacy timestamp is kept
      update public.customer_connections
         set marketing_consent = true, marketing_consent_at = coalesce(marketing_consent_at, now()), updated_at = now()
       where id = v_conn.id;
    else
      update public.customer_connections
         set marketing_consent = false, marketing_consent_at = null, updated_at = now()
       where id = v_conn.id;
    end if;
  end if;

  out_changed := true; out_event_id := v_id; return next;
end;
$$;
comment on function public.customer_consent_set(uuid, uuid, text, text, text) is 'managed by 2027-01-17_customer_consent_events.sql';
revoke all on function public.customer_consent_set(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.customer_consent_set(uuid, uuid, text, text, text) to service_role;

-- ----------------------------------------------------------------------------
-- 3. ROW-LEVEL SECURITY AND PRIVILEGES: closed to every API role; the service role reads and appends only
-- ----------------------------------------------------------------------------
alter table public.customer_consent_events enable row level security;
revoke all on public.customer_consent_events from public, anon, authenticated, service_role;
grant select, insert on public.customer_consent_events to service_role;

-- ----------------------------------------------------------------------------
-- 4. POSTCONDITIONS (any failure rolls the whole file back)
-- ----------------------------------------------------------------------------
do $$
declare
  v_pre jsonb := current_setting('customer_consent_events.pre')::jsonb;
  v_marker constant text := 'managed by 2027-01-17_customer_consent_events.sql';
  v_r text;
begin
  if coalesce(obj_description(to_regclass('public.customer_consent_events'), 'pg_class'), '') <> v_marker then raise exception 'postcondition failed: table marker'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.customer_consent_events'::regclass) then raise exception 'postcondition failed: row-level security is off'; end if;
  if exists (select 1 from pg_policy where polrelid = 'public.customer_consent_events'::regclass) then raise exception 'postcondition failed: the ledger must have no policy'; end if;

  foreach v_r in array array['public', 'anon', 'authenticated'] loop
    if has_table_privilege(v_r, 'public.customer_consent_events', 'select') or has_table_privilege(v_r, 'public.customer_consent_events', 'insert')
       or has_table_privilege(v_r, 'public.customer_consent_events', 'update') or has_table_privilege(v_r, 'public.customer_consent_events', 'delete')
       or has_any_column_privilege(v_r, 'public.customer_consent_events', 'select') or has_any_column_privilege(v_r, 'public.customer_consent_events', 'insert') then
      raise exception 'postcondition failed: % can reach the ledger', v_r;
    end if;
    if has_function_privilege(v_r, 'public.customer_consent_set(uuid, uuid, text, text, text)', 'execute') then raise exception 'postcondition failed: % can call the writer', v_r; end if;
  end loop;
  if not (has_table_privilege('service_role', 'public.customer_consent_events', 'select') and has_table_privilege('service_role', 'public.customer_consent_events', 'insert')) then
    raise exception 'postcondition failed: the service role cannot read and append';
  end if;
  if has_table_privilege('service_role', 'public.customer_consent_events', 'update') or has_table_privilege('service_role', 'public.customer_consent_events', 'delete') or has_table_privilege('service_role', 'public.customer_consent_events', 'truncate') then
    raise exception 'postcondition failed: the service role can edit, delete or truncate the ledger';
  end if;
  if not has_function_privilege('service_role', 'public.customer_consent_set(uuid, uuid, text, text, text)', 'execute') then raise exception 'postcondition failed: the service role cannot call the writer'; end if;
  if (select count(*) from pg_trigger where tgrelid = 'public.customer_consent_events'::regclass and not tgisinternal and tgname in ('customer_consent_events_immutable_trg', 'customer_consent_events_no_truncate_trg')) <> 2 then raise exception 'postcondition failed: append-only triggers'; end if;

  -- nothing existing changed: the same connections, the same consenting rows, the same legacy timestamps
  if (select count(*) from public.customer_connections) <> (v_pre->>'connections')::bigint
     or (select count(*) from public.customer_connections where marketing_consent) <> (v_pre->>'consenting')::bigint
     or (select coalesce(md5(string_agg(id::text || coalesce(marketing_consent_at::text, '-'), ',' order by id)), '') from public.customer_connections where marketing_consent) <> (v_pre->>'stamps') then
    raise exception 'postcondition failed: existing connections or legacy consent changed';
  end if;
end $$;

commit;
