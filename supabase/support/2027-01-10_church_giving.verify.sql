-- VERIFY for 2027-01-10_church_giving.sql — READ-ONLY (a single SELECT, no write). FOR OWNER REVIEW; run once AFTER the migration is applied.
-- Every row must show ok = true. It reads the catalog only: no fund is read.

with
checks(label, expect, actual) as (
  select '01 the table exists with row-level security on', '1', (select count(*)::text from pg_class c where c.oid = 'public.church_giving_funds'::regclass and c.relrowsecurity)
  union all select '02 every new object is marked as managed by this migration (1 table, 2 functions, 1 trigger)', '4',
         ((select count(*) from pg_description d where d.classoid = 'pg_class'::regclass and d.objsubid = 0 and d.description = 'managed by 2027-01-10_church_giving.sql' and d.objoid = 'public.church_giving_funds'::regclass)
          + (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('church_giving_collection_open', 'church_giving_guard') and obj_description(oid, 'pg_proc') = 'managed by 2027-01-10_church_giving.sql')
          + (select count(*) from pg_trigger where not tgisinternal and tgname = 'church_giving_guard_trg' and obj_description(oid, 'pg_trigger') = 'managed by 2027-01-10_church_giving.sql'))::text
  union all select '03 the public (anon) and PUBLIC cannot write, and PUBLIC cannot read', '0',
         (select count(*)::text from unnest(array['anon', 'public']) r, unnest(array['insert', 'update', 'delete']) k where has_table_privilege(r, 'public.church_giving_funds', k))
  union all select '04 collection is closed: the switch function answers false', 'false', (select public.church_giving_collection_open()::text)
  union all select '05 a signed-in user cannot edit the church, the kind or the closing time', 'false/false/false',
         has_column_privilege('authenticated', 'public.church_giving_funds', 'profile_id', 'update')::text || '/' || has_column_privilege('authenticated', 'public.church_giving_funds', 'kind', 'update')::text || '/'
         || has_column_privilege('authenticated', 'public.church_giving_funds', 'closed_at', 'update')::text
  union all select '06 the policies exist: staff read, public read, staff insert, update, delete, no platform admin', '6',
         (select count(*)::text from pg_policy where polname in ('church_giving_staff_select', 'church_giving_public_select', 'church_giving_staff_insert', 'church_giving_staff_update', 'church_giving_staff_delete', 'church_giving_no_platform_admin'))
  union all select '07 staff writing needs church.giving.manage (the policies say so)', 'true',
         (select (bool_and(coalesce(pg_get_expr(p.polqual, p.polrelid), '') || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') ilike '%church.giving.manage%'))::text
            from pg_policy p where p.polname in ('church_giving_staff_select', 'church_giving_staff_insert', 'church_giving_staff_update', 'church_giving_staff_delete'))
  union all select '08 the public policy needs the fund to be published and giving switched on', 'true',
         (select (pg_get_expr(p.polqual, p.polrelid) ilike '%is_published%' and pg_get_expr(p.polqual, p.polrelid) ilike '%giving%')::text from pg_policy p where p.polname = 'church_giving_public_select')
  union all select '09 the functions are callable by nobody (only the trigger and the server run them)', '0',
         (select count(*)::text from unnest(array['church_giving_guard()', 'church_giving_collection_open()']) f, unnest(array['anon', 'authenticated', 'public']) r where has_function_privilege(r, 'public.' || f, 'execute'))
  union all select '10 the shape checks exist (kind, status, goal, closing stamp)', '4',
         (select count(*)::text from pg_constraint where conname in ('church_giving_kind_check', 'church_giving_status_check', 'church_giving_goal_check', 'church_giving_closed_check'))
  union all select '11 no money-received, donor or payment column exists (0 expected; goal_xaf is the only amount, and it is a target)', '0',
         (select count(*)::text from information_schema.columns c where c.table_schema = 'public' and c.table_name = 'church_giving_funds'
            and c.column_name ~* '(received|raised|donor|donation|payment|payout|refund|receipt|balance|fee|commission|customer|phone|email)')
  union all select '12 no fund is open (0 expected)', '0', (select count(*)::text from public.church_giving_funds where status = 'open')
)
select label, expect, actual, (expect = actual) as ok from checks order by label;
