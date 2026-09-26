-- A third Ringo Card + Subscription bundle — "Ringo Physical Card (Pro)"
-- (5,000 FCFA), granting the 'pro' plan for 30 days — sits between the
-- existing "Ringo Physical Card(Standard)" (3,500 FCFA, grants 'basic' for
-- 30 days) and "Ringo Physical Card  (Premium)" (10,000 FCFA, grants
-- 'basic' for 365 days). Neither existing row's price, name, or plan grant
-- is touched — this is a pure addition, using the exact same
-- grants_plan_name/grants_plan_duration_days/bundle_features mechanism
-- 2026-10-07_card_subscription_bundles.sql already introduced (see
-- src/lib/cardBundle.ts's applyCardBundleGrant(), which is already fully
-- generic over any plan name — no application code change needed for the
-- grant itself).
--
-- sort_order: the existing Premium row's sort_order (11) is bumped to 12,
-- purely a display-ordering value, so the new middle-priced tier can sit
-- at 11, between Standard (10) and Premium (12) — its name, price, and
-- plan grant are otherwise completely unchanged.
--
-- USD price (12) is a round-number placeholder between the existing rows'
-- own placeholders (9 and 18), same "no fixed XAF:USD ratio" precedent as
-- the original migration.
--
-- Additive/idempotent, same convention as every migration since 2026-09-12.

begin;

update addons
set sort_order = 12
where grants_plan_name = 'basic' and grants_plan_duration_days = 365 and sort_order = 11;

insert into addons (name, price_xaf, price_usd, required, active, sort_order, show_on_affiliate_page, grants_plan_name, grants_plan_duration_days, bundle_features)
select 'Ringo Physical Card (Pro)', 5000, 12, false, true, 11, true, 'pro', 30,
       array['1 month Pro subscription included', 'QR code on card', 'Free card configuration']
where not exists (select 1 from addons where grants_plan_name = 'pro' and grants_plan_duration_days = 30);

commit;
