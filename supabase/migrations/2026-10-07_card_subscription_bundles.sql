-- Two new Ringo Card + subscription bundles — "Card + 1 Month" (5,000 FCFA)
-- and "Card + 1 Year" (10,000 FCFA) — purchasable alongside the existing
-- standalone Ringo Card add-on (unchanged, still `active = false` as it was
-- found — this migration does not touch that row or reactivate it).
--
-- Modeled as two new `addons` rows, not a new table — additive columns on
-- the existing table, per "reuse existing patterns (addons table)":
--   - grants_plan_name: which plan (by `plans.name`) this addon grants on
--     top of fulfilling the physical card. Null for every existing addon
--     (a plain purchase, no plan effect) — this is what keeps "existing
--     addon mechanism's core behavior" completely unchanged for them.
--   - grants_plan_duration_days: how many days of that plan. Read together
--     with grants_plan_name by src/lib/cardBundle.ts's applyCardBundleGrant()
--     — see that file for the actual grant/extend/never-downgrade logic,
--     which is application code, not something this migration encodes.
--
-- USD prices (9 / 18) are round-number placeholders matching the app's
-- existing "no fixed XAF:USD conversion ratio" precedent (see
-- 2026-10-05_new_pricing_structure.sql's own business_basic price note) —
-- not a currency conversion, real USD pricing is a separate later task if
-- needed.
--
-- Additive/idempotent, same convention as every migration since 2026-09-12.

alter table addons add column if not exists grants_plan_name text;
alter table addons add column if not exists grants_plan_duration_days int;

insert into addons (name, price_xaf, price_usd, required, active, sort_order, show_on_affiliate_page, grants_plan_name, grants_plan_duration_days)
select 'Card + 1 Month', 5000, 9, false, true, 10, true, 'basic', 30
where not exists (select 1 from addons where name = 'Card + 1 Month');

-- CONFIRMED INTENTIONAL: 10,000 FCFA equals a full year of Basic alone
-- (see plans.price_xaf for 'basic' — 10,000/yr) — the card is effectively
-- free on this bundle, a deliberate reward for annual commitment, not a
-- pricing bug. Do not "fix" this later without checking first.
insert into addons (name, price_xaf, price_usd, required, active, sort_order, show_on_affiliate_page, grants_plan_name, grants_plan_duration_days)
select 'Card + 1 Year', 10000, 18, false, true, 11, true, 'basic', 365
where not exists (select 1 from addons where name = 'Card + 1 Year');
