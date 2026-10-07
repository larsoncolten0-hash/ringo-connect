-- ============================================================================
-- Ringo Connect - Watchdog V1: the incident feed (watchdog_events)
--
-- REQUIRES OWNER APPROVAL AND MANUAL APPLICATION. Additive: one new table, one trigger, one index on admin_audit_log. No existing table, column, policy, function
-- or row is changed. Roll back with supabase/support/2026-10-07d_watchdog_events.rollback.sql and check it with
-- supabase/support/2026-10-07d_watchdog_events.verify.sql (read-only).
--
-- WHY A TABLE AT ALL (admin_audit_log could not carry this): Watchdog needs (1) an ATOMIC "have I already alerted for this incident?" - a unique dedupe key, so two
-- overlapping requests cannot both alert; (2) a status that moves open -> acknowledged -> resolved without deleting anything; (3) rows that application code
-- cannot rewrite after the fact. admin_audit_log has no unique key, no status, and its policy lets an admin update or delete rows.
--
-- WHAT IT STORES: a rule code (WD-001 ...), a severity, the audit action that raised it, the affected account id (a plain uuid, no foreign key, so the row
-- outlives the account), a small `params` object of counts / program / category / window, and a dedupe key. It does NOT store a message: the text is rendered from the
-- rule code and params, in English or French, when it is shown. By construction nothing here can hold a phone number, an email, a destination, a token or a
-- provider payload: the application only ever writes allow-listed enum and number values into params, and the table caps params at 2000 bytes.
--
-- WHO CAN DO WHAT
--   read    : platform admins only (RLS). Nobody else, including the affected account holder, can read a row.
--   create  : the service role only (no INSERT policy, no INSERT grant for anon / authenticated): an ordinary user cannot manufacture a Watchdog incident.
--   update  : the service role only, and ONLY the status fields (status, acknowledged_*, resolved_*): a trigger refuses any change to the rest of the row, refuses to
--             reopen a resolved incident, and refuses DELETE for every role including the service role.
-- ============================================================================

create table if not exists public.watchdog_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  rule_code text not null check (rule_code ~ '^WD-[0-9]{3}$'),
  severity text not null check (severity in ('medium', 'high')),
  event_type text not null check (char_length(event_type) between 1 and 80),
  subject_user_id uuid,
  params jsonb not null default '{}'::jsonb check (jsonb_typeof(params) = 'object' and pg_column_size(params) <= 2000),
  dedupe_key text not null unique check (char_length(dedupe_key) between 1 and 200),
  status text not null default 'open' check (status in ('open', 'acknowledged', 'resolved')),
  acknowledged_at timestamptz,
  acknowledged_by uuid,
  resolved_at timestamptz,
  resolved_by uuid
);

create index if not exists watchdog_events_status_created_idx on public.watchdog_events (status, created_at desc);

-- Watchdog counts recent audit rows per action (+ account): this keeps those lookups cheap as the audit log grows.
create index if not exists admin_audit_log_action_target_created_idx on public.admin_audit_log (action, target_user_id, created_at desc);

alter table public.watchdog_events enable row level security;

drop policy if exists "watchdog_events admin read" on public.watchdog_events;
create policy "watchdog_events admin read" on public.watchdog_events for select to authenticated using (public.is_admin());

-- Supabase's defaults grant ALL on new public tables to anon / authenticated / service_role: take everything away, then give back exactly what is needed.
revoke all on public.watchdog_events from public, anon, authenticated;
grant select on public.watchdog_events to authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'revoke all on public.watchdog_events from service_role';
    execute 'grant select, insert, update on public.watchdog_events to service_role';
  end if;
end $$;

-- An incident record is append-only apart from its status. Fires for EVERY writer, including the service role.
create or replace function public.watchdog_events_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'watchdog_events: incidents are never deleted' using errcode = '42501';
  end if;
  if new.id is distinct from old.id or new.created_at is distinct from old.created_at or new.rule_code is distinct from old.rule_code
     or new.severity is distinct from old.severity or new.event_type is distinct from old.event_type or new.subject_user_id is distinct from old.subject_user_id
     or new.params is distinct from old.params or new.dedupe_key is distinct from old.dedupe_key then
    raise exception 'watchdog_events: only the status fields can change' using errcode = '42501';
  end if;
  if old.status = 'resolved' and new.status is distinct from 'resolved' then
    raise exception 'watchdog_events: a resolved incident cannot be reopened' using errcode = '42501';
  end if;
  if old.status = 'resolved' and (new.resolved_at is distinct from old.resolved_at or new.resolved_by is distinct from old.resolved_by
     or new.acknowledged_at is distinct from old.acknowledged_at or new.acknowledged_by is distinct from old.acknowledged_by) then
    raise exception 'watchdog_events: a resolved incident is final' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.watchdog_events_guard() from public, anon, authenticated, service_role;

drop trigger if exists watchdog_events_guard_trg on public.watchdog_events;
create trigger watchdog_events_guard_trg before update or delete on public.watchdog_events
  for each row execute function public.watchdog_events_guard();

-- Postconditions (structure only: this migration writes no row).
do $$
begin
  if not exists (select 1 from pg_class c where c.oid = 'public.watchdog_events'::regclass and c.relrowsecurity) then
    raise exception 'postcondition failed: RLS is not enabled on watchdog_events';
  end if;
  if has_table_privilege('anon', 'public.watchdog_events', 'SELECT') or has_table_privilege('anon', 'public.watchdog_events', 'INSERT')
     or has_table_privilege('authenticated', 'public.watchdog_events', 'INSERT') or has_table_privilege('authenticated', 'public.watchdog_events', 'UPDATE')
     or has_table_privilege('authenticated', 'public.watchdog_events', 'DELETE') then
    raise exception 'postcondition failed: an API role has more access to watchdog_events than read-by-admin';
  end if;
  if not exists (select 1 from pg_trigger g where g.tgrelid = 'public.watchdog_events'::regclass and g.tgname = 'watchdog_events_guard_trg' and g.tgenabled = 'O' and not g.tgisinternal) then
    raise exception 'postcondition failed: watchdog_events_guard_trg is missing or disabled';
  end if;
end $$;
