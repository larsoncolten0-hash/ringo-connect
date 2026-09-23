-- Read-only verification for 2026-10-26_ringo_ai_quota_reservations.sql.
-- Run after the migration. Every row should say ok = true.

select 'table ai_quota_reservations' as check_name,
       exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'ai_quota_reservations') as ok
union all
select 'rls enabled ai_quota_reservations',
       coalesce((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
                 where n.nspname = 'public' and c.relname = 'ai_quota_reservations'), false)
union all
select 'no insert/update/delete policies on ai_quota_reservations',
       not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = 'ai_quota_reservations'
                   and p.cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL'))
union all
select 'ai_reserve_quota exists',
       exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = 'ai_reserve_quota')
union all
select 'ai_reserve_quota not executable by anon/authenticated',
       not has_function_privilege('anon', 'public.ai_reserve_quota(uuid, int, bigint, numeric, bigint, numeric, int)', 'execute')
       and not has_function_privilege('authenticated', 'public.ai_reserve_quota(uuid, int, bigint, numeric, bigint, numeric, int)', 'execute')
union all
select 'ai_reserve_quota executable by service_role',
       has_function_privilege('service_role', 'public.ai_reserve_quota(uuid, int, bigint, numeric, bigint, numeric, int)', 'execute')
union all
select 'foundation ai_quota_snapshot still present (dependency)',
       exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = 'ai_quota_snapshot');
