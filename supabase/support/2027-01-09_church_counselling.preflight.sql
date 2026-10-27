-- PREFLIGHT for 2027-01-09_church_counselling.sql — READ-ONLY (one SELECT, no write). FOR OWNER REVIEW; run in the Supabase SQL Editor BEFORE applying the migration.
-- Every row must show ok = true. It proves everything the migration depends on exists and that none of the new objects exists yet (a clean first run). It reads the catalog only.

with
checks(label, expect, actual) as (
  select '01 profiles and users exist', '2', (select count(*)::text from unnest(array['profiles', 'users']) t where to_regclass('public.' || t) is not null)
  union all select '02 the church helper functions exist', '4',
         (select count(*)::text from unnest(array['church_has_permission(uuid,text)', 'church_is_owner(uuid)', 'is_church_profile(uuid)', 'is_admin()']) f where to_regprocedure('public.' || f) is not null)
  union all select '03 the database roles anon, authenticated and service_role exist', '3', (select count(*)::text from pg_roles where rolname in ('anon', 'authenticated', 'service_role'))
  union all select '04 neither new table exists yet (0 expected)', '0', (select count(*)::text from unnest(array['church_counselling_requests', 'church_counselling_history']) t where to_regclass('public.' || t) is not null)
  union all select '05 none of the new functions exists yet (0 expected)', '0',
         (select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace and proname in ('church_counselling_guard', 'church_counselling_audit', 'church_counselling_history_guard'))
)
select label, expect, actual, (expect = actual) as ok from checks order by label;
