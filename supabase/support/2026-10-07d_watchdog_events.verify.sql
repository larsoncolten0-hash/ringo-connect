-- READ-ONLY check for 2026-10-07d_watchdog_events.sql. One SELECT; changes nothing. Every P row should say PASS; the I rows are information.
select 'P1' grp, 'watchdog_events exists with RLS enabled' item,
       coalesce((select c.relrowsecurity::text from pg_class c where c.oid = to_regclass('public.watchdog_events')), 'missing') value,
       case when coalesce((select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.watchdog_events')), false) then 'PASS' else 'FAIL' end status
union all
select 'P2', 'anon has no access; authenticated can only SELECT (RLS then limits that to admins)',
       coalesce((select string_agg(distinct r || ':' || p, ',') from (values ('anon'), ('authenticated')) v(r), (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) q(p)
                  where to_regclass('public.watchdog_events') is not null and has_table_privilege(r, 'public.watchdog_events', p)), 'none'),
       case when to_regclass('public.watchdog_events') is null then 'FAIL'
            when has_table_privilege('anon', 'public.watchdog_events', 'SELECT') or has_table_privilege('anon', 'public.watchdog_events', 'INSERT')
              or has_table_privilege('authenticated', 'public.watchdog_events', 'INSERT') or has_table_privilege('authenticated', 'public.watchdog_events', 'UPDATE')
              or has_table_privilege('authenticated', 'public.watchdog_events', 'DELETE') then 'FAIL' else 'PASS' end
union all
select 'P3', 'the only policy is the admin read policy',
       coalesce((select string_agg(policyname || ' (' || cmd || ')', ', ') from pg_policies where schemaname = 'public' and tablename = 'watchdog_events'), 'none'),
       case when (select count(*) from pg_policies where schemaname = 'public' and tablename = 'watchdog_events') = 1
             and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'watchdog_events' and policyname = 'watchdog_events admin read' and cmd = 'SELECT') then 'PASS' else 'FAIL' end
union all
select 'P4', 'append-only trigger present and enabled',
       case when exists (select 1 from pg_trigger g where g.tgrelid = to_regclass('public.watchdog_events') and g.tgname = 'watchdog_events_guard_trg' and g.tgenabled = 'O' and not g.tgisinternal) then 'present+enabled' else 'MISSING' end,
       case when exists (select 1 from pg_trigger g where g.tgrelid = to_regclass('public.watchdog_events') and g.tgname = 'watchdog_events_guard_trg' and g.tgenabled = 'O' and not g.tgisinternal) then 'PASS' else 'FAIL' end
union all
select 'P5', 'dedupe key is unique',
       case when exists (select 1 from pg_index i where i.indrelid = to_regclass('public.watchdog_events') and i.indisunique and pg_get_indexdef(i.indexrelid) like '%(dedupe_key)%') then 'unique' else 'MISSING' end,
       case when exists (select 1 from pg_index i where i.indrelid = to_regclass('public.watchdog_events') and i.indisunique and pg_get_indexdef(i.indexrelid) like '%(dedupe_key)%') then 'PASS' else 'FAIL' end
union all
select 'P6', 'the guard function has a pinned search_path and no API role can execute it',
       coalesce((select (p.proconfig::text like '%search_path%')::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'watchdog_events_guard'), 'missing'),
       case when coalesce((select p.proconfig::text like '%search_path%' from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'watchdog_events_guard'), false)
             and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                              where p.pronamespace = 'public'::regnamespace and p.proname = 'watchdog_events_guard' and a.privilege_type = 'EXECUTE'
                                and (a.grantee = 0 or pg_get_userbyid(a.grantee) in ('anon', 'authenticated', 'service_role'))) then 'PASS' else 'FAIL' end
union all
select 'I1', 'incidents recorded (all time)', coalesce((select count(*)::text from public.watchdog_events), 'n/a'), 'INFO'
union all
select 'I2', 'incidents still OPEN', coalesce((select count(*)::text from public.watchdog_events where status = 'open'), 'n/a'), 'INFO'
union all
select 'I3', 'OPEN incidents of severity HIGH', coalesce((select count(*)::text from public.watchdog_events where status = 'open' and severity = 'high'), 'n/a'), 'INFO'
order by 1;
