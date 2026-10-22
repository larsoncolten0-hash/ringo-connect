-- VERIFY for 2026-12-27_church_people_groups.sql — READ-ONLY (a single SELECT, no write). FOR OWNER REVIEW; run once AFTER the migration is applied.
-- Every row must show ok = true. It reads the catalog only: no church row is created, read or changed.

with
fk(conname, act) as (
  values ('church_members_profile_id_fkey', 'c'), ('church_members_user_id_fkey', 'n'), ('church_members_customer_id_fkey', 'n'), ('church_members_guardian_fk', 'a'),
         ('church_groups_profile_id_fkey', 'c'), ('church_group_members_profile_id_fkey', 'c'), ('church_group_members_group_fk', 'c'), ('church_group_members_member_fk', 'c'),
         ('church_leadership_profile_id_fkey', 'c'), ('church_leadership_member_fk', 'c')
),
tabs(t) as (values ('church_members'), ('church_groups'), ('church_group_members'), ('church_leadership')),
checks(label, expect, actual) as (
  select '01 the four tables exist', '4', (select count(*)::text from tabs where to_regclass('public.' || t) is not null)
  union all select '02 row-level security is on for all four', '4', (select count(*)::text from pg_class c join tabs on c.oid = to_regclass('public.' || tabs.t) where c.relrowsecurity)
  union all select '03 anon has NO privilege on any of them (0 expected)', '0',
         (select count(*)::text from tabs where to_regclass('public.' || t) is not null and (has_table_privilege('anon', 'public.' || t, 'select') or has_table_privilege('anon', 'public.' || t, 'insert') or has_table_privilege('anon', 'public.' || t, 'update') or has_table_privilege('anon', 'public.' || t, 'delete')))
  union all select '04 PUBLIC has NO privilege on any of them (0 expected)', '0', (select count(*)::text from tabs where to_regclass('public.' || t) is not null and has_table_privilege('public', 'public.' || t, 'select, insert, update, delete'))
  union all select '05 every policy on the four tables is limited to the authenticated role (0 outside it)', '0',
         (select count(*)::text from pg_policy p where p.polrelid in (select to_regclass('public.' || t) from tabs) and p.polroles <> array[(select oid from pg_roles where rolname = 'authenticated')])
  union all select '06 church_members: 7 permissive + 4 restrictive policies', '7+4',
         (select count(*) filter (where polpermissive)::text || '+' || count(*) filter (where not polpermissive)::text from pg_policy where polrelid = to_regclass('public.church_members'))
  union all select '07 church_groups: 4 permissive + 1 restrictive', '4+1',
         (select count(*) filter (where polpermissive)::text || '+' || count(*) filter (where not polpermissive)::text from pg_policy where polrelid = to_regclass('public.church_groups'))
  union all select '08 church_group_members: 4 permissive + 4 restrictive', '4+4',
         (select count(*) filter (where polpermissive)::text || '+' || count(*) filter (where not polpermissive)::text from pg_policy where polrelid = to_regclass('public.church_group_members'))
  union all select '09 church_leadership: 4 permissive + 1 restrictive', '4+1',
         (select count(*) filter (where polpermissive)::text || '+' || count(*) filter (where not polpermissive)::text from pg_policy where polrelid = to_regclass('public.church_leadership'))
  union all select '10 all ten foreign keys exist, are validated and have the reviewed delete action', '10',
         (select count(*)::text from fk where exists (select 1 from pg_constraint c where c.contype = 'f' and c.conname = fk.conname and c.convalidated and c.confdeltype = fk.act::"char"))
  union all select '11 the four child-integrity constraints exist and are validated', '4',
         (select count(*)::text from pg_constraint where conrelid = to_regclass('public.church_members') and contype = 'c' and convalidated
            and conname in ('church_members_child_guardian_check', 'church_members_child_minimal_check', 'church_members_adult_no_guardian_check', 'church_members_no_self_guardian_check'))
  union all select '12 the composite keys exist (members, groups unique on id + profile_id)', '2',
         (select count(*)::text from pg_constraint where contype = 'u' and conname in ('church_members_id_profile_key', 'church_groups_id_profile_key'))
  union all select '13 the twelve new triggers exist and are enabled', '12',
         (select count(*)::text from pg_trigger where not tgisinternal and tgenabled = 'O' and tgname in
            ('church_tenant_guard_trg', 'church_members_guard_trg', 'church_members_age_sync_trg', 'church_groups_delete_guard_trg', 'church_group_members_guard_trg', 'church_leadership_guard_trg',
             'organization_roles_church_guard_trg', 'organization_members_church_guard_trg', 'organization_invitations_church_guard_trg'))
  union all select '14 every pre-existing trigger on the three Team tables is still enabled (0 disabled expected)', '0',
         (select count(*)::text from pg_trigger where not tgisinternal and tgenabled <> 'O' and tgrelid in ('public.organization_roles'::regclass, 'public.organization_members'::regclass, 'public.organization_invitations'::regclass))
  union all select '15 the seven policy helpers are executable by authenticated and NOT by anon or PUBLIC', '7/0',
         (select count(*) filter (where has_function_privilege('authenticated', p.oid, 'execute'))::text || '/' || count(*) filter (where has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('public', p.oid, 'execute'))::text
            from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('church_is_owner', 'church_has_permission', 'is_church_profile', 'church_is_group_leader', 'church_is_group_member', 'church_member_in_led_group', 'church_member_is_me'))
  union all select '16 no API role (anon, authenticated, service_role, PUBLIC) can execute a guard or grant-guard function (0 expected)', '0',
         (select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace
            and p.proname in ('church_tenant_guard', 'church_members_guard', 'church_group_members_guard', 'church_leadership_guard', 'church_members_age_sync', 'church_groups_delete_guard', 'team_church_permissions', 'team_church_permission_tier', 'team_church_change_denied', 'team_role_church_permissions', 'organization_roles_church_guard', 'organization_members_church_guard', 'organization_invitations_church_guard')
            and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute') or has_function_privilege('public', p.oid, 'execute')))
  union all select '17 the shared helper has_org_permission was not replaced by a church variant: it still reads is_admin() (1 expected)', '1',
         (select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace and proname = 'has_org_permission' and prosrc like '%is_admin()%')
  union all select '18 the age-group helper church_member_age_group does not exist (0 expected: no function may tell anyone another person''s age group)', '0',
         (select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace and proname = 'church_member_age_group')
  union all select '19 authenticated holds select, insert, update and delete on all four tables (4 expected) and none holds TRUNCATE, REFERENCES or TRIGGER (0 expected)', '4/0',
         (select count(*) filter (where has_table_privilege('authenticated', to_regclass('public.' || t), 'select') and has_table_privilege('authenticated', to_regclass('public.' || t), 'insert') and has_table_privilege('authenticated', to_regclass('public.' || t), 'update') and has_table_privilege('authenticated', to_regclass('public.' || t), 'delete'))::text
              || '/' || count(*) filter (where has_table_privilege('authenticated', to_regclass('public.' || t), 'truncate') or has_table_privilege('authenticated', to_regclass('public.' || t), 'references') or has_table_privilege('authenticated', to_regclass('public.' || t), 'trigger'))::text
            from tabs where to_regclass('public.' || t) is not null)
  union all select '20 exactly 20 functions carry this migration''s marker comment (so rollback can only ever drop its own)', '20',
         (select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace and obj_description(oid, 'pg_proc') = 'managed by 2026-12-27_church_people_groups.sql')
  union all select '21 the three Team guard triggers and the four tables carry the marker too (7 expected)', '7',
         ((select count(*) from pg_trigger where not tgisinternal and obj_description(oid, 'pg_trigger') = 'managed by 2026-12-27_church_people_groups.sql')
        + (select count(*) from tabs where obj_description(to_regclass('public.' || t), 'pg_class') = 'managed by 2026-12-27_church_people_groups.sql'))::text
  union all select '22 church_group_members.is_child agrees with every person''s age group (0 disagreements expected)', '0',
         (select count(*)::text from public.church_group_members gm join public.church_members m on m.id = gm.member_id and m.profile_id = gm.profile_id where gm.is_child is distinct from (m.age_group = 'child'))
  union all select '23 the four tables are empty right after the first apply (0 rows expected; skip this row if you have already used the feature)', '0',
         ((select count(*) from public.church_members) + (select count(*) from public.church_groups) + (select count(*) from public.church_group_members) + (select count(*) from public.church_leadership))::text
)
select label, expect, actual, (expect = actual) as ok from checks order by label;
