-- Ringo Card bundle entry-point restructure (additive) — the bundle
-- mechanics themselves (2026-10-07_card_subscription_bundles.sql: single
-- combined Fapshi charge, plan-granting logic in src/lib/cardBundle.ts)
-- are UNCHANGED. This only renames the two bundle addon rows to their
-- real customer-facing product name and adds an admin-editable bullet-
-- point feature list for them (see AddonsManager.tsx) — price and name
-- were already editable there; the descriptive bullets were not.
alter table addons add column if not exists bundle_features text[];

-- Guarded on bundle_features being NULL so this only ever seeds the
-- default copy once — an admin who has already customized either field
-- since this shipped is never overwritten by a second run of this
-- migration. Matched by grants_plan_name/grants_plan_duration_days, not
-- by the OLD name string ("Card + 1 Month"/"Card + 1 Year"), so this
-- works whether or not those exact original names still stand.
update addons
set name = 'Ringo Smart Physical Card (1 Month)',
    bundle_features = array['1 month Basic subscription included', 'QR code on card', 'Free card configuration']
where grants_plan_name = 'basic' and grants_plan_duration_days = 30 and bundle_features is null;

update addons
set name = 'Ringo Smart Physical Card (1 Year)',
    bundle_features = array['1 year Basic subscription included', 'QR code on card', 'Free card configuration']
where grants_plan_name = 'basic' and grants_plan_duration_days = 365 and bundle_features is null;
