-- VERIFY for 2027-01-14_church_giving_general.sql — READ-ONLY (a single SELECT, no write). Run once AFTER the migration is applied. Every row must show ok = true.

with
checks(label, expect, actual) as (
  select '01 the function no longer reads the pilot list', 'false',
         (select (pg_get_functiondef('public.church_giving_profile_allowed(uuid)'::regprocedure) ilike '%church_giving_pilot_profiles%')::text)
  union all select '02 the function asks is_church_profile', 'true',
         (select (pg_get_functiondef('public.church_giving_profile_allowed(uuid)'::regprocedure) ilike '%is_church_profile%')::text)
  union all select '03 an unknown profile is not allowed', 'false', (select public.church_giving_profile_allowed(gen_random_uuid())::text)
  union all select '04 the function is callable by no API role (0 expected)', '0',
         (select count(*)::text from unnest(array['anon', 'authenticated', 'public']) r where has_function_privilege(r, 'public.church_giving_profile_allowed(uuid)', 'execute'))
  union all select '05 the platform master switch still exists', '1',
         (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'platform_settings' and column_name = 'church_giving_enabled')
  union all select '06 the gift guard and the giving-switch lock are still in place', '2',
         (select count(*)::text from pg_trigger where not tgisinternal and tgname in ('church_gifts_guard_trg', 'church_features_giving_lock_trg'))
)
select label, expect, actual, (expect = actual) as ok from checks order by label;
