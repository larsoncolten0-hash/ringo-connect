-- Purchase/booking confirmation emails — wires the existing Resend adapter
-- (src/lib/email/provider.ts, until now only used by the Community
-- announcements feature) into the three guest-checkout flows that collect
-- a customer email but never did anything with it: music orders,
-- restaurant orders, and bookings.
--
-- Each `*_email_sent_at` column is a simple send-once claim: the sending
-- route/function does `update ... set x_email_sent_at = now() where id =
-- :id and x_email_sent_at is null`, and only proceeds to actually call the
-- email provider if that update returned a row. This is what makes it safe
-- to call the same "maybe send the receipt" function from more than one
-- trigger point (e.g. a music order can become 'paid' via either the
-- automatic Fapshi confirmation path or the artist's manual "Mark Paid"
-- action) without ever double-emailing a fan. A failed send (provider not
-- configured, network error) is not retried — same best-effort posture as
-- music_sale_earnings elsewhere in this schema; recoverable by an admin
-- from the data directly if it ever matters.
--
-- Additive/idempotent, same convention as every migration since 2026-09-12.

alter table music_orders add column if not exists receipt_email_sent_at timestamptz;

alter table orders add column if not exists customer_email text;
alter table orders add column if not exists receipt_email_sent_at timestamptz;

alter table bookings add column if not exists confirmation_email_sent_at timestamptz;
