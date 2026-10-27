-- VERIFY for 2027-01-09_church_counselling.sql — READ-ONLY (a single SELECT, no write). FOR OWNER REVIEW; run once AFTER the migration is applied.
-- Every row must show ok = true. It reads the catalog only: no request, name, phone, e-mail or reason is read.

with
checks(label, expect, actual) as (
  select '01 both tables exist with row-level security on', '2',
         (select count(*)::text from pg_class c where c.oid in ('public.church_counselling_requests'::regclass, 'public.church_counselling_history'::regclass) and c.relrowsecurity)
  union all select '02 every new object is marked as managed by this migration (2 tables, 3 functions, 3 triggers)', '8',
         ((select count(*) from pg_description d where d.classoid = 'pg_class'::regclass and d.objsubid = 0 and d.description = 'managed by 2027-01-09_church_counselling.sql'
             and d.objoid in ('public.church_counselling_requests'::regclass, 'public.church_counselling_history'::regclass))
          + (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('church_counselling_guard', 'church_counselling_audit', 'church_counselling_history_guard') and obj_description(oid, 'pg_proc') = 'managed by 2027-01-09_church_counselling.sql')
          + (select count(*) from pg_trigger where not tgisinternal and tgname in ('church_counselling_guard_trg', 'church_counselling_audit_trg', 'church_counselling_history_guard_trg') and obj_description(oid, 'pg_trigger') = 'managed by 2027-01-09_church_counselling.sql'))::text
  union all select '03 the public (anon) and PUBLIC have no right of any kind on either table', '0',
         (select count(*)::text from unnest(array['church_counselling_requests', 'church_counselling_history']) t, unnest(array['anon', 'public']) r, unnest(array['select', 'insert', 'update', 'delete']) k where has_table_privilege(r, 'public.' || t, k))
  union all select '04 no signed-in user can insert a request or touch the history (only the server creates a request)', '0',
         ((select count(*) from unnest(array['insert', 'update', 'delete']) k where has_table_privilege('authenticated', 'public.church_counselling_history', k))
          + (select count(*) from unnest(array['insert']) k where has_table_privilege('authenticated', 'public.church_counselling_requests', k)))::text
  union all select '05 staff can change ONLY the decision and the note (status, decision_note), never the words or the stamps', 'true/false/false/false/false',
         has_column_privilege('authenticated', 'public.church_counselling_requests', 'status', 'update')::text || '/' || has_column_privilege('authenticated', 'public.church_counselling_requests', 'reason', 'update')::text || '/'
         || has_column_privilege('authenticated', 'public.church_counselling_requests', 'phone', 'update')::text || '/' || has_column_privilege('authenticated', 'public.church_counselling_requests', 'decided_by', 'update')::text || '/'
         || has_column_privilege('authenticated', 'public.church_counselling_requests', 'full_name', 'update')::text
  union all select '06 staff cannot read the internal columns (the form key, who decided)', 'false/false',
         has_column_privilege('authenticated', 'public.church_counselling_requests', 'submission_key', 'select')::text || '/' || has_column_privilege('authenticated', 'public.church_counselling_requests', 'decided_by', 'select')::text
  union all select '07 the policies exist: staff read, staff update, staff delete, no platform admin; history read, no platform admin', '6',
         (select count(*)::text from pg_policy where polname in ('church_counselling_staff_select', 'church_counselling_staff_update', 'church_counselling_staff_delete', 'church_counselling_no_platform_admin', 'church_counselling_history_staff_select', 'church_counselling_history_no_platform_admin'))
  union all select '08 reading needs church.counselling.view or manage, deciding needs manage (the policies say so)', 'true',
         (select (bool_and(pg_get_expr(p.polqual, p.polrelid) ilike '%church.counselling.%'))::text from pg_policy p where p.polname in ('church_counselling_staff_select', 'church_counselling_staff_update', 'church_counselling_staff_delete'))
  union all select '09 the guard functions are callable by nobody (only the triggers run them)', '0',
         (select count(*)::text from unnest(array['church_counselling_guard()', 'church_counselling_audit()', 'church_counselling_history_guard()']) f, unnest(array['anon', 'authenticated', 'public']) r where has_function_privilege(r, 'public.' || f, 'execute'))
  union all select '10 the shape checks exist (reason 10 to 1000 characters, phone digits, status list, decision stamp)', '5',
         (select count(*)::text from pg_constraint where conname in ('church_counselling_reason_check', 'church_counselling_phone_check', 'church_counselling_status_check', 'church_counselling_decided_check', 'church_counselling_key_key'))
  union all select '11 no money-like column in either table (0 expected)', '0',
         (select count(*)::text from information_schema.columns c where c.table_schema = 'public' and c.table_name in ('church_counselling_requests', 'church_counselling_history')
            and c.column_name ~* '(amount|price|currency|money|fee|commission|payment|payout|refund|receipt|balance)')
)
select label, expect, actual, (expect = actual) as ok from checks order by label;
