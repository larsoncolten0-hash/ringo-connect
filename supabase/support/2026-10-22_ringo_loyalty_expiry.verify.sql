select check_name, expected, actual, case when expected = actual then 'OK' else 'MISMATCH' end as status
from (
  select 1 as n, 'loyalty_expiry_log exists' as check_name, 'true' as expected,
    (to_regclass('public.loyalty_expiry_log') is not null)::text as actual
  union all
  select 2, 'loyalty_sweep_expired(integer,integer) exists', 'true',
    (to_regprocedure('public.loyalty_sweep_expired(integer,integer)') is not null)::text
  union all
  select 3, 'RLS enabled on loyalty_expiry_log', 'true',
    coalesce((select relrowsecurity::text from pg_class where oid = to_regclass('public.loyalty_expiry_log')), 'missing')
  union all
  select 4, 'policies on loyalty_expiry_log', '0',
    (select count(*)::text from pg_policies where schemaname = 'public' and tablename = 'loyalty_expiry_log')
  union all
  select 5, 'anon table privileges', 'false',
    (has_table_privilege('anon', 'public.loyalty_expiry_log', 'select,insert,update,delete')
      or has_table_privilege('anon', 'public.loyalty_expiry_log', 'select')
      or has_table_privilege('anon', 'public.loyalty_expiry_log', 'insert')
      or has_table_privilege('anon', 'public.loyalty_expiry_log', 'update')
      or has_table_privilege('anon', 'public.loyalty_expiry_log', 'delete'))::text
  union all
  select 6, 'authenticated table privileges', 'false',
    (has_table_privilege('authenticated', 'public.loyalty_expiry_log', 'select')
      or has_table_privilege('authenticated', 'public.loyalty_expiry_log', 'insert')
      or has_table_privilege('authenticated', 'public.loyalty_expiry_log', 'update')
      or has_table_privilege('authenticated', 'public.loyalty_expiry_log', 'delete'))::text
  union all
  select 7, 'service_role can select the log', 'true',
    has_table_privilege('service_role', 'public.loyalty_expiry_log', 'select')::text
  union all
  select 8, 'service_role can write the log directly', 'false',
    (has_table_privilege('service_role', 'public.loyalty_expiry_log', 'insert')
      or has_table_privilege('service_role', 'public.loyalty_expiry_log', 'update')
      or has_table_privilege('service_role', 'public.loyalty_expiry_log', 'delete'))::text
  union all
  select 9, 'public (PUBLIC) can execute the sweep', 'false',
    exists (
      select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where p.oid = to_regprocedure('public.loyalty_sweep_expired(integer,integer)') and a.grantee = 0
    )::text
  union all
  select 10, 'anon can execute the sweep', 'false',
    has_function_privilege('anon', 'public.loyalty_sweep_expired(integer,integer)', 'execute')::text
  union all
  select 11, 'authenticated can execute the sweep', 'false',
    has_function_privilege('authenticated', 'public.loyalty_sweep_expired(integer,integer)', 'execute')::text
  union all
  select 12, 'service_role can execute the sweep', 'true',
    has_function_privilege('service_role', 'public.loyalty_sweep_expired(integer,integer)', 'execute')::text
  union all
  select 13, 'sweep is security definer', 'true',
    coalesce((select prosecdef::text from pg_proc where oid = to_regprocedure('public.loyalty_sweep_expired(integer,integer)')), 'missing')
  union all
  select 14, 'sweep search_path is pinned', 'true',
    coalesce((select (coalesce(proconfig::text, '') like '%search_path=public, pg_temp%')::text from pg_proc where oid = to_regprocedure('public.loyalty_sweep_expired(integer,integer)')), 'missing')
  union all
  select 15, 'unique constraint on (subject_kind, subject_id, event)', '1',
    (select count(*)::text from pg_constraint c
      where c.conrelid = to_regclass('public.loyalty_expiry_log') and c.contype = 'u'
        and pg_get_constraintdef(c.oid) = 'UNIQUE (subject_kind, subject_id, event)')
  union all
  select 16, 'check constraints on the log', '3',
    (select count(*)::text from pg_constraint c
      where c.conrelid = to_regclass('public.loyalty_expiry_log') and c.contype = 'c')
  union all
  select 17, 'approved loyalty tables present', '11',
    (select count(*)::text from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
        and (table_name like 'loyalty\_%' or table_name in ('customer_qr_codes', 'customer_loyalty_prefs'))
        and table_name <> 'loyalty_expiry_log')
  union all
  select 18, 'loyalty functions present (12 approved + 1 new)', '13',
    (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like 'loyalty\_%')
  union all
  select 19, 'rows in loyalty_expiry_log (must be 0 right after applying)', '0',
    (select count(*)::text from public.loyalty_expiry_log)
) v
order by n;
