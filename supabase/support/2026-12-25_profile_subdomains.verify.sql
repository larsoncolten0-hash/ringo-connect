-- Read-only checks after applying 2026-12-25_profile_subdomains.sql. Every row should say ok = true.
select 'table profile_subdomains exists' as check, to_regclass('public.profile_subdomains') is not null as ok
union all
select 'table profile_subdomain_retired exists', to_regclass('public.profile_subdomain_retired') is not null
union all
select 'row level security on (both tables)', coalesce((select bool_and(relrowsecurity) from pg_class where oid in (to_regclass('public.profile_subdomains'), to_regclass('public.profile_subdomain_retired'))), false)
union all
select 'no policies (service role only)', not exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('profile_subdomains', 'profile_subdomain_retired'))
union all
select 'anon/authenticated have no table privileges', not exists (
  select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name in ('profile_subdomains', 'profile_subdomain_retired') and grantee in ('anon', 'authenticated')
)
union all
select 'subdomain is unique', exists (
  select 1 from pg_constraint where conrelid = to_regclass('public.profile_subdomains') and contype = 'u' and conname = 'profile_subdomains_subdomain_key'
)
union all
select 'one address per profile (primary key on profile_id)', exists (
  select 1 from pg_constraint where conrelid = to_regclass('public.profile_subdomains') and contype = 'p'
)
union all
select 'format checks present', (
  select count(*) from pg_constraint where conname in ('profile_subdomains_subdomain_format', 'profile_subdomain_retired_format')
) = 2
union all
select 'claim function exists, SECURITY DEFINER, search_path pinned', exists (
  select 1 from pg_proc p where p.proname = 'claim_profile_subdomain' and p.pronamespace = 'public'::regnamespace and p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
)
union all
select 'claim function: service_role only', has_function_privilege('service_role', 'public.claim_profile_subdomain(uuid, text, integer)', 'execute')
  and not has_function_privilege('anon', 'public.claim_profile_subdomain(uuid, text, integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.claim_profile_subdomain(uuid, text, integer)', 'execute');
