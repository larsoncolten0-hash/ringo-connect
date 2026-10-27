-- VERIFY for 2027-01-11_church_giving_lock.sql — READ-ONLY (a single SELECT, no write). FOR OWNER REVIEW; run once AFTER the migration is applied.
-- Every row must show ok = true. It reads the catalog and one count only.

with
checks(label, expect, actual) as (
  select '01 the lock trigger exists on church_features and is marked as managed by this migration', '1',
         (select count(*)::text from pg_trigger where not tgisinternal and tgname = 'church_features_giving_lock_trg' and tgrelid = 'public.church_features'::regclass
            and obj_description(oid, 'pg_trigger') = 'managed by 2027-01-11_church_giving_lock.sql')
  union all select '02 the lock function exists and is marked as managed by this migration', '1',
         (select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace and proname = 'church_features_giving_lock' and obj_description(oid, 'pg_proc') = 'managed by 2027-01-11_church_giving_lock.sql')
  union all select '03 the lock function is callable by nobody (only the trigger runs it)', '0',
         (select count(*)::text from unnest(array['anon', 'authenticated', 'public']) r where has_function_privilege(r, 'public.church_features_giving_lock()', 'execute'))
  union all select '04 collection is still closed', 'false', (select public.church_giving_collection_open()::text)
  union all select '05 no church has giving switched on (0 expected)', '0', (select count(*)::text from public.church_features where giving)
  union all select '06 the earlier guard trigger on church_features is untouched', '1',
         (select count(*)::text from pg_trigger t join pg_proc p on p.oid = t.tgfoid where not t.tgisinternal and t.tgrelid = 'public.church_features'::regclass and p.proname = 'church_features_guard')
)
select label, expect, actual, (expect = actual) as ok from checks order by label;
