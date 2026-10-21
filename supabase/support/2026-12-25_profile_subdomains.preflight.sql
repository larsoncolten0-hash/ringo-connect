-- Read-only preflight for 2026-12-25_profile_subdomains.sql. Run BEFORE applying. Every row should say ok = true; it changes nothing.
select 'profiles table exists' as check, to_regclass('public.profiles') is not null as ok
union all
select 'profiles.id is a uuid primary key', exists (
  select 1 from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
  where c.conrelid = to_regclass('public.profiles') and c.contype = 'p' and a.attname = 'id' and a.atttypid = 'uuid'::regtype
)
union all
select 'profiles.username is text', exists (
  select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'username' and data_type = 'text'
)
union all
select 'role service_role exists', exists (select 1 from pg_roles where rolname = 'service_role')
union all
select 'roles anon and authenticated exist', (select count(*) from pg_roles where rolname in ('anon', 'authenticated')) = 2
union all
select 'no object of this name exists yet (tables and function are new)', to_regclass('public.profile_subdomains') is null
  and to_regclass('public.profile_subdomain_retired') is null
  and not exists (select 1 from pg_proc where proname = 'claim_profile_subdomain' and pronamespace = 'public'::regnamespace)
union all
select 'server supports hashtextextended (PostgreSQL 11+)', current_setting('server_version_num')::int >= 110000;
