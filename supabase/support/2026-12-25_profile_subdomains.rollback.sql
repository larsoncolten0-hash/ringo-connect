-- Rollback for 2026-12-25_profile_subdomains.sql: removes the function and the two tables it created (and with them every claimed and retired address). Nothing else is touched.
begin;
drop function if exists public.claim_profile_subdomain(uuid, text, integer);
drop table if exists public.profile_subdomain_retired;
drop table if exists public.profile_subdomains;
commit;
