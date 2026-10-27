-- PREFLIGHT for 2027-01-04_church_landing_images.sql — READ-ONLY (one SELECT, no write). FOR OWNER REVIEW; run in the Supabase SQL Editor BEFORE applying the migration.
-- Every row must show ok = true. It proves everything the migration depends on exists and that none of the new objects exists yet (a clean first run). It reads the catalog only.

with
checks(label, expect, actual) as (
  select '01 the four tables this file adds columns to exist (events, announcements, care cases, testimonies)', '4',
         (select count(*)::text from unnest(array['ministry_events', 'ministry_announcements', 'ministry_care_cases', 'ministry_testimonies']) t where to_regclass('public.' || t) is not null)
  union all select '02 ministry_testimonies_public(uuid) exists (the new week function mirrors it)', '1', (select (to_regprocedure('public.ministry_testimonies_public(uuid)') is not null)::int::text)
  union all select '03 the database roles anon, authenticated and service_role exist', '3', (select count(*)::text from pg_roles where rolname in ('anon', 'authenticated', 'service_role'))
  union all select '04 profiles.published exists (the new function uses it)', '1',
         (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'published')
  union all select '05 none of the new columns exists yet (0 expected)', '0',
         (select count(*)::text from information_schema.columns where table_schema = 'public'
            and ((table_name in ('ministry_events', 'ministry_announcements', 'ministry_care_cases') and column_name = 'image_url') or (table_name = 'ministry_care_cases' and column_name = 'image_consent')))
  union all select '06 none of the new functions exists yet (0 expected)', '0',
         (select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace and proname in ('ministry_testimonies_public_week', 'ministry_care_image_guard'))
  union all select '07 the new trigger does not exist yet (0 expected)', '0',
         (select count(*)::text from pg_trigger where not tgisinternal and tgname = 'ministry_care_cases_image_trg')
  union all select '08 the care guard of Phase 9 is live (at least one trigger on ministry_care_cases; the new one sits beside it)', 'true',
         (select (count(*) >= 1)::text from pg_trigger where not tgisinternal and tgrelid = 'public.ministry_care_cases'::regclass)
)
select label, expect, actual, (expect = actual) as ok from checks order by label;
