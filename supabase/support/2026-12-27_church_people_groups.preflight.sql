-- PREFLIGHT for 2026-12-27_church_people_groups.sql — READ-ONLY (two SELECTs, no write). FOR OWNER REVIEW; run BOTH in the Supabase SQL Editor BEFORE applying the migration.
--
-- QUERY 1: every row must show ok = true. It proves everything the migration depends on exists and that none of the new objects exists yet (a clean first run).
-- QUERY 2: informational. Read it and decide; it reports facts the repository cannot know (which of the earlier Team guards are live in THIS database).

-- ===== QUERY 1 ==============================================================================================================================================
with
checks(label, expect, actual) as (
  select '01 the six tables this file depends on exist (profiles, users, ringo_customers, organization_roles, organization_members, organization_invitations)', '6',
         (select count(*)::text from unnest(array['profiles', 'users', 'ringo_customers', 'organization_roles', 'organization_members', 'organization_invitations']) t where to_regclass('public.' || t) is not null)
  union all select '02 is_admin(), has_org_permission(uuid, text) and is_org_member(uuid) exist', '3',
         ((select (to_regprocedure('public.is_admin()') is not null)::int) + (select (to_regprocedure('public.has_org_permission(uuid, text)') is not null)::int) + (select (to_regprocedure('public.is_org_member(uuid)') is not null)::int))::text
  union all select '03 profiles has the category and categories columns', '2',
         (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name in ('category', 'categories'))
  union all select '04 the database roles anon, authenticated and service_role exist', '3', (select count(*)::text from pg_roles where rolname in ('anon', 'authenticated', 'service_role'))
  union all select '05 the Churches category is allowed by the live profile constraint (Phase 0 applied)', '1',
         (select count(*)::text from pg_constraint where conrelid = 'public.profiles'::regclass and conname = 'profiles_category_check' and pg_get_constraintdef(oid) like '%church_ministries%')
  union all select '06 none of the four church people tables exists yet (0 expected)', '0',
         (select count(*)::text from unnest(array['church_members', 'church_groups', 'church_group_members', 'church_leadership']) t where to_regclass('public.' || t) is not null)
  union all select '07 none of the new functions exists yet (0 expected)', '0',
         (select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace and (proname like 'church\_%' or proname like 'team\_church\_%' or proname in ('is_church_profile', 'organization_roles_church_guard', 'organization_members_church_guard', 'organization_invitations_church_guard')))
  union all select '08 none of the three Team guard triggers exists yet (0 expected)', '0',
         (select count(*)::text from pg_trigger where not tgisinternal and tgname in ('organization_roles_church_guard_trg', 'organization_members_church_guard_trg', 'organization_invitations_church_guard_trg'))
  union all select '11 no relation (table, index, view or sequence) in public is already named church_* (0 expected)', '0',
         (select count(*)::text from pg_class where relnamespace = 'public'::regnamespace and relname like 'church\_%')
  union all select '12 no function named church_member_age_group exists (0 expected; an earlier draft used the name)', '0',
         (select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace and proname = 'church_member_age_group')
  union all select '09 row-level security is on for the three Team tables', '3',
         (select count(*)::text from pg_class where oid in ('public.organization_roles'::regclass, 'public.organization_members'::regclass, 'public.organization_invitations'::regclass) and relrowsecurity)
  union all select '10 no organization role already holds a church.* permission (0 expected; the strings are new)', '0',
         (select count(*)::text from public.organization_roles r where exists (select 1 from unnest(r.permissions) p where lower(btrim(p)) like 'church.%'))
)
select label, expect, actual, (expect = actual) as ok from checks order by label;

-- ===== QUERY 2 (informational) ==============================================================================================================================
-- Reading guide:
--   team_ceiling_guard_triggers   3 = 2026-10-07a is live; 0 = it is NOT. The migration enforces the ceiling for church.* permissions ITSELF, so it works either way; but a missing
--                                 07a means the same escalation is open for every OTHER permission today. Worth knowing; not a blocker for this file.
--   team_inbox_guard_triggers     3 = 2026-12-13 is live; 0 = it is not.
--   church_profiles               how many profiles already carry the church category (the migration touches none of them).
--   platform_admins               accounts for which is_admin() is true. They will be refused by every church table and cannot be given a church role.
select 'team_ceiling_guard_triggers' as item, (select count(*)::text from pg_trigger where not tgisinternal and tgname like 'organization\_%\_ceiling\_guard\_trg') as value
union all select 'team_inbox_guard_triggers', (select count(*)::text from pg_trigger where not tgisinternal and tgname like 'organization\_%\_inbox\_guard\_trg')
union all select 'church_profiles', (select count(*)::text from public.profiles where category = 'church_ministries' or 'church_ministries' = any(categories))
union all select 'platform_admins', (select count(*)::text from public.users where role = 'admin')
union all select 'organization_roles', (select count(*)::text from public.organization_roles)
union all select 'organization_members', (select count(*)::text from public.organization_members);
