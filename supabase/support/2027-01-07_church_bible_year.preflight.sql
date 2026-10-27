-- PREFLIGHT for 2027-01-07_church_bible_year.sql — READ-ONLY (one SELECT, no write). FOR OWNER REVIEW; run in the Supabase SQL Editor BEFORE applying the migration.
-- Every row must show ok = true. It proves everything the migration depends on exists and that none of the new objects exists yet (a clean first run). It reads the catalog only.

with
checks(label, expect, actual) as (
  select '01 profiles, ringo_customers and users exist', '3',
         (select count(*)::text from unnest(array['profiles', 'ringo_customers', 'users']) t where to_regclass('public.' || t) is not null)
  union all select '02 the church helper functions and ministry_today() exist', '4',
         (select count(*)::text from unnest(array['is_church_profile(uuid)', 'church_is_owner(uuid)', 'is_admin()', 'ministry_today()']) f where to_regprocedure('public.' || f) is not null)
  union all select '03 the database roles anon, authenticated and service_role exist', '3', (select count(*)::text from pg_roles where rolname in ('anon', 'authenticated', 'service_role'))
  union all select '04 none of the three new tables exists yet (0 expected)', '0',
         (select count(*)::text from unnest(array['church_features', 'bible_year_enrollments', 'bible_year_progress']) t where to_regclass('public.' || t) is not null)
  union all select '05 none of the new functions exists yet (0 expected)', '0',
         (select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace and proname in ('church_features_guard', 'bible_year_enrollment_guard', 'bible_year_progress_guard'))
)
select label, expect, actual, (expect = actual) as ok from checks order by label;
