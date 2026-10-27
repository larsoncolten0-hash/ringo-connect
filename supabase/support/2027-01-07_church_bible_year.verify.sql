-- VERIFY for 2027-01-07_church_bible_year.sql — READ-ONLY (a single SELECT, no write). FOR OWNER REVIEW; run once AFTER the migration is applied.
-- Every row must show ok = true. It reads the catalog only: no reader, no enrolment and no switch is read.

with
checks(label, expect, actual) as (
  select '01 the three tables exist with row-level security on', '3',
         (select count(*)::text from pg_class c where c.oid in ('public.church_features'::regclass, 'public.bible_year_enrollments'::regclass, 'public.bible_year_progress'::regclass) and c.relrowsecurity)
  union all select '02 every new object is marked as managed by this migration (3 tables, 3 functions, 3 triggers)', '9',
         ((select count(*) from pg_description d where d.classoid = 'pg_class'::regclass and d.objsubid = 0 and d.description = 'managed by 2027-01-07_church_bible_year.sql'
             and d.objoid in ('public.church_features'::regclass, 'public.bible_year_enrollments'::regclass, 'public.bible_year_progress'::regclass))
          + (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('church_features_guard', 'bible_year_enrollment_guard', 'bible_year_progress_guard') and obj_description(oid, 'pg_proc') = 'managed by 2027-01-07_church_bible_year.sql')
          + (select count(*) from pg_trigger where not tgisinternal and tgname in ('church_features_guard_trg', 'bible_year_enrollments_guard_trg', 'bible_year_progress_guard_trg') and obj_description(oid, 'pg_trigger') = 'managed by 2027-01-07_church_bible_year.sql'))::text
  union all select '03 the reader tables are closed to every API role (no select, insert, update or delete for anon, authenticated, PUBLIC)', '0',
         (select count(*)::text from unnest(array['bible_year_enrollments', 'bible_year_progress']) t, unnest(array['anon', 'authenticated', 'public']) r, unnest(array['select', 'insert', 'update', 'delete']) k where has_table_privilege(r, 'public.' || t, k))
  union all select '04 the reader tables have no policy at all (0 expected)', '0',
         (select count(*)::text from pg_policy where polrelid in ('public.bible_year_enrollments'::regclass, 'public.bible_year_progress'::regclass))
  union all select '05 the service role can use all three tables', 'true',
         (select (bool_and(has_table_privilege('service_role', 'public.' || t, 'select')) and bool_and(has_table_privilege('service_role', 'public.' || t, 'insert')))::text from unnest(array['church_features', 'bible_year_enrollments', 'bible_year_progress']) t)
  union all select '06 the public reads the switches but not who changed them, and writes nothing', 'true/false/false',
         has_column_privilege('anon', 'public.church_features', 'bible_year', 'select')::text || '/' || has_column_privilege('anon', 'public.church_features', 'updated_by', 'select')::text || '/' || has_table_privilege('anon', 'public.church_features', 'insert')::text
  union all select '07 a signed-in person can write the switches only through the owner policies (select, insert, update, restrictive admin guard)', '4',
         (select count(*)::text from pg_policy where polrelid = 'public.church_features'::regclass and polname in ('church_features_owner_select', 'church_features_owner_insert', 'church_features_owner_update', 'church_features_no_platform_admin'))
  union all select '08 the guard functions are callable by nobody (only the triggers run them)', '0',
         (select count(*)::text from unnest(array['church_features_guard()', 'bible_year_enrollment_guard()', 'bible_year_progress_guard()']) f, unnest(array['anon', 'authenticated', 'public']) r where has_function_privilege(r, 'public.' || f, 'execute'))
  union all select '09 a reading day is 1..365 (the check exists) and one open plan per person and church (the unique index exists)', 'true',
         (select (exists (select 1 from pg_constraint where conname = 'bible_year_progress_day_check') and exists (select 1 from pg_indexes where indexname = 'bible_year_enrollments_open_key'))::text)
  union all select '10 no money-like column in the new tables (0 expected)', '0',
         (select count(*)::text from information_schema.columns c where c.table_schema = 'public' and c.table_name in ('church_features', 'bible_year_enrollments', 'bible_year_progress')
            and c.column_name ~* '(amount|price|currency|money|fee|commission|payment|payout|refund|receipt|balance)')
)
select label, expect, actual, (expect = actual) as ok from checks order by label;
