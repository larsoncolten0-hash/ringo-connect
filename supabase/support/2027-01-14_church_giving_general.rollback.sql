-- ROLLBACK for 2027-01-14_church_giving_general.sql — puts the PILOT restriction back (function body of 2027-01-12). Touches no data. Safe to re-run.
-- Churches already switched on that are not on platform_settings.church_giving_pilot_profiles stay switched on but can no longer take NEW gifts (the gift guard refuses them).
begin;

create or replace function public.church_giving_profile_allowed(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$ select coalesce((select p_profile_id = any (church_giving_pilot_profiles) from public.platform_settings limit 1), false) $$;
comment on function public.church_giving_profile_allowed(uuid) is 'managed by 2027-01-12_church_gifts.sql';
revoke all on function public.church_giving_profile_allowed(uuid) from public, anon, authenticated;
grant execute on function public.church_giving_profile_allowed(uuid) to service_role;

commit;
