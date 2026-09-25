-- Increment 5B: customer receipt email for Shop orders. Additive only — one nullable
-- send-once guard column, matching the existing receipt_email_sent_at convention already
-- used by music_orders and orders (see 2026-09-24_purchase_receipt_emails.sql). Nothing
-- else changes: no existing column, trigger, policy or row is touched.

alter table product_orders add column if not exists receipt_email_sent_at timestamptz;
