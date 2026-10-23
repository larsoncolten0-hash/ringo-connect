-- Churches & Ministries Phase 7: Attendance (database foundation) — PROPOSED, NOT APPLIED. FOR OWNER REVIEW ONLY.
--
-- Adds TWO tables, public.ministry_attendance and public.ministry_attendance_counts, two guard trigger functions. Nothing existing is changed: no table, column, constraint, policy, trigger or
-- function of Phase 0, Phase 2A, Phase 3, Phase 4, Team or anything else is altered, and no row is read or written. It CALLS (never modifies) the Phase 2A helpers church_has_permission() and
-- church_is_owner(), the Phase 4 helper ministry_today(), and the platform's is_admin().
--
--   NEW  public.ministry_attendance          one row = one roster person present at one event of the SAME church
--   NEW  public.ministry_attendance_counts   one row per event: how many visitors and how many children were present (numbers only, no names)
--   NEW  functions ministry_attendance_guard(), ministry_attendance_counts_guard()
--
-- THE MODEL: attendance attaches to ministry_events (Phase 4), so there is ONE church event model. A person present is a roster record (church_members). Visitors who are not on the roster and
-- CHILDREN are counted, never named: a child's record (name, age group, guardian) is special-category data and the roster hides it behind its own permissions, so attendance does not copy it into a
-- second table. A person is recorded at most once per event (unique key). Nothing here is public: there is no anon access of any kind, and an attendance row is never joined into a public query.
--
-- WHAT THE DATABASE REFUSES (for every writer, the service role included): an event that is not published, is cancelled, or has not started yet (Africa/Douala calendar); a child; a person whose
-- roster status is not 'active'; a person or an event of another church (composite foreign keys); a second row for the same person and event; any change to a row (attendance is recorded or removed,
-- never edited). An event that has attendance cannot be deleted (NO ACTION foreign key): unpublish it instead.
--
-- PERMISSIONS (strings stored in organization_roles.permissions like every other permission; church_has_permission() already answers for any string)
--   church.attendance.view     read the attendance of the church's events
--   church.attendance.manage   record and remove attendance, set the visitor / children counts
--   The owner of a church implicitly holds both. The Phase 2A grant guards treat every church.* string they do not list as SENSITIVE (OWNER-ONLY to grant), so no Phase 2A object changes.
--   Recording also needs church.members.view in practice (the roster picker reads the roster); the database does not require it, because the roster rows are protected by their own policies.
--
-- ROW-LEVEL SECURITY
--   * read:   church.attendance.view or .manage (church_has_permission: owner, or an ACTIVE member whose role holds the string; never a platform admin who is not the owner)
--   * insert / delete (attendance), insert / update / delete (counts): church.attendance.manage
--   * RESTRICTIVE policies on every write refuse a platform admin who is not the church's owner
--   * no policy for PUBLIC or anon; every privilege is revoked from them. The recorder (recorded_by) is readable and writable by NO API role.
--
-- SELF-VERIFYING, one transaction: preconditions first, postconditions last. Any RAISE rolls everything back. Re-runnable.
--
-- Depends on: 2026-12-27_church_people_groups.sql (church_members, church_has_permission, church_is_owner), 2026-12-29_ministry_events_announcements.sql (ministry_events, ministry_today), is_admin().
-- Preflight (read-only, run BEFORE): supabase/support/2026-12-31_ministry_attendance.preflight.sql
-- Verify    (read-only, run AFTER):  supabase/support/2026-12-31_ministry_attendance.verify.sql
-- Rollback: supabase/support/2026-12-31_ministry_attendance.rollback.sql (refuses to run while any row exists unless data loss is explicitly confirmed).

begin;

set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- 0. PRECONDITIONS + a snapshot of the objects this file must leave untouched
-- ----------------------------------------------------------------------------
do $$
declare
  v_marker constant text := 'managed by 2026-12-31_ministry_attendance.sql';
  v_missing text;
  v_bad text;
  v_have int := (select count(*) from unnest(array['ministry_attendance', 'ministry_attendance_counts']) t where to_regclass('public.' || t) is not null);
begin
  select string_agg(t, ', ') into v_missing from unnest(array['profiles', 'users', 'church_members', 'ministry_events']) t where to_regclass('public.' || t) is null;
  if v_missing is not null then raise exception 'precondition failed: missing tables (are Phase 2A and Phase 4 applied?): %', v_missing; end if;

  select string_agg(f, ', ') into v_missing
    from unnest(array['public.is_admin()', 'public.church_is_owner(uuid)', 'public.church_has_permission(uuid, text)', 'public.ministry_today()']) f
   where to_regprocedure(f) is null;
  if v_missing is not null then raise exception 'precondition failed: missing functions (are Phase 2A and Phase 4 applied?): %', v_missing; end if;

  -- the composite keys the foreign keys point at
  select string_agg(k, ', ') into v_missing from unnest(array['church_members_id_profile_key', 'ministry_events_id_profile_key']) k
   where not exists (select 1 from pg_constraint where conname = k and contype = 'u');
  if v_missing is not null then raise exception 'precondition failed: missing unique keys: %', v_missing; end if;

  select string_agg(r, ', ') into v_missing from unnest(array['anon', 'authenticated', 'service_role']) r where not exists (select 1 from pg_roles where rolname = r);
  if v_missing is not null then raise exception 'precondition failed: missing database roles: %', v_missing; end if;

  -- the helpers must be the real ones (the marker proves they were created by those migrations)
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and ((p.proname in ('church_is_owner', 'church_has_permission') and coalesce(obj_description(p.oid, 'pg_proc'), '') <> 'managed by 2026-12-27_church_people_groups.sql')
       or (p.proname = 'ministry_today' and coalesce(obj_description(p.oid, 'pg_proc'), '') <> 'managed by 2026-12-29_ministry_events_announcements.sql'));
  if v_bad is not null then raise exception 'precondition failed: % is not managed by the migration that should own it', v_bad; end if;

  -- half-applied guard: either neither table exists (first run) or both do (re-run)
  if v_have not in (0, 2) then raise exception 'precondition failed: only % of the 2 attendance tables exist (half-applied state); resolve it before running this file', v_have; end if;
  if v_have = 2 then
    select string_agg(t, ', ') into v_bad from unnest(array['ministry_attendance', 'ministry_attendance_counts']) t where coalesce(obj_description(to_regclass('public.' || t), 'pg_class'), '') <> v_marker;
    if v_bad is not null then raise exception 'precondition failed: table(s) % already exist but are not managed by this migration; refusing to adopt or re-mark them', v_bad; end if;
  end if;
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname in ('ministry_attendance_guard', 'ministry_attendance_counts_guard')
     and (v_have = 0 or coalesce(obj_description(p.oid, 'pg_proc'), '') <> v_marker);
  if v_bad is not null then raise exception 'precondition failed: a function with one of this file''s names already exists and is not managed by it: %', v_bad; end if;
  if v_have = 0 then
    select string_agg(c.relname, ', ') into v_bad from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname like 'ministry\_attendance%';
    if v_bad is not null then raise exception 'precondition failed: relations named ministry_attendance* already exist: %', v_bad; end if;
  end if;

  perform set_config('ministry_attendance.pre', jsonb_build_object(
    'profiles',     (select count(*) from public.profiles),
    'members',      (select count(*) from public.church_members),
    'events',       (select count(*) from public.ministry_events),
    'policies',     (select coalesce(jsonb_agg(p.polname order by p.polrelid::regclass::text, p.polname), '[]'::jsonb)
                       from pg_policy p where p.polrelid in ('public.profiles'::regclass, 'public.organization_roles'::regclass, 'public.organization_members'::regclass,
                                                              'public.church_members'::regclass, 'public.church_groups'::regclass, 'public.church_group_members'::regclass, 'public.church_leadership'::regclass,
                                                              'public.ministry_events'::regclass)
                          or p.polrelid = to_regclass('public.ministry_announcements') or p.polrelid = to_regclass('public.daily_words')),
    'fn_defs',      (select jsonb_object_agg(f.proname, md5(pg_get_functiondef(f.oid)))
                       from pg_proc f where f.pronamespace = 'public'::regnamespace
                        and (f.proname like 'church\_%' or f.proname like 'team\_church\_%' or f.proname like 'daily\_word%' or f.proname in ('ministry_today', 'ministry_content_guard', 'is_admin', 'has_org_permission', 'is_org_member', 'is_church_profile')))
  )::text, true);
end $$;

-- ----------------------------------------------------------------------------
-- 1. TABLES
-- ----------------------------------------------------------------------------
create table if not exists public.ministry_attendance (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  event_id uuid not null,
  member_id uuid not null,
  -- who recorded it: filled by the guard from auth.uid(); NOT readable or writable by any API role
  recorded_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  -- composite keys: the event and the person can only ever be of the SAME church as the row.
  -- NO ACTION (checked after cascades): an event that has attendance cannot be deleted, but deleting the whole church (profile cascade) still works.
  constraint ministry_attendance_event_fk foreign key (event_id, profile_id) references public.ministry_events (id, profile_id),
  -- erasing a person from the roster erases their attendance with them
  constraint ministry_attendance_member_fk foreign key (member_id, profile_id) references public.church_members (id, profile_id) on delete cascade,
  -- a person is recorded at most once per event
  constraint ministry_attendance_event_member_key unique (event_id, member_id)
);
create index if not exists ministry_attendance_profile_event_idx on public.ministry_attendance (profile_id, event_id);
create index if not exists ministry_attendance_member_idx on public.ministry_attendance (member_id);

create table if not exists public.ministry_attendance_counts (
  event_id uuid primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  visitors integer not null default 0,
  children integer not null default 0,
  recorded_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ministry_attendance_counts_event_fk foreign key (event_id, profile_id) references public.ministry_events (id, profile_id),
  constraint ministry_attendance_counts_visitors_check check (visitors between 0 and 100000),
  constraint ministry_attendance_counts_children_check check (children between 0 and 100000)
);

comment on table public.ministry_attendance is 'managed by 2026-12-31_ministry_attendance.sql';
comment on table public.ministry_attendance_counts is 'managed by 2026-12-31_ministry_attendance.sql';

-- ----------------------------------------------------------------------------
-- 2. FUNCTIONS
-- ----------------------------------------------------------------------------
-- Attendance can be recorded only for a person who may be named (an active, non-child roster record) at an event that is live, not cancelled and already started (Africa/Douala calendar).
-- A row is never edited. The recorder comes from the authenticated caller. Applies to every writer, the service role included.
create or replace function public.ministry_attendance_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_event record;
  v_member record;
begin
  if tg_op = 'UPDATE' then
    raise exception 'attendance_immutable' using errcode = '42501', detail = 'attendance is recorded or removed, never edited';
  end if;

  select e.status, e.is_cancelled, e.event_date into v_event from public.ministry_events e where e.id = new.event_id and e.profile_id = new.profile_id;
  if not found then
    raise exception 'attendance_event_missing' using errcode = '23503', detail = 'no such event in this church';
  end if;
  if v_event.status <> 'published' then raise exception 'attendance_event_not_published' using errcode = '23514', detail = 'attendance can only be recorded for a published event'; end if;
  if v_event.is_cancelled then raise exception 'attendance_event_cancelled' using errcode = '23514', detail = 'a cancelled event has no attendance'; end if;
  if v_event.event_date > public.ministry_today() then raise exception 'attendance_event_not_started' using errcode = '23514', detail = 'attendance cannot be recorded before the day of the event'; end if;

  select m.age_group, m.status into v_member from public.church_members m where m.id = new.member_id and m.profile_id = new.profile_id;
  if not found then
    raise exception 'attendance_member_missing' using errcode = '23503', detail = 'no such person in this church';
  end if;
  if v_member.age_group = 'child' then raise exception 'attendance_child_not_allowed' using errcode = '23514', detail = 'children are counted, never named'; end if;
  if v_member.status <> 'active' then raise exception 'attendance_member_not_active' using errcode = '23514', detail = 'only an active person can be recorded present'; end if;

  if auth.uid() is not null then new.recorded_by := auth.uid(); end if;
  return new;
end;
$$;

-- The visitor and children counts follow the same event rules; the church and the event can never change; the recorder and updated_at are bookkept here.
create or replace function public.ministry_attendance_counts_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_event record;
begin
  if tg_op = 'UPDATE' and (new.profile_id is distinct from old.profile_id or new.event_id is distinct from old.event_id) then
    raise exception 'attendance_tenant_immutable' using errcode = '42501', detail = 'the church and the event of a count can never change';
  end if;

  select e.status, e.is_cancelled, e.event_date into v_event from public.ministry_events e where e.id = new.event_id and e.profile_id = new.profile_id;
  if not found then
    raise exception 'attendance_event_missing' using errcode = '23503', detail = 'no such event in this church';
  end if;
  if v_event.status <> 'published' then raise exception 'attendance_event_not_published' using errcode = '23514', detail = 'attendance can only be recorded for a published event'; end if;
  if v_event.is_cancelled then raise exception 'attendance_event_cancelled' using errcode = '23514', detail = 'a cancelled event has no attendance'; end if;
  if v_event.event_date > public.ministry_today() then raise exception 'attendance_event_not_started' using errcode = '23514', detail = 'attendance cannot be recorded before the day of the event'; end if;

  if auth.uid() is not null then new.recorded_by := auth.uid(); end if;
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  return new;
end;
$$;

comment on function public.ministry_attendance_guard() is 'managed by 2026-12-31_ministry_attendance.sql';
comment on function public.ministry_attendance_counts_guard() is 'managed by 2026-12-31_ministry_attendance.sql';

drop trigger if exists ministry_attendance_guard_trg on public.ministry_attendance;
create trigger ministry_attendance_guard_trg before insert or update on public.ministry_attendance for each row execute function public.ministry_attendance_guard();
comment on trigger ministry_attendance_guard_trg on public.ministry_attendance is 'managed by 2026-12-31_ministry_attendance.sql';
drop trigger if exists ministry_attendance_counts_guard_trg on public.ministry_attendance_counts;
create trigger ministry_attendance_counts_guard_trg before insert or update on public.ministry_attendance_counts for each row execute function public.ministry_attendance_counts_guard();
comment on trigger ministry_attendance_counts_guard_trg on public.ministry_attendance_counts is 'managed by 2026-12-31_ministry_attendance.sql';

-- ----------------------------------------------------------------------------
-- 3. ROW-LEVEL SECURITY AND PRIVILEGES
-- ----------------------------------------------------------------------------
alter table public.ministry_attendance enable row level security;
alter table public.ministry_attendance_counts enable row level security;

revoke all on public.ministry_attendance from public, anon, authenticated;
revoke all on public.ministry_attendance_counts from public, anon, authenticated;
-- signed-in users only, content columns only (never recorded_by); attendance rows have no UPDATE privilege at all.
grant select (id, profile_id, event_id, member_id, created_at) on public.ministry_attendance to authenticated;
grant insert (id, profile_id, event_id, member_id) on public.ministry_attendance to authenticated;
grant delete on public.ministry_attendance to authenticated;
grant select (event_id, profile_id, visitors, children, created_at, updated_at) on public.ministry_attendance_counts to authenticated;
grant insert (event_id, profile_id, visitors, children) on public.ministry_attendance_counts to authenticated;
grant update (visitors, children) on public.ministry_attendance_counts to authenticated;
grant delete on public.ministry_attendance_counts to authenticated;
grant all on public.ministry_attendance to service_role;
grant all on public.ministry_attendance_counts to service_role;

-- ministry_attendance
drop policy if exists ministry_attendance_select on public.ministry_attendance;
create policy ministry_attendance_select on public.ministry_attendance for select to authenticated
  using (public.church_has_permission(profile_id, 'church.attendance.view') or public.church_has_permission(profile_id, 'church.attendance.manage'));
drop policy if exists ministry_attendance_insert on public.ministry_attendance;
create policy ministry_attendance_insert on public.ministry_attendance for insert to authenticated
  with check (public.church_has_permission(profile_id, 'church.attendance.manage'));
drop policy if exists ministry_attendance_delete on public.ministry_attendance;
create policy ministry_attendance_delete on public.ministry_attendance for delete to authenticated
  using (public.church_has_permission(profile_id, 'church.attendance.manage'));
drop policy if exists ministry_attendance_no_platform_admin_insert on public.ministry_attendance;
create policy ministry_attendance_no_platform_admin_insert on public.ministry_attendance as restrictive for insert to authenticated
  with check (not public.is_admin() or public.church_is_owner(profile_id));
drop policy if exists ministry_attendance_no_platform_admin_delete on public.ministry_attendance;
create policy ministry_attendance_no_platform_admin_delete on public.ministry_attendance as restrictive for delete to authenticated
  using (not public.is_admin() or public.church_is_owner(profile_id));

-- ministry_attendance_counts
drop policy if exists ministry_attendance_counts_select on public.ministry_attendance_counts;
create policy ministry_attendance_counts_select on public.ministry_attendance_counts for select to authenticated
  using (public.church_has_permission(profile_id, 'church.attendance.view') or public.church_has_permission(profile_id, 'church.attendance.manage'));
drop policy if exists ministry_attendance_counts_insert on public.ministry_attendance_counts;
create policy ministry_attendance_counts_insert on public.ministry_attendance_counts for insert to authenticated
  with check (public.church_has_permission(profile_id, 'church.attendance.manage'));
drop policy if exists ministry_attendance_counts_update on public.ministry_attendance_counts;
create policy ministry_attendance_counts_update on public.ministry_attendance_counts for update to authenticated
  using (public.church_has_permission(profile_id, 'church.attendance.manage'))
  with check (public.church_has_permission(profile_id, 'church.attendance.manage'));
drop policy if exists ministry_attendance_counts_delete on public.ministry_attendance_counts;
create policy ministry_attendance_counts_delete on public.ministry_attendance_counts for delete to authenticated
  using (public.church_has_permission(profile_id, 'church.attendance.manage'));
drop policy if exists ministry_attendance_counts_no_platform_admin_insert on public.ministry_attendance_counts;
create policy ministry_attendance_counts_no_platform_admin_insert on public.ministry_attendance_counts as restrictive for insert to authenticated
  with check (not public.is_admin() or public.church_is_owner(profile_id));
drop policy if exists ministry_attendance_counts_no_platform_admin_update on public.ministry_attendance_counts;
create policy ministry_attendance_counts_no_platform_admin_update on public.ministry_attendance_counts as restrictive for update to authenticated
  using (not public.is_admin() or public.church_is_owner(profile_id))
  with check (not public.is_admin() or public.church_is_owner(profile_id));
drop policy if exists ministry_attendance_counts_no_platform_admin_delete on public.ministry_attendance_counts;
create policy ministry_attendance_counts_no_platform_admin_delete on public.ministry_attendance_counts as restrictive for delete to authenticated
  using (not public.is_admin() or public.church_is_owner(profile_id));

-- ----------------------------------------------------------------------------
-- 4. POSTCONDITIONS (any failure rolls the whole file back)
-- ----------------------------------------------------------------------------
do $$
declare
  v_pre jsonb := current_setting('ministry_attendance.pre')::jsonb;
  v_marker constant text := 'managed by 2026-12-31_ministry_attendance.sql';
  v_t text;
  v_n int;
  v_bad text;
begin
  foreach v_t in array array['ministry_attendance', 'ministry_attendance_counts'] loop
    if coalesce(obj_description(to_regclass('public.' || v_t), 'pg_class'), '') <> v_marker then raise exception 'postcondition failed: table marker on %', v_t; end if;
    if not (select relrowsecurity from pg_class where oid = to_regclass('public.' || v_t)) then raise exception 'postcondition failed: row-level security is off on %', v_t; end if;

    -- nothing for PUBLIC or anon, of any kind; no truncate / references / trigger for authenticated; the recorder is out of reach
    foreach v_bad in array array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'] loop
      if has_table_privilege('public', 'public.' || v_t, v_bad) or has_table_privilege('anon', 'public.' || v_t, v_bad) then raise exception 'postcondition failed: PUBLIC or anon has % on %', v_bad, v_t; end if;
    end loop;
    if has_any_column_privilege('anon', 'public.' || v_t, 'select') or has_any_column_privilege('anon', 'public.' || v_t, 'insert') or has_any_column_privilege('anon', 'public.' || v_t, 'update') then
      raise exception 'postcondition failed: anon has a column privilege on %', v_t;
    end if;
    if has_table_privilege('authenticated', 'public.' || v_t, 'truncate') or has_table_privilege('authenticated', 'public.' || v_t, 'references') or has_table_privilege('authenticated', 'public.' || v_t, 'trigger') then
      raise exception 'postcondition failed: authenticated can truncate, reference or trigger %', v_t;
    end if;
    select string_agg(k, ', ') into v_bad from unnest(array['select', 'insert', 'update']) k where has_column_privilege('authenticated', 'public.' || v_t, 'recorded_by', k);
    if v_bad is not null then raise exception 'postcondition failed: recorded_by reachable on %: %', v_t, v_bad; end if;
    if has_column_privilege('authenticated', 'public.' || v_t, 'profile_id', 'update') or has_column_privilege('authenticated', 'public.' || v_t, 'event_id', 'update') then raise exception 'postcondition failed: profile_id / event_id updatable on %', v_t; end if;

    select count(*) into v_n from pg_policy where polrelid = to_regclass('public.' || v_t) and polroles = array[0::oid];
    if v_n <> 0 then raise exception 'postcondition failed: a policy of % applies to PUBLIC', v_t; end if;
    select count(*) into v_n from pg_trigger where tgrelid = to_regclass('public.' || v_t) and not tgisinternal and tgname = v_t || '_guard_trg';
    if v_n <> 1 then raise exception 'postcondition failed: guard trigger on %', v_t; end if;
  end loop;
  -- attendance rows can never be updated
  if has_table_privilege('authenticated', 'public.ministry_attendance', 'update') or has_any_column_privilege('authenticated', 'public.ministry_attendance', 'update') then raise exception 'postcondition failed: attendance rows are updatable'; end if;

  select count(*) into v_n from pg_policy where polrelid = 'public.ministry_attendance'::regclass and polpermissive;
  if v_n <> 3 then raise exception 'postcondition failed: expected 3 permissive policies on ministry_attendance, found %', v_n; end if;
  select count(*) into v_n from pg_policy where polrelid = 'public.ministry_attendance'::regclass and not polpermissive;
  if v_n <> 2 then raise exception 'postcondition failed: expected 2 restrictive policies on ministry_attendance, found %', v_n; end if;
  select count(*) into v_n from pg_policy where polrelid = 'public.ministry_attendance_counts'::regclass and polpermissive;
  if v_n <> 4 then raise exception 'postcondition failed: expected 4 permissive policies on ministry_attendance_counts, found %', v_n; end if;
  select count(*) into v_n from pg_policy where polrelid = 'public.ministry_attendance_counts'::regclass and not polpermissive;
  if v_n <> 3 then raise exception 'postcondition failed: expected 3 restrictive policies on ministry_attendance_counts, found %', v_n; end if;

  select count(*) into v_n from pg_constraint where conname in ('ministry_attendance_event_fk', 'ministry_attendance_member_fk', 'ministry_attendance_event_member_key', 'ministry_attendance_counts_event_fk') and convalidated;
  if v_n <> 4 then raise exception 'postcondition failed: expected the 4 keys of the attendance tables, found %', v_n; end if;

  -- nothing existing changed
  if (select count(*) from public.profiles) <> (v_pre->>'profiles')::bigint or (select count(*) from public.church_members) <> (v_pre->>'members')::bigint
     or (select count(*) from public.ministry_events) <> (v_pre->>'events')::bigint then
    raise exception 'postcondition failed: a row count of an existing table changed';
  end if;
  if (select coalesce(jsonb_agg(p.polname order by p.polrelid::regclass::text, p.polname), '[]'::jsonb)
        from pg_policy p where p.polrelid in ('public.profiles'::regclass, 'public.organization_roles'::regclass, 'public.organization_members'::regclass,
                                               'public.church_members'::regclass, 'public.church_groups'::regclass, 'public.church_group_members'::regclass, 'public.church_leadership'::regclass,
                                               'public.ministry_events'::regclass)
                           or p.polrelid = to_regclass('public.ministry_announcements') or p.polrelid = to_regclass('public.daily_words')) is distinct from v_pre->'policies' then
    raise exception 'postcondition failed: a policy of an existing table changed';
  end if;
  if (select jsonb_object_agg(f.proname, md5(pg_get_functiondef(f.oid)))
        from pg_proc f where f.pronamespace = 'public'::regnamespace
         and (f.proname like 'church\_%' or f.proname like 'team\_church\_%' or f.proname like 'daily\_word%' or f.proname in ('ministry_today', 'ministry_content_guard', 'is_admin', 'has_org_permission', 'is_org_member', 'is_church_profile'))) is distinct from v_pre->'fn_defs' then
    raise exception 'postcondition failed: an existing function changed';
  end if;
end $$;

commit;
