-- Ringo Connect — Fapshi disbursement for affiliate payouts
-- Run this once in the Supabase SQL editor, AFTER
-- 2026-09-06_affiliate_system.sql. Adds a "processing" state to
-- affiliate_payouts for a payout that's been sent to Fapshi's /payout
-- endpoint but not yet confirmed, and a column to remember which Fapshi
-- transaction it corresponds to.
--
-- Lifecycle for a Mobile Money payout with this in place:
--   requested  -- admin clicks "Send via Fapshi"
--   -> processing (fapshi_trans_id set, money is in flight)
--   -> paid       (Fapshi confirmed SUCCESSFUL — see fapshiGetStatus)
--   -> requested  (Fapshi confirmed FAILED/EXPIRED — money never left,
--                  so it's simply eligible to try again, not a dead end)
-- PayPal and bank payouts are unaffected — those still only ever move
-- between requested/paid/rejected by an admin's own manual action, since
-- there's no automated disbursement API wired up for them here.

alter table affiliate_payouts add column if not exists fapshi_trans_id text;
create index if not exists affiliate_payouts_fapshi_trans_id_idx on affiliate_payouts (fapshi_trans_id);

alter table affiliate_payouts drop constraint if exists affiliate_payouts_status_check;
alter table affiliate_payouts add constraint affiliate_payouts_status_check
  check (status in ('requested', 'processing', 'paid', 'rejected'));
