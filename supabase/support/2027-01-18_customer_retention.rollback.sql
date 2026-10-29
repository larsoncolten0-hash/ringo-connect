-- ROLLBACK for 2027-01-18_customer_retention.sql — FOR OWNER REVIEW; do not run unless rolling back.
--
-- Removes exactly what that migration created: promotions, promotion_deliveries, promotion_redemptions, profile_reviews, and the functions customer_segments(), customer_has_interaction(),
-- promotion_redeem() and review_save(). It touches no existing table, row, policy or function (loyalty, consent, orders, bookings and Community are exactly as they are).
--
-- DATA SAFETY: promotions, the record of what was sent to whom, redemptions (what discounts were given) and customers' reviews are real records. This file REFUSES to run while any row exists in
-- any of the four tables. To drop them anyway, export what you need and confirm the loss explicitly by adding this line as the FIRST statement inside the transaction:
--     select set_config('customer_retention.allow_data_loss', 'yes', true);
-- Dropping a table is irreversible. Safe to re-run: every drop is "if exists".
begin;

set local lock_timeout = '5s';

do $$
declare
  v_marker constant text := 'managed by 2027-01-18_customer_retention.sql';
  v_t text;
  v_rows bigint := 0;
  v_bad text;
begin
  foreach v_t in array array['promotions', 'promotion_deliveries', 'promotion_redemptions', 'profile_reviews'] loop
    if to_regclass('public.' || v_t) is not null then
      if coalesce(obj_description(to_regclass('public.' || v_t), 'pg_class'), '') <> v_marker then raise exception 'rollback refused: public.% exists but is not managed by this migration', v_t; end if;
      v_rows := v_rows + (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', v_t), false, true, '')))[1]::text::bigint;
    end if;
  end loop;
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname in ('customer_segments', 'customer_has_interaction', 'promotion_redeem', 'review_save') and coalesce(obj_description(p.oid, 'pg_proc'), '') <> v_marker;
  if v_bad is not null then raise exception 'rollback refused: function(s) % exist but are not managed by this migration', v_bad; end if;

  if v_rows > 0 and coalesce(current_setting('customer_retention.allow_data_loss', true), '') <> 'yes' then
    raise exception 'rollback refused: the retention tables hold % row(s). Export what you need, then confirm the loss with: select set_config(''customer_retention.allow_data_loss'', ''yes'', true);', v_rows;
  end if;

  perform set_config('customer_retention.pre', jsonb_build_object(
    'connections', (select count(*) from public.customer_connections),
    'activities',  (select count(*) from public.loyalty_activities)
  )::text, true);
end $$;

drop table if exists public.promotion_deliveries;
drop table if exists public.promotion_redemptions;
drop table if exists public.promotions;
drop table if exists public.profile_reviews;
drop function if exists public.customer_segments(uuid, uuid);
drop function if exists public.customer_has_interaction(uuid, uuid);
drop function if exists public.promotion_redeem(uuid, uuid, uuid, uuid, integer, text);
drop function if exists public.review_save(uuid, uuid, integer, text);

do $$
declare
  v_pre jsonb := current_setting('customer_retention.pre')::jsonb;
begin
  if (select count(*) from unnest(array['promotions', 'promotion_deliveries', 'promotion_redemptions', 'profile_reviews']) t where to_regclass('public.' || t) is not null) > 0 then raise exception 'rollback failed: a table is still there'; end if;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('customer_segments', 'customer_has_interaction', 'promotion_redeem', 'review_save')) then raise exception 'rollback failed: a function is still there'; end if;
  if (select count(*) from public.customer_connections) <> (v_pre->>'connections')::bigint or (select count(*) from public.loyalty_activities) <> (v_pre->>'activities')::bigint then
    raise exception 'rollback failed: existing rows changed';
  end if;
end $$;

commit;
