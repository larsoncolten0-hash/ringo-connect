-- ============================================================================
-- B1 POST-MIGRATION VERIFICATION. ONE SELECT, writes nothing.
-- ACCURACY NOTE: it is not pure catalog introspection. It calls reconcile_association_links(false) (a
-- SECURITY DEFINER function whose false branch only counts) and evaluates the pure effective-state
-- function on four synthetic rows. Nothing is inserted, updated or deleted.
-- Result: grp | check_name | expected | actual | status. The last row is the summary; expect 0 FAIL.
-- ============================================================================
with
tabs(t) as (values ('association_membership_plans'), ('association_memberships'), ('association_audit_log')),
rpcs(name, args) as (values
  ('association_update_membership_settings', 'p_association_id uuid, p_actor uuid, p_enabled boolean, p_prefix text'),
  ('association_create_plan', 'p_association_id uuid, p_actor uuid, p_name_en text, p_name_fr text, p_description_en text, p_description_fr text, p_price_amount numeric, p_currency text, p_duration_months integer, p_grace_days integer, p_sort_order integer'),
  ('association_update_plan', 'p_plan_id uuid, p_actor uuid, p_name_en text, p_name_fr text, p_description_en text, p_description_fr text, p_price_amount numeric, p_currency text, p_duration_months integer, p_grace_days integer, p_sort_order integer'),
  ('association_set_plan_active', 'p_plan_id uuid, p_actor uuid, p_active boolean'),
  ('association_start_membership', 'p_association_id uuid, p_actor uuid, p_member_id uuid, p_plan_id uuid, p_starts_at timestamp with time zone'),
  ('association_activate_membership', 'p_membership_id uuid, p_actor uuid'),
  ('association_suspend_membership', 'p_membership_id uuid, p_actor uuid, p_reason text'),
  ('association_reinstate_membership', 'p_membership_id uuid, p_actor uuid'),
  ('association_renew_membership', 'p_membership_id uuid, p_actor uuid, p_plan_id uuid'),
  ('association_cancel_membership', 'p_membership_id uuid, p_actor uuid, p_reason text'),
  ('association_expire_memberships', 'p_association_id uuid, p_actor uuid, p_limit integer')
),
internal_fns(name) as (values ('_assoc_actor_can'), ('_assoc_membership_enabled'),
  ('_assoc_audit'), ('_assoc_materialize_expiry'), ('association_members_lifecycle_guard'), ('association_members_points_guard'),
  ('association_memberships_insert_guard'), ('association_memberships_update_guard'), ('association_audit_block_update')),
legacy_tabs(t) as (values ('association_members'), ('association_partners'), ('association_rewards'),
  ('association_settings'), ('association_point_transactions'), ('association_invitations')),
checks as (

  select 'V01' as grp, 'table ' || t as check_name, 'exists' as expected,
         case when to_regclass('public.' || t) is not null then 'exists' else 'MISSING' end as actual,
         case when to_regclass('public.' || t) is not null then 'PASS' else 'FAIL' end as status
  from tabs
  union all
  select 'V01', 'view association_memberships_effective', 'exists',
         case when to_regclass('public.association_memberships_effective') is not null then 'exists' else 'MISSING' end,
         case when to_regclass('public.association_memberships_effective') is not null then 'PASS' else 'FAIL' end
  union all
  select 'V01', 'column ' || v.c, 'exists', case when x.column_name is not null then 'exists' else 'MISSING' end,
         case when x.column_name is not null then 'PASS' else 'FAIL' end
  from (values ('association_members', 'lifecycle_state'), ('association_members', 'lifecycle_changed_at'), ('associations', 'membership_seq')) v(tb, c)
  left join information_schema.columns x on x.table_schema = 'public' and x.table_name = v.tb and x.column_name = v.c
  union all
  select 'V01', 'NO payment column on the new tables', '0',
         (select count(*) from information_schema.columns where table_schema = 'public'
            and table_name in ('association_membership_plans', 'association_memberships', 'association_audit_log')
            and column_name ~* '(payment|fapshi|paid|transaction_id)')::text,
         case when (select count(*) from information_schema.columns where table_schema = 'public'
            and table_name in ('association_membership_plans', 'association_memberships', 'association_audit_log')
            and column_name ~* '(payment|fapshi|paid|transaction_id)') = 0 then 'PASS' else 'FAIL' end

  union all
  select 'V02', 'RPC ' || r.name, 'definer + pinned search_path + service_role only',
         coalesce('definer=' || p.prosecdef::text || ' cfg=' || coalesce(p.proconfig::text, 'NONE')
           || ' service_role=' || has_function_privilege('service_role', p.oid, 'EXECUTE')::text
           || ' authenticated=' || has_function_privilege('authenticated', p.oid, 'EXECUTE')::text
           || ' anon=' || has_function_privilege('anon', p.oid, 'EXECUTE')::text
           || ' PUBLIC=' || exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)::text, 'MISSING'),
         case when p.oid is not null and p.prosecdef and p.proconfig::text like '%pg_catalog, public, pg_temp%'
                   and pg_get_function_identity_arguments(p.oid) = r.args
                   and has_function_privilege('service_role', p.oid, 'EXECUTE')
                   and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
                   and not has_function_privilege('anon', p.oid, 'EXECUTE')
                   and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0) then 'PASS' else 'FAIL' end
  from rpcs r left join pg_proc p on p.pronamespace = 'public'::regnamespace and p.proname = r.name
  union all
  select 'V03', 'pure function association_membership_effective_state: service_role only', 'service_role yes; authenticated/anon/PUBLIC no',
         coalesce('service_role=' || has_function_privilege('service_role', p.oid, 'EXECUTE')::text
           || ' authenticated=' || has_function_privilege('authenticated', p.oid, 'EXECUTE')::text
           || ' anon=' || has_function_privilege('anon', p.oid, 'EXECUTE')::text
           || ' PUBLIC=' || exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)::text, 'MISSING'),
         case when p.oid is not null and has_function_privilege('service_role', p.oid, 'EXECUTE')
                   and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
                   and not has_function_privilege('anon', p.oid, 'EXECUTE')
                   and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0) then 'PASS' else 'FAIL' end
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'association_membership_effective_state'
  union all
  select 'V03', 'internal function ' || f.name || ' not executable by any API role', 'anon/authenticated/service_role/PUBLIC all false',
         coalesce('service_role=' || has_function_privilege('service_role', p.oid, 'EXECUTE')::text
           || ' authenticated=' || has_function_privilege('authenticated', p.oid, 'EXECUTE')::text
           || ' anon=' || has_function_privilege('anon', p.oid, 'EXECUTE')::text
           || ' PUBLIC=' || exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)::text, 'MISSING'),
         case when p.oid is not null and not has_function_privilege('service_role', p.oid, 'EXECUTE')
                   and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
                   and not has_function_privilege('anon', p.oid, 'EXECUTE')
                   and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0) then 'PASS' else 'FAIL' end
  from internal_fns f left join pg_proc p on p.pronamespace = 'public'::regnamespace and p.proname = f.name

  union all
  select 'V04', 'triggers on ' || v.tb, v.expected,
         coalesce((select string_agg(tg.tgname, ', ' order by tg.tgname) from pg_trigger tg where tg.tgrelid = ('public.' || v.tb)::regclass and not tg.tgisinternal), '(none)'),
         case when coalesce((select string_agg(tg.tgname, ', ' order by tg.tgname) from pg_trigger tg where tg.tgrelid = ('public.' || v.tb)::regclass and not tg.tgisinternal), '(none)') = v.expected then 'PASS' else 'FAIL' end
  from (values
    ('association_members', 'trg_association_members_lifecycle, trg_association_members_points_guard, trg_sync_association_id'),
    ('association_memberships', 'trg_association_memberships_insert_guard, trg_association_memberships_update_guard'),
    ('association_audit_log', 'trg_association_audit_block_update')) v(tb, expected)

  union all
  select 'V05', 'FK ' || v.name, v.expected,
         coalesce('delete=' || c.confdeltype::text || ' deferrable=' || c.condeferrable::text || ' deferred=' || c.condeferred::text, 'MISSING'),
         case when c.oid is not null and c.confdeltype = v.del and c.condeferrable = v.dfr and c.condeferred = v.dfr then 'PASS' else 'FAIL' end
  from (values
    ('association_memberships_association_fk', 'CASCADE', 'c', false),
    ('association_memberships_member_fk', 'CASCADE (member delete)', 'c', false),
    ('association_memberships_plan_fk', 'NO ACTION, deferred (history never cascades away)', 'a', true),
    ('association_memberships_renewed_from_fk', 'NO ACTION, deferred', 'a', true)) v(name, expected, del, dfr)
  left join pg_constraint c on c.conrelid = 'public.association_memberships'::regclass and c.conname = v.name
  union all
  select 'V05', 'every FK referencing associations is CASCADE', '(none non-cascade)',
         coalesce((select string_agg(con.conrelid::regclass::text || '.' || con.conname, ', ') from pg_constraint con
                   where con.contype = 'f' and con.confrelid = 'public.associations'::regclass and con.confdeltype <> 'c'), '(none non-cascade)'),
         case when not exists (select 1 from pg_constraint con where con.contype = 'f' and con.confrelid = 'public.associations'::regclass and con.confdeltype <> 'c') then 'PASS' else 'FAIL' end
  union all
  select 'V05', 'no new table references users/profiles (demo cleanup safe)', '0',
         (select count(*) from pg_constraint con where con.contype = 'f' and con.conrelid in (select ('public.' || t)::regclass from tabs)
            and con.confrelid in ('public.users'::regclass, 'public.profiles'::regclass))::text,
         case when (select count(*) from pg_constraint con where con.contype = 'f' and con.conrelid in (select ('public.' || t)::regclass from tabs)
            and con.confrelid in ('public.users'::regclass, 'public.profiles'::regclass)) = 0 then 'PASS' else 'FAIL' end
  union all
  select 'V05', 'index ' || v.iname, 'exists', case when i.indexrelid is not null then 'exists' else 'MISSING' end,
         case when i.indexrelid is not null then 'PASS' else 'FAIL' end
  from (values ('association_members_id_association_id_uidx'), ('association_memberships_one_current_uidx'),
               ('association_memberships_renewed_from_uidx'), ('association_memberships_number_root_uidx')) v(iname)
  left join pg_index i on i.indexrelid = to_regclass('public.' || v.iname)

  union all
  select 'V06', 'RLS + client privileges on ' || t, 'RLS on; authenticated/service_role SELECT only; anon none; no PUBLIC',
         'rls=' || c.relrowsecurity::text || ' authenticated=' || coalesce((select string_agg(pr, ',' order by pr) from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) pr where has_table_privilege('authenticated', c.oid, pr)), 'none')
           || ' service_role=' || coalesce((select string_agg(pr, ',' order by pr) from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) pr where has_table_privilege('service_role', c.oid, pr)), 'none')
           || ' anon=' || coalesce((select string_agg(pr, ',' order by pr) from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) pr where has_table_privilege('anon', c.oid, pr)), 'none'),
         case when c.relrowsecurity and not c.relforcerowsecurity
                   and (select string_agg(pr, ',' order by pr) from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) pr where has_table_privilege('authenticated', c.oid, pr)) = 'SELECT'
                   and (select string_agg(pr, ',' order by pr) from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) pr where has_table_privilege('service_role', c.oid, pr)) = 'SELECT'
                   and not exists (select 1 from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) pr where has_table_privilege('anon', c.oid, pr))
                   and not exists (select 1 from aclexplode(c.relacl) a where a.grantee = 0) then 'PASS' else 'FAIL' end
  from tabs join pg_class c on c.oid = ('public.' || tabs.t)::regclass
  union all
  select 'V06', 'view association_memberships_effective readable by service_role only', 'service_role yes; authenticated/anon no',
         'service_role=' || has_table_privilege('service_role', 'public.association_memberships_effective'::regclass, 'SELECT')::text
           || ' authenticated=' || has_table_privilege('authenticated', 'public.association_memberships_effective'::regclass, 'SELECT')::text
           || ' anon=' || has_table_privilege('anon', 'public.association_memberships_effective'::regclass, 'SELECT')::text,
         case when has_table_privilege('service_role', 'public.association_memberships_effective'::regclass, 'SELECT')
                   and not has_table_privilege('authenticated', 'public.association_memberships_effective'::regclass, 'SELECT')
                   and not has_table_privilege('anon', 'public.association_memberships_effective'::regclass, 'SELECT') then 'PASS' else 'FAIL' end
  union all
  select 'V06', 'policies on the new tables', '3 SELECT policies, authenticated only',
         coalesce((select string_agg(tablename || ':' || cmd || ':' || roles::text, ', ' order by tablename) from pg_policies
                    where schemaname = 'public' and tablename in (select t from tabs)), '(none)'),
         case when (select count(*) from pg_policies where schemaname = 'public' and tablename in (select t from tabs)) = 3
                   and (select count(*) from pg_policies where schemaname = 'public' and tablename in (select t from tabs) and cmd = 'SELECT' and roles::text = '{authenticated}') = 3
              then 'PASS' else 'FAIL' end
  union all
  select 'V06', 'no is_admin() in the new policies', '0',
         (select count(*) from pg_policies where schemaname = 'public' and tablename in (select t from tabs) and qual like '%is_admin%')::text,
         case when (select count(*) from pg_policies where schemaname = 'public' and tablename in (select t from tabs) and qual like '%is_admin%') = 0 then 'PASS' else 'FAIL' end

  union all
  select 'V07', 'earn/redeem ' || p.proname || ' unchanged shape', 'definer, search_path public, NO exception handler, not executable by anon/authenticated/PUBLIC',
         'definer=' || p.prosecdef::text || ' cfg=' || coalesce(p.proconfig::text, 'NONE') || ' exception_handler=' || (position('exception' in lower(p.prosrc)) > 0)::text
           || ' authenticated=' || has_function_privilege('authenticated', p.oid, 'EXECUTE')::text || ' anon=' || has_function_privilege('anon', p.oid, 'EXECUTE')::text,
         case when p.prosecdef and p.proconfig::text like '%search_path=public%' and position('exception' in lower(p.prosrc)) = 0
                   and not has_function_privilege('authenticated', p.oid, 'EXECUTE') and not has_function_privilege('anon', p.oid, 'EXECUTE')
                   and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0) then 'PASS' else 'FAIL' end
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('log_association_earn', 'log_association_redeem')
  union all
  select 'V07', 'existing members are still legacy (lifecycle_state NULL)', 'every member NULL',
         (select count(*) filter (where lifecycle_state is not null) from public.association_members)::text || ' managed of ' || (select count(*) from public.association_members)::text,
         case when (select count(*) from public.association_members where lifecycle_state is not null) = 0 then 'PASS' else 'FAIL' end
  union all
  select 'V07', 'legacy table privileges (informational: compare with your Phase A / preflight listing, B1 changes none)', 'unchanged', c.relname || ' = ' || coalesce(c.relacl::text, 'default'), 'INFO'
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in (select t from legacy_tabs)

  union all
  select 'V08', v.k, v.exp, v.n::text, case when v.n::text = v.exp then 'PASS' else 'FAIL' end
  from (values
    ('plans / memberships / audit rows right after migration', '0 / 0 / 0',
       ((select count(*) from public.association_membership_plans)::text || ' / ' || (select count(*) from public.association_memberships)::text || ' / ' || (select count(*) from public.association_audit_log)::text)),
    ('associations with membership_seq <> 0', '0', (select count(*) from public.associations where membership_seq <> 0)::text),
    ('associations with Membership ENABLED (default OFF)', '0', (select count(*) from public.associations where public._assoc_membership_enabled(id))::text),
    ('members with balance <> ledger sum', '0', (select count(*) from (select m.id from public.association_members m left join public.association_point_transactions t on t.member_id = m.id group by m.id, m.points_balance having m.points_balance <> coalesce(sum(t.points_delta), 0)) d)::text),
    ('total balance minus total ledger', '0', ((select coalesce(sum(points_balance), 0) from public.association_members) - (select coalesce(sum(points_delta), 0) from public.association_point_transactions))::text),
    ('reconcile_association_links(false) gaps', '0', (select coalesce(sum(r.gaps_after), 0) from public.reconcile_association_links(false) r)::text)
  ) as v(k, exp, n)

  union all
  select 'V10', 'association_members owner (informational)', 'the role that runs migrations',
         pg_get_userbyid(c.relowner), 'INFO'
  from pg_class c where c.oid = 'public.association_members'::regclass
  union all
  select 'V10', 'no API role is, or can become, the table owner', 'none of anon / authenticated / service_role / authenticator',
         coalesce((select string_agg(r.rolname::text, ', ') from pg_roles r
                    where r.rolname in ('anon', 'authenticated', 'service_role', 'authenticator') and (r.rolname::text = o.owner or pg_has_role(r.rolname::text, o.owner, 'MEMBER'))), 'none'),
         case when not exists (select 1 from pg_roles r where r.rolname in ('anon', 'authenticated', 'service_role', 'authenticator')
                                 and (r.rolname::text = o.owner or pg_has_role(r.rolname::text, o.owner, 'MEMBER'))) then 'PASS' else 'FAIL' end
  from (select pg_get_userbyid(relowner) as owner from pg_class where oid = 'public.association_members'::regclass) o
  union all
  select 'V10', 'B1 functions and earn/redeem are owned by the table owner', '0 functions with a different owner',
         coalesce((select string_agg(p.proname || ' (' || pg_get_userbyid(p.proowner) || ')', ', ') from pg_proc p
                    where p.pronamespace = 'public'::regnamespace and p.proname in ('association_update_membership_settings', 'association_create_plan', 'association_update_plan',
      'association_set_plan_active', 'association_start_membership', 'association_activate_membership',
      'association_suspend_membership', 'association_reinstate_membership', 'association_renew_membership',
      'association_cancel_membership', 'association_expire_memberships', 'association_membership_effective_state',
      '_assoc_actor_can', '_assoc_membership_enabled', '_assoc_audit', '_assoc_materialize_expiry',
      'association_members_lifecycle_guard', 'association_members_points_guard', 'association_memberships_insert_guard',
      'association_memberships_update_guard', 'association_audit_block_update', 'log_association_earn', 'log_association_redeem')
                      and pg_get_userbyid(p.proowner) is distinct from o.owner), '0 functions with a different owner'),
         case when not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('association_update_membership_settings', 'association_create_plan', 'association_update_plan',
      'association_set_plan_active', 'association_start_membership', 'association_activate_membership',
      'association_suspend_membership', 'association_reinstate_membership', 'association_renew_membership',
      'association_cancel_membership', 'association_expire_memberships', 'association_membership_effective_state',
      '_assoc_actor_can', '_assoc_membership_enabled', '_assoc_audit', '_assoc_materialize_expiry',
      'association_members_lifecycle_guard', 'association_members_points_guard', 'association_memberships_insert_guard',
      'association_memberships_update_guard', 'association_audit_block_update', 'log_association_earn', 'log_association_redeem')
                                 and pg_get_userbyid(p.proowner) is distinct from o.owner) then 'PASS' else 'FAIL' end
  from (select pg_get_userbyid(relowner) as owner from pg_class where oid = 'public.association_members'::regclass) o
  union all
  select 'V10', 'lifecycle and points guards are SECURITY INVOKER (their owner check reads current_user)', '2 guards, both invoker',
         (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
            and p.proname in ('association_members_lifecycle_guard', 'association_members_points_guard') and not p.prosecdef)::text || ' invoker of 2',
         case when (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
            and p.proname in ('association_members_lifecycle_guard', 'association_members_points_guard') and not p.prosecdef) = 2 then 'PASS' else 'FAIL' end
  union all
  select 'V10', 'public functions whose source mentions points_balance (informational writer inventory)',
         'expected: log_association_earn, log_association_redeem (plus any pre-existing reader)',
         coalesce((select string_agg(p.proname || case when p.prosecdef then ' [definer]' else ' [invoker]' end, ', ' order by p.proname)
                     from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.prosrc ilike '%points_balance%'), '(none)'),
         'INFO'
  union all
  select 'V09', 'effective state: ' || v.label, v.exp, public.association_membership_effective_state(v.r), case when public.association_membership_effective_state(v.r) = v.exp then 'PASS' else 'FAIL' end
  from (values
    ('active, term still running', 'active',
       row(null::uuid, null::uuid, null::uuid, null::uuid, 'X-000001', 'active', now() - interval '10 days', now() + interval '20 days', 0, 0::numeric, 'XAF', now(), null::uuid, null::text, null::timestamptz, null::text, null::uuid, now(), now())::public.association_memberships),
    ('active, ended past grace (no sweep needed)', 'expired',
       row(null::uuid, null::uuid, null::uuid, null::uuid, 'X-000001', 'active', now() - interval '40 days', now() - interval '10 days', 3, 0::numeric, 'XAF', now(), null::uuid, null::text, null::timestamptz, null::text, null::uuid, now(), now())::public.association_memberships),
    ('suspended, ended past grace', 'expired',
       row(null::uuid, null::uuid, null::uuid, null::uuid, 'X-000001', 'suspended', now() - interval '40 days', now() - interval '10 days', 0, 0::numeric, 'XAF', now(), null::uuid, null::text, null::timestamptz, null::text, null::uuid, now(), now())::public.association_memberships),
    ('pending is never eligible even after its start date', 'pending',
       row(null::uuid, null::uuid, null::uuid, null::uuid, 'X-000001', 'pending', now() - interval '5 days', now() + interval '20 days', 0, 0::numeric, 'XAF', null::timestamptz, null::uuid, null::text, null::timestamptz, null::text, null::uuid, now(), now())::public.association_memberships)
  ) as v(label, exp, r)
)
select grp, check_name, expected, actual, status from checks
union all
select 'ZZ', 'SUMMARY (INFO rows excluded)', 'every check PASS',
       count(*) filter (where status = 'PASS')::text || ' PASS / ' || count(*) filter (where status = 'FAIL')::text || ' FAIL',
       case when count(*) filter (where status = 'FAIL') = 0 then 'PASS' else 'FAIL' end
from checks
order by 1, 2;
