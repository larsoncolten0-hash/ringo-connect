-- PREFLIGHT for 2026-12-29_ministry_events_announcements.sql — READ-ONLY (one SELECT, no write). FOR OWNER REVIEW; run in the Supabase SQL Editor BEFORE applying the migration.
-- Every row must show ok = true. It proves everything the migration depends on exists and that none of the new objects exists yet (a clean first run). It reads the catalog only.

with
checks(label, expect, actual) as (
  select '01 profiles and users exist', '2',
         (select count(*)::text from unnest(array['profiles', 'users']) t where to_regclass('public.' || t) is not null)
  union all select '02 profiles.published exists (the public read policies use it)', '1',
         (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'published')
  union all select '03 the Phase 2A helpers exist (is_church_profile, church_is_owner, church_has_permission) and are managed by that migration', '3',
         (select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace and proname in ('is_church_profile', 'church_is_owner', 'church_has_permission')
             and obj_description(oid, 'pg_proc') = 'managed by 2026-12-27_church_people_groups.sql')
  union all select '04 is_admin() exists', '1', (select (to_regprocedure('public.is_admin()') is not null)::int::text)
  union all select '05 the database roles anon, authenticated and service_role exist', '3', (select count(*)::text from pg_roles where rolname in ('anon', 'authenticated', 'service_role'))
  union all select '06 the Phase 2A tables exist (Phase 2A applied)', '4',
         (select count(*)::text from unnest(array['church_members', 'church_groups', 'church_group_members', 'church_leadership']) t where to_regclass('public.' || t) is not null)
  union all select '07 no ministry_event* / ministry_announcement* relation exists yet (0 expected)', '0',
         (select count(*)::text from pg_class where relnamespace = 'public'::regnamespace and (relname like 'ministry\_event%' or relname like 'ministry\_announcement%'))
  union all select '08 no function named ministry_* exists yet (0 expected)', '0', (select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace and proname like 'ministry\_%')
  union all select '09 no organization role already holds a church.events.* permission (0 expected; the strings are new)', '0',
         (select count(*)::text from public.organization_roles r where exists (select 1 from unnest(r.permissions) p where lower(btrim(p)) like 'church.events.%'))
  union all select '10 the Team grant guard for church.* permissions is live (Phase 2A applied): 3 triggers', '3',
         (select count(*)::text from pg_trigger where not tgisinternal and tgname in ('organization_roles_church_guard_trg', 'organization_members_church_guard_trg', 'organization_invitations_church_guard_trg'))
)
select label, expect, actual, (expect = actual) as ok from checks order by label;
