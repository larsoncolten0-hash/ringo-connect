-- Ringo Connect — separate Fapshi credentials for disbursement
-- Run this once in the Supabase SQL editor. Fapshi issues credentials per
-- "service" — the existing fapshi_api_user/key_* columns are for the
-- COLLECTION service (what customers pay into); these new columns are
-- for a separate service used only to DISBURSE money out (affiliate
-- payouts). Same test/live split as the existing Fapshi credentials, and
-- governed by the same fapshi_test_mode toggle — Fapshi's sandbox/live
-- distinction is environment-wide, not per-service.
--
-- Leaving these unset is fine: src/lib/fapshi.ts falls back to the
-- collection credentials for disbursement calls when no dedicated payout
-- pair is configured, so nothing breaks before this is filled in.

alter table platform_settings add column if not exists fapshi_payout_api_user_test_encrypted text;
alter table platform_settings add column if not exists fapshi_payout_api_key_test_encrypted text;
alter table platform_settings add column if not exists fapshi_payout_api_user_live_encrypted text;
alter table platform_settings add column if not exists fapshi_payout_api_key_live_encrypted text;
