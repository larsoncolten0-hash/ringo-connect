-- VERIFY for 2027-01-16_church_service_schedule.sql — READ-ONLY (a single SELECT, no write). Run once AFTER the migration is applied. Every row must show ok = true.

with
checks(label, expect, actual) as (
  select '01 table exists and is marked', 'true', (obj_description(to_regclass('public.church_service_schedule'), 'pg_class') = 'managed by 2027-01-16_church_service_schedule.sql')::text
  union all select '02 row-level security is on', 'true', (select relrowsecurity::text from pg_class where oid = 'public.church_service_schedule'::regclass)
  union all select '03 permissive policies (4 expected)', '4', (select count(*)::text from pg_policy where polrelid = 'public.church_service_schedule'::regclass and polpermissive)
  union all select '04 restrictive policies (2 expected)', '2', (select count(*)::text from pg_policy where polrelid = 'public.church_service_schedule'::regclass and not polpermissive)
  union all select '05 no policy applies to PUBLIC (0 expected)', '0', (select count(*)::text from pg_policy where polrelid = 'public.church_service_schedule'::regclass and polroles = array[0::oid])
  union all select '06 authenticated cannot delete (false expected)', 'false', has_table_privilege('authenticated', 'public.church_service_schedule', 'delete')::text
  union all select '07 anon has no table-level select (false expected)', 'false', has_table_privilege('anon', 'public.church_service_schedule', 'select')::text
  union all select '08 anon cannot write any column (false expected)', 'false', (has_any_column_privilege('anon', 'public.church_service_schedule', 'insert') or has_any_column_privilege('anon', 'public.church_service_schedule', 'update'))::text
  union all select '09 anon can read the schedule columns', 'true', has_column_privilege('anon', 'public.church_service_schedule', 'start_time', 'select')::text
  union all select '10 no API role reaches the audit columns (0 expected)', '0',
         (select count(*)::text from unnest(array['anon', 'authenticated']) r, unnest(array['created_by', 'updated_by']) c, unnest(array['select', 'insert', 'update']) k where has_column_privilege(r, 'public.church_service_schedule', c, k))
  union all select '11 the church cannot be changed on update (false expected)', 'false', has_column_privilege('authenticated', 'public.church_service_schedule', 'profile_id', 'update')::text
  union all select '12 the guard trigger is installed (1 expected)', '1', (select count(*)::text from pg_trigger where tgrelid = 'public.church_service_schedule'::regclass and not tgisinternal and tgname = 'church_service_schedule_guard_trg')
  union all select '13 the guard is callable by no API role (false expected)', 'false', (has_function_privilege('anon', 'public.church_service_schedule_guard()', 'execute') or has_function_privilege('authenticated', 'public.church_service_schedule_guard()', 'execute') or has_function_privilege('public', 'public.church_service_schedule_guard()', 'execute'))::text
  union all select '14 the guard is security definer with a fixed search_path', 'true', (select (p.prosecdef and p.proconfig is not null)::text from pg_proc p where p.oid = 'public.church_service_schedule_guard()'::regprocedure)
)
select label, expect, actual, (expect = actual) as ok from checks order by label;
