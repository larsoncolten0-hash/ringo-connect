-- ROLLBACK for 2027-01-10_church_giving.sql — FOR OWNER REVIEW; do not run unless rolling back.
--
-- Removes exactly what that migration added: the funds table, the two functions and the trigger. It touches no other table (the Shop ledger and platform_settings were never changed).
--
-- DATA SAFETY: dropping the table deletes every fund definition. This file REFUSES to run while any fund exists. To drop them anyway, confirm the loss explicitly by adding this line as the FIRST
-- statement inside the transaction (same script, same transaction):
--     select set_config('church_giving.allow_data_loss', 'yes', true);
-- Safe to re-run: every drop is "if exists".
begin;

set local lock_timeout = '5s';

do $$
declare
  v_marker constant text := 'managed by 2027-01-10_church_giving.sql';
  v_rows bigint := 0;
  v_bad text;
begin
  if to_regclass('public.church_giving_funds') is not null then
    if coalesce(obj_description(to_regclass('public.church_giving_funds'), 'pg_class'), '') <> v_marker then raise exception 'rollback refused: public.church_giving_funds exists but is not managed by this migration'; end if;
    execute 'select count(*) from public.church_giving_funds' into v_rows;
  end if;
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname in ('church_giving_collection_open', 'church_giving_guard') and coalesce(obj_description(p.oid, 'pg_proc'), '') <> v_marker;
  if v_bad is not null then raise exception 'rollback refused: function(s) % exist but are not managed by this migration', v_bad; end if;
  if v_rows > 0 and coalesce(current_setting('church_giving.allow_data_loss', true), '') <> 'yes' then
    raise exception 'rollback refused: % fund(s) exist. Confirm the loss with: select set_config(''church_giving.allow_data_loss'', ''yes'', true);', v_rows;
  end if;
end $$;

drop table if exists public.church_giving_funds;
drop function if exists public.church_giving_guard();
drop function if exists public.church_giving_collection_open();

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'church_giving_funds') then raise exception 'rollback postcondition failed: the table is still there'; end if;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('church_giving_collection_open', 'church_giving_guard')) then raise exception 'rollback postcondition failed: a function is still there'; end if;
  if to_regclass('public.church_features') is null then raise exception 'rollback postcondition failed: an earlier table is gone'; end if;
end $$;

commit;
