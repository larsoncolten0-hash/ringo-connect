-- Adds a send-once claim column for the "we received your booking
-- request" email sent immediately at submission (see /api/bookings) —
-- distinct from confirmation_email_sent_at (2026-09-24), which guards the
-- separate "your booking is confirmed" email sent later once the
-- business actually accepts the request. Same additive/idempotent
-- convention as every migration since 2026-09-12.

alter table bookings add column if not exists request_email_sent_at timestamptz;
