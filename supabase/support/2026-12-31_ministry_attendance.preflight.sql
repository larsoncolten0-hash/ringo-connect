-- PREFLIGHT for 2026-12-31_ministry_attendance.sql — READ-ONLY (one SELECT, no write). FOR OWNER REVIEW; run in the Supabase SQL Editor BEFORE applying the migration.
-- Every row must show ok = true. It proves everything the migration depends on exists (Phase 2A and Phase 4 applied) and that none of the new objects exists yet (a clean first run). It reads the catalog only.

with
checks(label, expect, actual) as (
  select '01 profiles, users, church_members and ministry_events exist', '4',
         (select count(*)::text from unnest(array['profiles', 'users', 'church_members', 'ministry_events']) t where to_regclass('public.' || t) is not null)
  union all select '02 the composite keys the new foreign keys point at exist (church_members_id_profile_key, ministry_events_id_profile_key)', '2',
         (select count(*)::text from pg_constraint where conname in ('church_members_id_profile_key', 'ministry_events_id_profile_key') and contype = 'u')
  union all select '03 the helpers exist and are managed by their migrations (church_is_owner and church_has_permission: Phase 2A; ministry_today: Phase 4)', '3',
         (select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace
             and ((proname in ('church_is_owner', 'church_has_permission') and obj_description(oid, 'pg_proc') = 'managed by 2026-12-27_church_people_groups.sql')
               or (proname = 'ministry_today' and obj_description(oid, 'pg_proc') = 'managed by 2026-12-29_ministry_events_announcements.sql')))
  union all select '04 is_admin() exists', '1', (select (to_regprocedure('public.is_admin()') is not null)::int::text)
  union all select '05 the database roles anon, authenticated and service_role exist', '3', (select count(*)::text from pg_roles where rolname in ('anon', 'authenticated', 'service_role'))
  union all select '06 the Phase 4 tables are managed by their migration', '2',
         (select count(*)::text from unnest(array['ministry_events', 'ministry_announcements']) t where obj_description(to_regclass('public.' || t), 'pg_class') = 'managed by 2026-12-29_ministry_events_announcements.sql')
  union all select '07 no ministry_attendance* relation exists yet (0 expected)', '0', (select count(*)::text from pg_class where relnamespace = 'public'::regnamespace and relname like 'ministry\_attendance%')
  union all select '08 no function named ministry_attendance_* exists yet (0 expected)', '0', (select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace and proname like 'ministry\_attendance%')
  union all select '09 no organization role already holds a church.attendance.* permission (0 expected; the strings are new)', '0',
         (select count(*)::text from public.organization_roles r where exists (select 1 from unnest(r.permissions) p where lower(btrim(p)) like 'church.attendance.%'))
  union all select '10 the Team grant guard for church.* permissions is live (Phase 2A applied): 3 triggers', '3',
         (select count(*)::text from pg_trigger where not tgisinternal and tgname in ('organization_roles_church_guard_trg', 'organization_members_church_guard_trg', 'organization_invitations_church_guard_trg'))
)
select label, expect, actual, (expect = actual) as ok from checks order by label;
