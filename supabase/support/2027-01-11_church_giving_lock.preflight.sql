-- PREFLIGHT for 2027-01-11_church_giving_lock.sql — READ-ONLY (one SELECT, no write). FOR OWNER REVIEW; run in the Supabase SQL Editor BEFORE applying the migration.
-- Every row must show ok = true. It reads the catalog and one count only.

with
checks(label, expect, actual) as (
  select '01 church_features exists', '1', (select count(*)::text from unnest(array['church_features']) t where to_regclass('public.' || t) is not null)
  union all select '02 the giving switch function from 2027-01-10 exists', '1', (select count(*)::text from unnest(array['church_giving_collection_open()']) f where to_regprocedure('public.' || f) is not null)
  union all select '03 collection is closed (the switch answers false)', 'false', (select public.church_giving_collection_open()::text)
  union all select '04 no church has giving switched on (0 expected)', '0', (select count(*)::text from public.church_features where giving)
  union all select '05 the new function and trigger do not exist yet (0 expected)', '0',
         ((select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'church_features_giving_lock')
          + (select count(*) from pg_trigger where not tgisinternal and tgname = 'church_features_giving_lock_trg'))::text
)
select label, expect, actual, (expect = actual) as ok from checks order by label;
