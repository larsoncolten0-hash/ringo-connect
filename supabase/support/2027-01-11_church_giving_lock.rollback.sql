-- ROLLBACK for 2027-01-11_church_giving_lock.sql — FOR OWNER REVIEW; do not run unless rolling back.
--
-- Removes exactly what that migration added: the lock trigger and its function. It touches no data and no other object (church_features and its guard stay as 2027-01-07 made them).
-- Safe to re-run: every drop is "if exists".
begin;

set local lock_timeout = '5s';

do $$
declare
  v_marker constant text := 'managed by 2027-01-11_church_giving_lock.sql';
begin
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'church_features_giving_lock' and coalesce(obj_description(oid, 'pg_proc'), '') <> v_marker) then
    raise exception 'rollback refused: church_features_giving_lock exists but is not managed by this migration';
  end if;
end $$;

drop trigger if exists church_features_giving_lock_trg on public.church_features;
drop function if exists public.church_features_giving_lock();

do $$
begin
  if exists (select 1 from pg_trigger where not tgisinternal and tgname = 'church_features_giving_lock_trg') then raise exception 'rollback postcondition failed: the trigger is still there'; end if;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'church_features_giving_lock') then raise exception 'rollback postcondition failed: the function is still there'; end if;
  if to_regclass('public.church_features') is null then raise exception 'rollback postcondition failed: an earlier table is gone'; end if;
end $$;

commit;
