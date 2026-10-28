-- ACTIVATION of church giving — PROPOSED, NOT APPLIED, DELIBERATELY NOT IN supabase/migrations. DO NOT RUN until the pilot checklist in docs/church-giving-decisions.md is complete and the owner approves.
--
-- WHAT IT DOES: replaces church_giving_collection_open() so that it answers true ONLY while the platform kill switch church_giving_enabled is on. The switch is created here, OFF. So applying this file
-- opens nothing by itself: a SECOND, explicit step (update platform_settings set church_giving_enabled = true) is needed, and a church additionally needs church_features.giving = true and an open, published fund.
-- Together with the application flag GIVING_AVAILABLE (src/lib/church/features/handlers.ts), that is three independent keys, all of which must agree.
--
-- TURN OFF AGAIN at any time:  update public.platform_settings set church_giving_enabled = false;  (new gifts are refused at once; gifts already in flight are still settled).
-- Requires 2027-01-12_church_gifts.sql. Re-runnable.

begin;

do $$
begin
  if to_regclass('public.church_gifts') is null then raise exception 'precondition failed: apply 2027-01-12_church_gifts.sql first'; end if;
  if exists (select 1 from public.church_features where giving) then raise exception 'precondition failed: a church already has giving switched on'; end if;
end $$;

alter table public.platform_settings add column if not exists church_giving_enabled boolean not null default false;

create or replace function public.church_giving_collection_open()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$ select coalesce((select church_giving_enabled from public.platform_settings limit 1), false) $$;
comment on function public.church_giving_collection_open() is 'managed by 2027-01-10_church_giving.sql';
revoke all on function public.church_giving_collection_open() from public, anon, authenticated;
grant execute on function public.church_giving_collection_open() to service_role;

-- ONE PILOT CHURCH: the giving switch of a church can only be turned on when collection is open AND the church is on the pilot list (platform_settings.church_giving_pilot_profiles, empty by default).
-- Gifts are refused for any other church by the gift guard itself. The lock function below replaces the one of 2027-01-11 (same name, same trigger).
create or replace function public.church_features_giving_lock()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.giving is true and not (public.church_giving_collection_open() and public.church_giving_profile_allowed(new.profile_id)) then
    raise exception 'giving_collection_not_available' using errcode = '23514', detail = 'giving cannot be switched on: collecting money is not available for this church';
  end if;
  return new;
end;
$$;
comment on function public.church_features_giving_lock() is 'managed by 2027-01-11_church_giving_lock.sql';
revoke all on function public.church_features_giving_lock() from public, anon, authenticated;

do $$
begin
  if public.church_giving_collection_open() then raise exception 'postcondition failed: collection must still be closed after this file (the platform switch is off)'; end if;
end $$;

commit;

-- AFTER the pilot is approved, ONE separate statement per step:
--   0. update public.platform_settings set church_giving_pilot_profiles = array['<PILOT PROFILE UUID>']::uuid[];   (exactly one church)
--   1. update public.platform_settings set church_giving_enabled = true;
--   2. flip GIVING_AVAILABLE to true in src/lib/church/features/handlers.ts and deploy.
--   3. the pilot church's owner switches giving on in /dashboard/church/features, then opens one fund.
