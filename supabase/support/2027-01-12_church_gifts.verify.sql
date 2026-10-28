-- VERIFY for 2027-01-12_church_gifts.sql — READ-ONLY (a single SELECT, no write). FOR OWNER REVIEW; run once AFTER the migration is applied.
-- Every row must show ok = true. It reads the catalog and a few counts only.

with
checks(label, expect, actual) as (
  select '01 the four tables exist and are marked as managed by this migration', '4',
         (select count(*)::text from unnest(array['church_gifts', 'church_gift_earnings', 'church_payouts', 'church_gift_refund_requests']) t
           where to_regclass('public.' || t) is not null and obj_description(to_regclass('public.' || t), 'pg_class') = 'managed by 2027-01-12_church_gifts.sql')
  union all select '02 row-level security is on for all four', '4',
         (select count(*)::text from pg_class c where c.oid in ('public.church_gifts'::regclass, 'public.church_gift_earnings'::regclass, 'public.church_payouts'::regclass, 'public.church_gift_refund_requests'::regclass) and c.relrowsecurity)
  union all select '03 no API role can write any of the four tables (0 expected)', '0',
         (select count(*)::text from unnest(array['church_gifts', 'church_gift_earnings', 'church_payouts', 'church_gift_refund_requests']) t, unnest(array['anon', 'authenticated']) r, unnest(array['insert', 'update', 'delete']) p
           where has_table_privilege(r, 'public.' || t, p))
  union all select '04 anon reads none of the four tables or views (0 expected)', '0',
         (select count(*)::text from unnest(array['church_gifts', 'church_gift_earnings', 'church_payouts', 'church_gift_refund_requests', 'church_gift_ledger', 'church_gift_earnings_ledger']) t where has_table_privilege('anon', 'public.' || t, 'select'))
  union all select '05 signed-in users cannot read the raw gift or earning tables (0 expected)', '0',
         (select count(*)::text from unnest(array['church_gifts', 'church_gift_earnings']) t where has_table_privilege('authenticated', 'public.' || t, 'select'))
  union all select '06 the guard triggers exist', '4',
         (select count(*)::text from pg_trigger where not tgisinternal and tgname in ('church_gifts_guard_trg', 'church_gift_earnings_guard_trg', 'church_gift_refund_guard_trg', 'church_gifts_no_delete_trg'))
  union all select '07 settlement, payout finish and refund decision are callable by no API role (0 expected)', '0',
         (select count(*)::text from unnest(array['anon', 'authenticated']) r, unnest(array['church_settle_gift(uuid,numeric)', 'church_payout_finish(uuid,text,uuid,text)', 'church_gift_refund_decide(uuid,text,uuid,text)']) f
           where has_function_privilege(r, 'public.' || f, 'execute'))
  union all select '08 only a signed-in user (not anon) may call request_church_payout', 'true,false',
         (select has_function_privilege('authenticated', 'public.request_church_payout(uuid)', 'execute')::text || ',' || has_function_privilege('anon', 'public.request_church_payout(uuid)', 'execute')::text)
  union all select '09 the approved rates and limits are in place (0.05 / 0.05 / 500 / 48)', '0.0500,0.0500,500,48',
         (select church_giving_commission_rate::text || ',' || church_care_commission_rate::text || ',' || church_min_gift_xaf::text || ',' || church_gift_refund_window_hours::text from public.platform_settings limit 1)
  union all select '10 collection is STILL closed', 'false', (select public.church_giving_collection_open()::text)
  union all select '11 no church has giving switched on (0 expected)', '0', (select count(*)::text from public.church_features where giving)
  union all select '12 no gift exists (0 expected on a first run)', '0', (select count(*)::text from public.church_gifts)
  union all select '13 the earlier lock trigger and giving guard are untouched', '2',
         (select count(*)::text from pg_trigger where not tgisinternal and tgname in ('church_features_giving_lock_trg', 'church_giving_guard_trg'))
  union all select '15 the pilot list exists and is EMPTY (no church allowed yet)', '0',
         (select coalesce(cardinality(church_giving_pilot_profiles), -1)::text from public.platform_settings limit 1)
  union all select '14 the Shop ledger tables are untouched (no church column on them, 0 expected)', '0',
         (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name in ('customer_payments', 'commerce_sale_earnings', 'commerce_payouts', 'product_orders') and column_name like '%church%')
)
select label, expect, actual, (expect = actual) as ok from checks order by label;
