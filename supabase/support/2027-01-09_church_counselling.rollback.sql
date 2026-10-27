-- ROLLBACK for 2027-01-09_church_counselling.sql — FOR OWNER REVIEW; do not run unless rolling back.
--
-- Removes exactly what that migration added: the two tables (the requests and their history), the three functions and the three triggers. It touches no other table.
--
-- DATA SAFETY: dropping the tables deletes every counselling request (names, phone numbers, reasons) and the history of decisions. This file REFUSES to run while any request exists. To drop them anyway,
-- confirm the loss explicitly by adding this line as the FIRST statement inside the transaction (same script, same transaction):
--     select set_config('church_counselling.allow_data_loss', 'yes', true);
-- Safe to re-run: every drop is "if exists".
begin;

set local lock_timeout = '5s';

do $$
declare
  v_marker constant text := 'managed by 2027-01-09_church_counselling.sql';
  v_rows bigint := 0;
  v_t text;
  v_n bigint;
  v_bad text;
begin
  foreach v_t in array array['church_counselling_requests', 'church_counselling_history'] loop
    if to_regclass('public.' || v_t) is not null then
      if coalesce(obj_description(to_regclass('public.' || v_t), 'pg_class'), '') <> v_marker then raise exception 'rollback refused: public.% exists but is not managed by this migration', v_t; end if;
      execute format('select count(*) from public.%I', v_t) into v_n;
      v_rows := v_rows + v_n;
    end if;
  end loop;
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname in ('church_counselling_guard', 'church_counselling_audit', 'church_counselling_history_guard') and coalesce(obj_description(p.oid, 'pg_proc'), '') <> v_marker;
  if v_bad is not null then raise exception 'rollback refused: function(s) % exist but are not managed by this migration', v_bad; end if;
  if v_rows > 0 and coalesce(current_setting('church_counselling.allow_data_loss', true), '') <> 'yes' then
    raise exception 'rollback refused: % row(s) exist. Confirm the loss with: select set_config(''church_counselling.allow_data_loss'', ''yes'', true);', v_rows;
  end if;
end $$;

drop table if exists public.church_counselling_history;
drop table if exists public.church_counselling_requests;
drop function if exists public.church_counselling_history_guard();
drop function if exists public.church_counselling_audit();
drop function if exists public.church_counselling_guard();

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name in ('church_counselling_requests', 'church_counselling_history')) then raise exception 'rollback postcondition failed: a table is still there'; end if;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('church_counselling_guard', 'church_counselling_audit', 'church_counselling_history_guard')) then raise exception 'rollback postcondition failed: a function is still there'; end if;
  if to_regclass('public.profiles') is null then raise exception 'rollback postcondition failed: an earlier table is gone'; end if;
end $$;

commit;
