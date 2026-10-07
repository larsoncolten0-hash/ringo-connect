-- ============================================================================
-- VERIFICATION for supabase/migrations/2026-10-07a_team_permission_ceiling_guard.sql. READ-ONLY: ONE select over pg_catalog. No INSERT / UPDATE / DELETE /
-- DDL. Run it before (expect FAIL rows: nothing installed yet) and after applying (expect every row PASS).
-- ============================================================================
with rows_ as (
  select 'T1' as grp, t.tgname || ' exists, enabled, on ' || t.rel as item,
         coalesce((select g.tgenabled::text from pg_trigger g where g.tgrelid = t.rel::regclass and g.tgname = t.tgname and not g.tgisinternal), 'MISSING') as value,
         case when exists (select 1 from pg_trigger g where g.tgrelid = t.rel::regclass and g.tgname = t.tgname and g.tgenabled = 'O' and not g.tgisinternal) then 'PASS' else 'FAIL' end as status
    from (values ('organization_roles_ceiling_guard_trg', 'public.organization_roles'),
                 ('organization_members_ceiling_guard_trg', 'public.organization_members'),
                 ('organization_invitations_ceiling_guard_trg', 'public.organization_invitations')) t(tgname, rel)
  union all
  select 'T2', 'guard functions are SECURITY DEFINER with a pinned search_path',
         coalesce((select string_agg(p.proname, ', ') from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.proconfig::text like '%search_path%'
                    and p.proname in ('team_permissions_not_held', 'organization_roles_ceiling_guard', 'organization_members_ceiling_guard', 'organization_invitations_ceiling_guard')), 'none'),
         case when (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.proconfig::text like '%search_path%'
                     and p.proname in ('team_permissions_not_held', 'organization_roles_ceiling_guard', 'organization_members_ceiling_guard', 'organization_invitations_ceiling_guard')) = 4 then 'PASS' else 'FAIL' end
  union all
  select 'T3', 'no API role can EXECUTE any of the four functions',
         coalesce((select string_agg(distinct p.proname || ':' || coalesce(nullif(pg_get_userbyid(a.grantee), ''), 'PUBLIC'), ', ') from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                    where p.pronamespace = 'public'::regnamespace and p.proname in ('team_permissions_not_held', 'organization_roles_ceiling_guard', 'organization_members_ceiling_guard', 'organization_invitations_ceiling_guard')
                      and a.privilege_type = 'EXECUTE' and (a.grantee = 0 or pg_get_userbyid(a.grantee) in ('anon', 'authenticated', 'service_role'))), 'none'),
         case when (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('team_permissions_not_held', 'organization_roles_ceiling_guard', 'organization_members_ceiling_guard', 'organization_invitations_ceiling_guard')) = 4
                   and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                    where p.pronamespace = 'public'::regnamespace and p.proname in ('team_permissions_not_held', 'organization_roles_ceiling_guard', 'organization_members_ceiling_guard', 'organization_invitations_ceiling_guard')
                                      and a.privilege_type = 'EXECUTE' and (a.grantee = 0 or pg_get_userbyid(a.grantee) in ('anon', 'authenticated', 'service_role'))) then 'PASS' else 'FAIL' end
  union all
  select 'T4', 'the older Inbox guards are still in place (this migration must not replace them)',
         coalesce((select string_agg(tgname, ', ') from pg_trigger where not tgisinternal and tgname in ('organization_roles_inbox_guard_trg', 'organization_members_inbox_guard_trg', 'organization_invitations_inbox_guard_trg')), 'none'),
         case when (select count(*) from pg_trigger where not tgisinternal and tgname in ('organization_roles_inbox_guard_trg', 'organization_members_inbox_guard_trg', 'organization_invitations_inbox_guard_trg')) = 3 then 'PASS' else 'FAIL' end
  union all
  select 'T5', 'INFO: policies on the three team tables (names and commands)',
         coalesce((select string_agg(tablename || '/' || policyname || ' [' || cmd || ']', ' ; ') from pg_policies where schemaname = 'public' and tablename in ('organization_roles', 'organization_members', 'organization_invitations')), 'none'), 'INFO'
)
select grp, item, value, status from rows_
union all
select 'ZZ', 'OVERALL', case when exists (select 1 from rows_ where status = 'FAIL') then (select count(*)::text || ' check(s) FAILING' from rows_ where status = 'FAIL') else 'all checks pass' end,
       case when exists (select 1 from rows_ where status = 'FAIL') then 'FAIL' else 'PASS' end
order by 1, 2;
