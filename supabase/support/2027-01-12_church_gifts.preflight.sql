-- PREFLIGHT for 2027-01-12_church_gifts.sql — READ-ONLY (one SELECT, no write). FOR OWNER REVIEW; run in the Supabase SQL Editor BEFORE applying the migration.
-- Every row must show ok = true on a clean first run. It reads the catalog and a few counts only.

with
checks(label, expect, actual) as (
  select '01 the earlier tables exist (profiles, users, platform_settings, church_features, church_giving_funds)', '5',
         (select count(*)::text from unnest(array['profiles', 'users', 'platform_settings', 'church_features', 'church_giving_funds']) t where to_regclass('public.' || t) is not null)
  union all select '02 the earlier functions exist', '6',
         (select count(*)::text from unnest(array['church_has_permission(uuid,text)', 'church_is_owner(uuid)', 'is_church_profile(uuid)', 'is_admin()', 'church_giving_collection_open()', 'church_features_giving_lock()']) f where to_regprocedure('public.' || f) is not null)
  union all select '03 collection is closed (the switch answers false)', 'false', (select public.church_giving_collection_open()::text)
  union all select '04 no church has giving switched on (0 expected)', '0', (select count(*)::text from public.church_features where giving)
  union all select '05 the payout destination columns exist on users', '2',
         (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'users' and column_name in ('affiliate_payout_method', 'affiliate_payout_details'))
  union all select '06 none of the new tables exists yet (0 expected)', '0',
         (select count(*)::text from unnest(array['church_gifts', 'church_gift_earnings', 'church_payouts', 'church_gift_refund_requests']) t where to_regclass('public.' || t) is not null)
  union all select '07 none of the new functions exists yet (0 expected)', '0',
         (select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace and proname in ('church_gifts_guard', 'church_gift_earnings_guard', 'church_settle_gift', 'request_church_payout', 'church_payout_finish', 'church_gift_refund_decide', 'church_giving_profile_allowed'))
  union all select '08 the new platform_settings columns do not exist yet (0 expected)', '0',
         (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'platform_settings' and column_name like 'church\_%')
  union all select '09 platform_settings has exactly one row (the settings are read with limit 1)', '1', (select count(*)::text from public.platform_settings)
)
select label, expect, actual, (expect = actual) as ok from checks order by label;
