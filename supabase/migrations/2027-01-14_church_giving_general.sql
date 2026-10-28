-- Church giving, GENERAL RELEASE: every church (profile with the Churches & Ministries category) may take gifts — PROPOSED, NOT APPLIED. FOR OWNER APPROVAL.
--
-- WHAT IT CHANGES: exactly ONE function. church_giving_profile_allowed(uuid) (created by 2027-01-12 as a pilot list) now answers true for any church profile, instead of "only the ids in the pilot list".
-- That one function is the only place the pilot restriction lived in the database: the gift guard (church_gifts_guard) and the giving-switch lock (church_features_giving_lock, 2027-01-13) both ask it.
--
-- WHAT STAYS EXACTLY AS IT IS: the platform master switch (platform_settings.church_giving_enabled, read by church_giving_collection_open()), each church's own giving feature switch (church_features.giving),
-- the requirement that a fund is open AND published before it takes a gift, the minimum gift, every guard, and row-level security. No church is opened or published by this file: each church still switches giving
-- on for itself and opens its own funds. platform_settings.church_giving_pilot_profiles is left in place and simply unused (nothing is dropped, so the older files and their rollback still work).
--
-- TO CLOSE AGAIN to the pilot: re-create the function as in 2027-01-12 (see the rollback file next to this one), or switch the master switch off: update public.platform_settings set church_giving_enabled = false;
-- Requires 2027-01-12_church_gifts.sql and 2027-01-13 (activation). Verify (read-only, AFTER): supabase/support/2027-01-14_church_giving_general.verify.sql

begin;

set local lock_timeout = '5s';

do $$
begin
  if to_regprocedure('public.church_giving_profile_allowed(uuid)') is null then raise exception 'precondition failed: apply 2027-01-12_church_gifts.sql first'; end if;
  if to_regprocedure('public.is_church_profile(uuid)') is null then raise exception 'precondition failed: is_church_profile(uuid) is missing'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'platform_settings' and column_name = 'church_giving_enabled') then
    raise exception 'precondition failed: the activation file 2027-01-13 has not been applied (platform_settings.church_giving_enabled is missing)';
  end if;
end $$;

create or replace function public.church_giving_profile_allowed(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$ select public.is_church_profile(p_profile_id) $$;
comment on function public.church_giving_profile_allowed(uuid) is 'managed by 2027-01-12_church_gifts.sql';
revoke all on function public.church_giving_profile_allowed(uuid) from public, anon, authenticated;
grant execute on function public.church_giving_profile_allowed(uuid) to service_role;

do $$
begin
  if public.church_giving_profile_allowed(gen_random_uuid()) then raise exception 'postcondition failed: an unknown profile must not be allowed'; end if;
  if has_function_privilege('anon', 'public.church_giving_profile_allowed(uuid)', 'execute') or has_function_privilege('authenticated', 'public.church_giving_profile_allowed(uuid)', 'execute') then
    raise exception 'postcondition failed: the function is callable by an API role';
  end if;
end $$;

commit;
