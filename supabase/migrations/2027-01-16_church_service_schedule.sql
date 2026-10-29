-- Churches & Ministries: Recurring Weekly Services (database foundation) — PROPOSED, NOT APPLIED. FOR OWNER REVIEW ONLY.
--
-- Adds ONE table, public.church_service_schedule, and one guard trigger function. Nothing existing is changed: no table, column, constraint, policy, trigger or function of Phase 0, 2A, 3-8, the
-- expansion phases, Team or anything else is altered, and no row is read or written. It CALLS (never modifies) the Phase 2A helpers is_church_profile(), church_is_owner() and
-- church_has_permission(), and the platform's is_admin().
--
--   NEW  public.church_service_schedule   a church's REGULAR weekly services, stored ONCE: weekday + local start/end time + the church's own IANA timezone
--   NEW  function church_service_schedule_guard()
--
-- WHY A NEW TABLE (and not ministry_events): ministry_events holds dated, one-off events (event_date). A weekly service stored there would need a copy every week, for ever, and attendance
-- and past records would be mixed with generated rows. This table holds the RULE; every dated occurrence (a real service day, with its countdown and status) is COMPUTED on demand from it
-- (src/lib/church/schedule/occurrences.ts) and is never stored. An occurrence is identified by (id, local date): the planned attendance feature can attach to that pair without any occurrence
-- row existing. ministry_events and ministry_attendance are not touched.
--
-- HISTORY IS NEVER DELETED: a service that is no longer held is ARCHIVED (archived_at), not deleted. No API role has DELETE on the table, so a row, and every future attendance record that
-- references it, can never be removed by a church user. A service can also be switched off (is_enabled = false) and back on without losing anything.
--
-- WHAT THE DATABASE REFUSES (for every writer, the service role included): a weekday outside 0-6 (0 = Sunday); an end time that is not after the start time (a service runs within one day);
-- a timezone the database does not know; no title in either language, or a title over 80 / a description over 400 / a location over 160 characters; more than 30 services per church that are
-- not archived; any service for a profile that is not a church; moving a service to another church.
--
-- ROW-LEVEL SECURITY
--   * staff read:   church.events.view, church.events.manage or church.events.publish (the same people who read the events), their own church only
--   * staff write:  church.events.publish. A weekly service goes on the public page as soon as it is enabled, so it needs the same permission as publishing an event.
--   * public read:  enabled, non-archived services of a PUBLISHED church profile; the audit columns are not readable by any API role
--   * RESTRICTIVE policies on insert / update refuse a platform admin who is not the church's owner. There is no DELETE policy and no DELETE privilege.
--
-- NO NEW PERMISSION STRING: church.events.* already exists, so no Phase 2A object changes and no role needs editing.
-- SELF-VERIFYING, one transaction: preconditions first, postconditions last. Any RAISE rolls everything back. Re-runnable.
--
-- Depends on: 2026-12-27_church_people_groups.sql (is_church_profile, church_is_owner, church_has_permission), is_admin().
-- Verify (read-only, run AFTER): supabase/support/2027-01-16_church_service_schedule.verify.sql
-- Rollback: supabase/support/2027-01-16_church_service_schedule.rollback.sql (refuses to run while any row exists unless data loss is explicitly confirmed).

begin;

set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- 0. PRECONDITIONS + a snapshot of the objects this file must leave untouched
-- ----------------------------------------------------------------------------
do $$
declare
  v_marker constant text := 'managed by 2027-01-16_church_service_schedule.sql';
  v_missing text;
  v_bad text;
  v_have boolean := to_regclass('public.church_service_schedule') is not null;
begin
  select string_agg(t, ', ') into v_missing from unnest(array['profiles', 'users']) t where to_regclass('public.' || t) is null;
  if v_missing is not null then raise exception 'precondition failed: missing tables: %', v_missing; end if;

  select string_agg(f, ', ') into v_missing
    from unnest(array['public.is_admin()', 'public.is_church_profile(uuid)', 'public.church_is_owner(uuid)', 'public.church_has_permission(uuid, text)']) f
   where to_regprocedure(f) is null;
  if v_missing is not null then raise exception 'precondition failed: missing functions (is Phase 2A applied?): %', v_missing; end if;

  select string_agg(c, ', ') into v_missing from unnest(array['published']) c
   where not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = c);
  if v_missing is not null then raise exception 'precondition failed: public.profiles is missing columns: %', v_missing; end if;

  select string_agg(r, ', ') into v_missing from unnest(array['anon', 'authenticated', 'service_role']) r where not exists (select 1 from pg_roles where rolname = r);
  if v_missing is not null then raise exception 'precondition failed: missing database roles: %', v_missing; end if;

  select string_agg(p.oid::regprocedure::text, ', ') into v_bad from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname in ('is_church_profile', 'church_is_owner', 'church_has_permission')
     and coalesce(obj_description(p.oid, 'pg_proc'), '') <> 'managed by 2026-12-27_church_people_groups.sql';
  if v_bad is not null then raise exception 'precondition failed: % is not managed by the Phase 2A migration', v_bad; end if;

  if v_have and coalesce(obj_description(to_regclass('public.church_service_schedule'), 'pg_class'), '') <> v_marker then
    raise exception 'precondition failed: public.church_service_schedule already exists and is not managed by this migration; refusing to adopt or re-mark it';
  end if;
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'church_service_schedule_guard' and (not v_have or coalesce(obj_description(p.oid, 'pg_proc'), '') <> v_marker);
  if v_bad is not null then raise exception 'precondition failed: a function with this file''s name already exists and is not managed by it: %', v_bad; end if;
  if not v_have then
    select string_agg(c.relname, ', ') into v_bad from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname like 'church\_service\_schedule%';
    if v_bad is not null then raise exception 'precondition failed: relations named church_service_schedule* already exist: %', v_bad; end if;
  end if;

  perform set_config('church_service_schedule.pre', jsonb_build_object(
    'profiles',     (select count(*) from public.profiles),
    'users',        (select count(*) from public.users),
    'policies',     (select coalesce(jsonb_agg(p.polname order by p.polrelid::regclass::text, p.polname), '[]'::jsonb)
                       from pg_policy p where p.polrelid in ('public.profiles'::regclass, 'public.organization_roles'::regclass, 'public.organization_members'::regclass)
                          or p.polrelid = to_regclass('public.ministry_events') or p.polrelid = to_regclass('public.ministry_announcements') or p.polrelid = to_regclass('public.ministry_attendance')),
    'fn_defs',      (select jsonb_object_agg(f.proname, md5(pg_get_functiondef(f.oid)))
                       from pg_proc f where f.pronamespace = 'public'::regnamespace
                        and (f.proname like 'church\_%' or f.proname like 'team\_church\_%' or f.proname like 'ministry\_%'
                             or f.proname in ('is_admin', 'has_org_permission', 'is_org_member', 'is_church_profile')) and f.proname <> 'church_service_schedule_guard')
  )::text, true);
end $$;

-- ----------------------------------------------------------------------------
-- 1. TABLE
-- ----------------------------------------------------------------------------
create table if not exists public.church_service_schedule (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  -- the service name in each language the church writes it in (at least one)
  title_en text,
  title_fr text,
  description_en text,
  description_fr text,
  -- where it is held, when that differs from the church's address (free text)
  location text,
  -- 0 = Sunday ... 6 = Saturday (the numbering of src/lib/church/week.ts)
  weekday smallint not null,
  -- LOCAL wall-clock times in the service's own timezone; a service runs inside one day
  start_time time not null,
  end_time time not null,
  -- IANA identifier ("Africa/Douala", "Europe/Paris"); never assumed, chosen per service
  timezone text not null,
  is_enabled boolean not null default true,
  -- set instead of deleting; an archived service is no longer shown or counted, and nothing that references it is lost
  archived_at timestamptz,
  -- audit columns: filled by church_service_schedule_guard from auth.uid(); NOT readable or writable by any API role
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint church_service_schedule_weekday_check check (weekday between 0 and 6),
  constraint church_service_schedule_time_check check (end_time > start_time),
  constraint church_service_schedule_title_check check (
    (title_en is not null and char_length(btrim(title_en)) between 1 and 80) or (title_fr is not null and char_length(btrim(title_fr)) between 1 and 80)),
  constraint church_service_schedule_title_len_check check (
    (title_en is null or char_length(title_en) <= 80) and (title_fr is null or char_length(title_fr) <= 80)),
  constraint church_service_schedule_description_check check (
    (description_en is null or char_length(description_en) <= 400) and (description_fr is null or char_length(description_fr) <= 400)),
  constraint church_service_schedule_location_check check (location is null or char_length(location) <= 160),
  constraint church_service_schedule_timezone_check check (char_length(timezone) between 1 and 64 and timezone ~ '^[A-Za-z0-9_+/-]+$')
);
create index if not exists church_service_schedule_profile_idx on public.church_service_schedule (profile_id, weekday, start_time);

comment on table public.church_service_schedule is 'managed by 2027-01-16_church_service_schedule.sql';

-- ----------------------------------------------------------------------------
-- 2. FUNCTION
-- ----------------------------------------------------------------------------
-- Integrity and bookkeeping for every writer (the service role included): only a church profile, the church never changes, a timezone the database knows, at most 30 live services per church,
-- and the audit columns come from the authenticated caller (a value supplied by a client is overwritten).
create or replace function public.church_service_schedule_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if not public.is_church_profile(new.profile_id) then
      raise exception 'schedule_profile_required' using errcode = '23514', detail = 'services can only be added to a profile with the Churches & Ministries category';
    end if;
  else
    if new.profile_id is distinct from old.profile_id then
      raise exception 'schedule_tenant_immutable' using errcode = '42501', detail = 'a service can never be moved to another church';
    end if;
  end if;

  -- the timezone must be one the database knows (this raises for an unknown identifier)
  begin
    perform now() at time zone new.timezone;
  exception when others then
    raise exception 'schedule_timezone_invalid' using errcode = '23514', detail = 'the timezone is not a known IANA identifier';
  end;

  if new.archived_at is null and (tg_op = 'INSERT' or old.archived_at is not null) then
    -- serialise concurrent writes for ONE church so two simultaneous requests cannot both pass the count below
    perform pg_advisory_xact_lock(hashtextextended('church_service_schedule:' || new.profile_id::text, 0));
    if (select count(*) from public.church_service_schedule s where s.profile_id = new.profile_id and s.archived_at is null and s.id is distinct from new.id) >= 30 then
      raise exception 'schedule_limit' using errcode = '23514', detail = 'a church holds at most 30 weekly services';
    end if;
  end if;

  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.created_by := auth.uid();
      new.updated_by := auth.uid();
    end if;
  else
    if auth.uid() is not null then
      new.created_by := old.created_by;
      new.updated_by := auth.uid();
    end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

comment on function public.church_service_schedule_guard() is 'managed by 2027-01-16_church_service_schedule.sql';
revoke all on function public.church_service_schedule_guard() from public, anon, authenticated;

drop trigger if exists church_service_schedule_guard_trg on public.church_service_schedule;
create trigger church_service_schedule_guard_trg before insert or update on public.church_service_schedule for each row execute function public.church_service_schedule_guard();
comment on trigger church_service_schedule_guard_trg on public.church_service_schedule is 'managed by 2027-01-16_church_service_schedule.sql';

-- ----------------------------------------------------------------------------
-- 3. ROW-LEVEL SECURITY AND PRIVILEGES
-- ----------------------------------------------------------------------------
alter table public.church_service_schedule enable row level security;

revoke all on public.church_service_schedule from public, anon, authenticated;
-- READ: only the content columns (never the audit columns), for anon and signed-in users alike; the policies decide which ROWS.
grant select (id, profile_id, title_en, title_fr, description_en, description_fr, location, weekday, start_time, end_time, timezone, is_enabled, archived_at, created_at, updated_at) on public.church_service_schedule to anon, authenticated;
-- WRITE (signed-in users only): content columns; profile_id only on insert. No DELETE, TRUNCATE, REFERENCES or TRIGGER: a service is archived, never deleted.
grant insert (id, profile_id, title_en, title_fr, description_en, description_fr, location, weekday, start_time, end_time, timezone, is_enabled) on public.church_service_schedule to authenticated;
grant update (title_en, title_fr, description_en, description_fr, location, weekday, start_time, end_time, timezone, is_enabled, archived_at) on public.church_service_schedule to authenticated;
grant all on public.church_service_schedule to service_role;

drop policy if exists church_service_schedule_staff_select on public.church_service_schedule;
create policy church_service_schedule_staff_select on public.church_service_schedule for select to authenticated
  using (public.church_has_permission(profile_id, 'church.events.view') or public.church_has_permission(profile_id, 'church.events.manage') or public.church_has_permission(profile_id, 'church.events.publish'));

drop policy if exists church_service_schedule_public_select on public.church_service_schedule;
create policy church_service_schedule_public_select on public.church_service_schedule for select to anon, authenticated
  using (is_enabled = true and archived_at is null and exists (select 1 from public.profiles p where p.id = profile_id and p.published = true));

drop policy if exists church_service_schedule_insert on public.church_service_schedule;
create policy church_service_schedule_insert on public.church_service_schedule for insert to authenticated
  with check (public.church_has_permission(profile_id, 'church.events.publish'));
drop policy if exists church_service_schedule_update on public.church_service_schedule;
create policy church_service_schedule_update on public.church_service_schedule for update to authenticated
  using (public.church_has_permission(profile_id, 'church.events.publish'))
  with check (public.church_has_permission(profile_id, 'church.events.publish'));

drop policy if exists church_service_schedule_no_platform_admin_insert on public.church_service_schedule;
create policy church_service_schedule_no_platform_admin_insert on public.church_service_schedule as restrictive for insert to authenticated
  with check (not public.is_admin() or public.church_is_owner(profile_id));
drop policy if exists church_service_schedule_no_platform_admin_update on public.church_service_schedule;
create policy church_service_schedule_no_platform_admin_update on public.church_service_schedule as restrictive for update to authenticated
  using (not public.is_admin() or public.church_is_owner(profile_id))
  with check (not public.is_admin() or public.church_is_owner(profile_id));

-- ----------------------------------------------------------------------------
-- 4. POSTCONDITIONS (any failure rolls the whole file back)
-- ----------------------------------------------------------------------------
do $$
declare
  v_pre jsonb := current_setting('church_service_schedule.pre')::jsonb;
  v_marker constant text := 'managed by 2027-01-16_church_service_schedule.sql';
  v_n int;
  v_bad text;
begin
  if coalesce(obj_description(to_regclass('public.church_service_schedule'), 'pg_class'), '') <> v_marker then raise exception 'postcondition failed: table marker'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.church_service_schedule'::regclass) then raise exception 'postcondition failed: row-level security is off'; end if;

  if has_table_privilege('public', 'public.church_service_schedule', 'select') or has_table_privilege('public', 'public.church_service_schedule', 'insert') then raise exception 'postcondition failed: PUBLIC has a table privilege'; end if;
  if has_table_privilege('anon', 'public.church_service_schedule', 'select') or has_table_privilege('anon', 'public.church_service_schedule', 'insert') or has_table_privilege('anon', 'public.church_service_schedule', 'update') or has_table_privilege('anon', 'public.church_service_schedule', 'delete') then
    raise exception 'postcondition failed: anon has a TABLE-level privilege (it must have column SELECT only)';
  end if;
  if has_table_privilege('authenticated', 'public.church_service_schedule', 'delete') or has_table_privilege('authenticated', 'public.church_service_schedule', 'truncate') or has_table_privilege('authenticated', 'public.church_service_schedule', 'references') or has_table_privilege('authenticated', 'public.church_service_schedule', 'trigger') then
    raise exception 'postcondition failed: authenticated can delete, truncate, reference or trigger';
  end if;
  select string_agg(r || '.' || c || '.' || k, ', ') into v_bad
    from unnest(array['anon', 'authenticated']) r, unnest(array['created_by', 'updated_by']) c, unnest(array['select', 'insert', 'update']) k
   where has_column_privilege(r, 'public.church_service_schedule', c, k);
  if v_bad is not null then raise exception 'postcondition failed: audit column reachable: %', v_bad; end if;
  if has_any_column_privilege('anon', 'public.church_service_schedule', 'insert') or has_any_column_privilege('anon', 'public.church_service_schedule', 'update') then raise exception 'postcondition failed: anon can write'; end if;
  if not has_column_privilege('anon', 'public.church_service_schedule', 'start_time', 'select') then raise exception 'postcondition failed: anon cannot read the public columns'; end if;
  if has_column_privilege('authenticated', 'public.church_service_schedule', 'profile_id', 'update') then raise exception 'postcondition failed: profile_id is updatable'; end if;
  if has_function_privilege('anon', 'public.church_service_schedule_guard()', 'execute') or has_function_privilege('authenticated', 'public.church_service_schedule_guard()', 'execute') or has_function_privilege('public', 'public.church_service_schedule_guard()', 'execute') then
    raise exception 'postcondition failed: the guard is callable';
  end if;

  select count(*) into v_n from pg_policy where polrelid = 'public.church_service_schedule'::regclass and polpermissive;
  if v_n <> 4 then raise exception 'postcondition failed: expected 4 permissive policies, found %', v_n; end if;
  select count(*) into v_n from pg_policy where polrelid = 'public.church_service_schedule'::regclass and not polpermissive;
  if v_n <> 2 then raise exception 'postcondition failed: expected 2 restrictive policies, found %', v_n; end if;
  select count(*) into v_n from pg_policy where polrelid = 'public.church_service_schedule'::regclass and polroles = array[0::oid];
  if v_n <> 0 then raise exception 'postcondition failed: a policy applies to PUBLIC'; end if;
  select count(*) into v_n from pg_trigger where tgrelid = 'public.church_service_schedule'::regclass and not tgisinternal and tgname = 'church_service_schedule_guard_trg';
  if v_n <> 1 then raise exception 'postcondition failed: guard trigger'; end if;

  -- nothing existing changed
  if (select count(*) from public.profiles) <> (v_pre->>'profiles')::bigint or (select count(*) from public.users) <> (v_pre->>'users')::bigint then
    raise exception 'postcondition failed: a row count of an existing table changed';
  end if;
  if (select coalesce(jsonb_agg(p.polname order by p.polrelid::regclass::text, p.polname), '[]'::jsonb)
        from pg_policy p where p.polrelid in ('public.profiles'::regclass, 'public.organization_roles'::regclass, 'public.organization_members'::regclass)
                           or p.polrelid = to_regclass('public.ministry_events') or p.polrelid = to_regclass('public.ministry_announcements') or p.polrelid = to_regclass('public.ministry_attendance')) is distinct from v_pre->'policies' then
    raise exception 'postcondition failed: a policy of an existing table changed';
  end if;
  if (select jsonb_object_agg(f.proname, md5(pg_get_functiondef(f.oid)))
        from pg_proc f where f.pronamespace = 'public'::regnamespace
         and (f.proname like 'church\_%' or f.proname like 'team\_church\_%' or f.proname like 'ministry\_%'
              or f.proname in ('is_admin', 'has_org_permission', 'is_org_member', 'is_church_profile')) and f.proname <> 'church_service_schedule_guard') is distinct from v_pre->'fn_defs' then
    raise exception 'postcondition failed: an existing function changed';
  end if;
end $$;

commit;
