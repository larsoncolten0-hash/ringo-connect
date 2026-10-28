-- ROLLBACK for 2027-01-12_church_gifts.sql — FOR OWNER REVIEW; do not run unless rolling back.
--
-- Removes exactly what that migration added: the four tables, the sequence, the two views, the functions, and the church-only platform_settings columns. It touches no Shop table.
--
-- DATA SAFETY: dropping the tables deletes every gift, earning, payout and refund record, which are FINANCIAL RECORDS. This file REFUSES to run while any such row exists. To drop them anyway
-- (only ever on a database that holds no real money), confirm the loss explicitly by adding this line as the FIRST statement inside the transaction (same script, same transaction):
--     select set_config('church_gifts.allow_data_loss', 'yes', true);
-- Safe to re-run: every drop is "if exists".
begin;

set local lock_timeout = '5s';

do $$
declare
  v_marker constant text := 'managed by 2027-01-12_church_gifts.sql';
  v_rows bigint := 0;
  v_n bigint;
  v_t text;
  v_bad text;
begin
  foreach v_t in array array['church_gifts', 'church_gift_earnings', 'church_payouts', 'church_gift_refund_requests'] loop
    if to_regclass('public.' || v_t) is not null then
      if coalesce(obj_description(to_regclass('public.' || v_t), 'pg_class'), '') <> v_marker then raise exception 'rollback refused: public.% exists but is not managed by this migration', v_t; end if;
      execute format('select count(*) from public.%I', v_t) into v_n;
      v_rows := v_rows + v_n;
    end if;
  end loop;
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('church_gifts_guard', 'church_gift_no_delete', 'church_gift_earnings_guard', 'church_gift_refund_guard', 'church_settle_gift', 'request_church_payout', 'church_payout_finish', 'church_gift_refund_decide', 'church_giving_profile_allowed')
     and coalesce(obj_description(p.oid, 'pg_proc'), '') <> v_marker;
  if v_bad is not null then raise exception 'rollback refused: function(s) % exist but are not managed by this migration', v_bad; end if;
  if v_rows > 0 and coalesce(current_setting('church_gifts.allow_data_loss', true), '') <> 'yes' then
    raise exception 'rollback refused: % financial record(s) exist. Confirm the loss with: select set_config(''church_gifts.allow_data_loss'', ''yes'', true);', v_rows;
  end if;
end $$;

drop function if exists public.church_gift_refund_decide(uuid, text, uuid, text);
drop function if exists public.church_giving_profile_allowed(uuid);
drop function if exists public.church_payout_finish(uuid, text, uuid, text);
drop function if exists public.request_church_payout(uuid);
drop function if exists public.church_settle_gift(uuid, numeric);
drop view if exists public.church_gift_earnings_ledger;
drop view if exists public.church_gift_ledger;
drop table if exists public.church_gift_refund_requests;
drop table if exists public.church_gift_earnings;
drop table if exists public.church_payouts;
drop table if exists public.church_gifts;
drop sequence if exists public.church_gift_receipt_seq;
drop function if exists public.church_gift_refund_guard();
drop function if exists public.church_gift_earnings_guard();
drop function if exists public.church_gift_no_delete();
drop function if exists public.church_gifts_guard();
alter table public.platform_settings drop column if exists church_giving_commission_rate;
alter table public.platform_settings drop column if exists church_care_commission_rate;
alter table public.platform_settings drop column if exists church_min_gift_xaf;
alter table public.platform_settings drop column if exists church_payout_hold_days;
alter table public.platform_settings drop column if exists church_min_payout_xaf;
alter table public.platform_settings drop column if exists church_gift_refund_window_hours;
alter table public.platform_settings drop column if exists church_giving_pilot_profiles;

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name in ('church_gifts', 'church_gift_earnings', 'church_payouts', 'church_gift_refund_requests')) then raise exception 'rollback postcondition failed: a table is still there'; end if;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('church_gifts_guard', 'church_settle_gift', 'request_church_payout', 'church_payout_finish', 'church_gift_refund_decide')) then raise exception 'rollback postcondition failed: a function is still there'; end if;
  if to_regclass('public.church_giving_funds') is null or to_regclass('public.church_features') is null then raise exception 'rollback postcondition failed: an earlier table is gone'; end if;
end $$;

commit;
