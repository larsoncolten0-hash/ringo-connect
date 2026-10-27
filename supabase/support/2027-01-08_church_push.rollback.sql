-- ROLLBACK for 2027-01-08_church_push.sql — FOR OWNER REVIEW; do not run unless rolling back.
--
-- Removes exactly what that migration added: the three tables (notification preferences, the queue, the delivery notes), the six functions and the trigger. It touches no other table: the visitors'
-- devices (customer_push_subscriptions) and their connections are kept.
--
-- DATA SAFETY: dropping the tables deletes every visitor's notification choices for churches (they would have to opt in again), the queue and the delivery notes. This file REFUSES to run while any row
-- exists. To drop them anyway, confirm the loss explicitly by adding this line as the FIRST statement inside the transaction (same script, same transaction):
--     select set_config('church_push.allow_data_loss', 'yes', true);
-- Safe to re-run: every drop is "if exists".
begin;

set local lock_timeout = '5s';

do $$
declare
  v_marker constant text := 'managed by 2027-01-08_church_push.sql';
  v_rows bigint := 0;
  v_t text;
  v_n bigint;
  v_bad text;
begin
  foreach v_t in array array['church_push_prefs', 'church_push_outbox', 'church_push_deliveries'] loop
    if to_regclass('public.' || v_t) is not null then
      if coalesce(obj_description(to_regclass('public.' || v_t), 'pg_class'), '') <> v_marker then raise exception 'rollback refused: public.% exists but is not managed by this migration', v_t; end if;
      execute format('select count(*) from public.%I', v_t) into v_n;
      v_rows := v_rows + v_n;
    end if;
  end loop;
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname in ('church_push_prefs_guard', 'church_push_enqueue', 'church_push_claim', 'church_push_recipients', 'church_push_record', 'church_push_finish') and coalesce(obj_description(p.oid, 'pg_proc'), '') <> v_marker;
  if v_bad is not null then raise exception 'rollback refused: function(s) % exist but are not managed by this migration', v_bad; end if;
  if v_rows > 0 and coalesce(current_setting('church_push.allow_data_loss', true), '') <> 'yes' then
    raise exception 'rollback refused: % row(s) exist. Confirm the loss with: select set_config(''church_push.allow_data_loss'', ''yes'', true);', v_rows;
  end if;
end $$;

drop function if exists public.church_push_finish(uuid, text);
drop function if exists public.church_push_record(uuid, uuid, boolean);
drop function if exists public.church_push_recipients(uuid, integer);
drop function if exists public.church_push_claim(integer);
drop function if exists public.church_push_enqueue(uuid, text, text, timestamptz, jsonb);
drop table if exists public.church_push_deliveries;
drop table if exists public.church_push_outbox;
drop table if exists public.church_push_prefs;
drop function if exists public.church_push_prefs_guard();

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name in ('church_push_prefs', 'church_push_outbox', 'church_push_deliveries')) then raise exception 'rollback postcondition failed: a table is still there'; end if;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname like 'church\_push\_%') then raise exception 'rollback postcondition failed: a function is still there'; end if;
  if to_regclass('public.customer_connections') is null or to_regclass('public.ringo_customers') is null then raise exception 'rollback postcondition failed: an earlier table is gone'; end if;
end $$;

commit;
