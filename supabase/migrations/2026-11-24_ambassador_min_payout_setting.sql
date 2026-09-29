-- Ringo Ambassador Program — minimum payout setting. NOT YET RUN.
--
-- Purely additive: ONE new defaulted column on platform_settings, exactly the
-- pattern already used by affiliate_min_payout_xaf (2026-09-06),
-- music_min_payout_xaf (2026-09-20) and commerce_min_payout_xaf
-- (2026-11-05). No existing column, row or function is touched.
--
-- This column is the SINGLE source of truth for the Ambassador / Team Leader
-- minimum payout (XAF). It is enforced inside ambassador_request_payout()
-- (2026-11-26_ambassador_financial_hardening.sql); the application and UI only
-- ever display it. The literal 500 appears here, once, as the column default.
--
-- Depends on: platform_settings (existing).

alter table platform_settings
  add column if not exists ambassador_min_payout_xaf numeric(10, 2) not null default 500
  check (ambassador_min_payout_xaf > 0);
