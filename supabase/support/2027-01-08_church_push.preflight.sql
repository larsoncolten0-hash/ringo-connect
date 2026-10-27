-- PREFLIGHT for 2027-01-08_church_push.sql — READ-ONLY (one SELECT, no write). FOR OWNER REVIEW; run in the Supabase SQL Editor BEFORE applying the migration.
-- Every row must show ok = true. It proves everything the migration depends on exists and that none of the new objects exists yet (a clean first run). It reads the catalog only.

with
checks(label, expect, actual) as (
  select '01 the tables this file reads exist (profiles, customers, connections, roster, group members, public groups, Bible year enrolments)', '7',
         (select count(*)::text from unnest(array['profiles', 'ringo_customers', 'customer_connections', 'church_members', 'church_group_members', 'church_public_groups', 'bible_year_enrollments']) t where to_regclass('public.' || t) is not null)
  union all select '02 is_church_profile(uuid) and ministry_today() exist', '2',
         (select count(*)::text from unnest(array['is_church_profile(uuid)', 'ministry_today()']) f where to_regprocedure('public.' || f) is not null)
  union all select '03 the database roles anon, authenticated and service_role exist', '3', (select count(*)::text from pg_roles where rolname in ('anon', 'authenticated', 'service_role'))
  union all select '04 none of the three new tables exists yet (0 expected)', '0',
         (select count(*)::text from unnest(array['church_push_prefs', 'church_push_outbox', 'church_push_deliveries']) t where to_regclass('public.' || t) is not null)
  union all select '05 none of the new functions exists yet (0 expected)', '0',
         (select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace and proname in ('church_push_prefs_guard', 'church_push_enqueue', 'church_push_claim', 'church_push_recipients', 'church_push_record', 'church_push_finish'))
  union all select '06 the customer push device table is in place (this file does not touch it)', '1',
         (select count(*)::text from unnest(array['customer_push_subscriptions']) t where to_regclass('public.' || t) is not null)
)
select label, expect, actual, (expect = actual) as ok from checks order by label;
