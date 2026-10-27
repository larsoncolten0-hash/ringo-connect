-- Churches & Ministries expansion, Phase 7 follow-up: lock the "giving" switch in the DATABASE — PROPOSED, NOT APPLIED. FOR OWNER REVIEW ONLY.
--
-- WHY: church_features.giving can be written by the church owner's own session (column grant plus owner policy). Only the application refused to switch it on (GIVING_AVAILABLE = false). An owner calling the
-- API directly could set giving = true. This migration makes the database refuse it too, using the same switch that already keeps funds from opening: church_giving_collection_open() (2027-01-10), which
-- answers false until the five financial decisions are made and a later migration replaces it.
--
--   NEW  function church_features_giving_lock() and trigger church_features_giving_lock_trg on church_features (before insert or update): refuses giving = true while collection is not open.
--
-- Nothing existing is changed: church_features, its guard, its policies and church_features_guard() are left exactly as 2027-01-07 made them. The lock applies to every writer, the service role included.
-- Rows that already say giving = false are not affected, and a church can always switch giving OFF.
--
-- SELF-VERIFYING, one transaction: preconditions first (including "no church has giving switched on"), postconditions last. Any RAISE rolls everything back. Re-runnable.
--
-- Depends on: 2027-01-07_church_bible_year.sql (church_features) and 2027-01-10_church_giving.sql (church_giving_collection_open).
-- Preflight (read-only, run BEFORE): supabase/support/2027-01-11_church_giving_lock.preflight.sql
-- Verify    (read-only, run AFTER):  supabase/support/2027-01-11_church_giving_lock.verify.sql
-- Rollback: supabase/support/2027-01-11_church_giving_lock.rollback.sql (touches no data).

begin;

set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- 0. PRECONDITIONS
-- ----------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.church_features') is null then raise exception 'precondition failed: church_features is missing (apply 2027-01-07 first)'; end if;
  if to_regprocedure('public.church_giving_collection_open()') is null then raise exception 'precondition failed: church_giving_collection_open() is missing (apply 2027-01-10 first)'; end if;
  if exists (select 1 from public.church_features where giving) then raise exception 'precondition failed: a church already has giving switched on; resolve that first'; end if;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'church_features_giving_lock'
               and coalesce(obj_description(oid, 'pg_proc'), '') <> 'managed by 2027-01-11_church_giving_lock.sql') then
    raise exception 'precondition failed: a function named church_features_giving_lock exists and is not managed by this migration';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 1. FUNCTION AND TRIGGER
-- ----------------------------------------------------------------------------
create or replace function public.church_features_giving_lock()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.giving is true and not public.church_giving_collection_open() then
    raise exception 'giving_collection_not_available' using errcode = '23514', detail = 'giving cannot be switched on: collecting money is not available yet';
  end if;
  return new;
end;
$$;
comment on function public.church_features_giving_lock() is 'managed by 2027-01-11_church_giving_lock.sql';
revoke all on function public.church_features_giving_lock() from public, anon, authenticated;

drop trigger if exists church_features_giving_lock_trg on public.church_features;
create trigger church_features_giving_lock_trg before insert or update on public.church_features for each row execute function public.church_features_giving_lock();
comment on trigger church_features_giving_lock_trg on public.church_features is 'managed by 2027-01-11_church_giving_lock.sql';

-- ----------------------------------------------------------------------------
-- 2. POSTCONDITIONS (any failure rolls the whole file back)
-- ----------------------------------------------------------------------------
do $$
begin
  if (select count(*) from pg_trigger where not tgisinternal and tgname = 'church_features_giving_lock_trg' and tgrelid = 'public.church_features'::regclass) <> 1 then raise exception 'postcondition failed: trigger'; end if;
  if has_function_privilege('anon', 'public.church_features_giving_lock()', 'execute') or has_function_privilege('authenticated', 'public.church_features_giving_lock()', 'execute') or has_function_privilege('public', 'public.church_features_giving_lock()', 'execute') then
    raise exception 'postcondition failed: the lock function is callable by an API role';
  end if;
  if public.church_giving_collection_open() then raise exception 'postcondition failed: collection must be closed'; end if;
end $$;

commit;
