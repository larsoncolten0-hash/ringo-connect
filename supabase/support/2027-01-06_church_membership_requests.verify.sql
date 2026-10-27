-- VERIFY for 2027-01-06_church_membership_requests.sql — READ-ONLY (a single SELECT, no write). FOR OWNER REVIEW; run once AFTER the migration is applied.
-- Every row must show ok = true. It reads the catalog only: no member, customer or connection is read.

with
checks(label, expect, actual) as (
  select '01 the two decision columns exist', '2',
         (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'church_members' and column_name in ('decided_at', 'decided_by'))
  union all select '02 every new object is marked as managed by this migration (2 columns, 2 functions, 1 trigger)', '5',
         ((select count(*) from pg_description d join pg_attribute a on a.attrelid = d.objoid and a.attnum = d.objsubid
            where d.classoid = 'pg_class'::regclass and d.objoid = 'public.church_members'::regclass and a.attname in ('decided_at', 'decided_by') and d.description = 'managed by 2027-01-06_church_membership_requests.sql')
          + (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('church_member_decision_guard', 'church_request_membership') and obj_description(oid, 'pg_proc') = 'managed by 2027-01-06_church_membership_requests.sql')
          + (select count(*) from pg_trigger where not tgisinternal and tgname = 'church_members_decision_guard_trg' and obj_description(oid, 'pg_trigger') = 'managed by 2027-01-06_church_membership_requests.sql'))::text
  union all select '03 the request function can be called by the service role ONLY', 'true/false/false/false',
         has_function_privilege('service_role', 'public.church_request_membership(uuid, uuid, text)', 'execute')::text || '/' || has_function_privilege('anon', 'public.church_request_membership(uuid, uuid, text)', 'execute')::text || '/'
         || has_function_privilege('authenticated', 'public.church_request_membership(uuid, uuid, text)', 'execute')::text || '/' || has_function_privilege('public', 'public.church_request_membership(uuid, uuid, text)', 'execute')::text
  union all select '04 the decision guard is callable by nobody (only the trigger runs it)', '0',
         (select count(*)::text from unnest(array['anon', 'authenticated', 'public']) r where has_function_privilege(r, 'public.church_member_decision_guard()', 'execute'))
  union all select '05 the additional update policy for join requests exists, is permissive, and needs the manage permission', 'true',
         (select (count(*) = 1)::text from pg_policy p where p.polname = 'church_members_update_requests' and p.polrelid = 'public.church_members'::regclass and p.polpermissive
            and pg_get_expr(p.polqual, p.polrelid) ilike '%join_request%' and pg_get_expr(p.polqual, p.polrelid) ilike '%church.members.manage%' and pg_get_expr(p.polwithcheck, p.polrelid) ilike '%join_request%')
  union all select '06 the Phase 2A policies of the roster are untouched (update, insert, delete, children-only, no-platform-admin)', '5',
         (select count(*)::text from pg_policy where polrelid = 'public.church_members'::regclass and polname in ('church_members_update', 'church_members_insert', 'church_members_delete', 'church_members_children_only', 'church_members_no_platform_admin'))
  union all select '07 the roster is still private: the public (anon) has no right on it', 'false',
         (select has_table_privilege('anon', 'public.church_members', 'select')::text)
  union all select '08 a join request can only be written as adult or youth by the function (the age check is in its body)', 'true',
         (select (position('church_request_age_group' in pg_get_functiondef('public.church_request_membership(uuid, uuid, text)'::regprocedure)) > 0)::text)
  union all select '09 the function takes the name, phone and e-mail from the visitor account (it reads ringo_customers)', 'true',
         (select (position('ringo_customers' in pg_get_functiondef('public.church_request_membership(uuid, uuid, text)'::regprocedure)) > 0)::text)
)
select label, expect, actual, (expect = actual) as ok from checks order by label;
