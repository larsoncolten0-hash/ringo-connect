-- Ringo Connect — dedicated "get started" flow for affiliate marketers
-- Run this once in the Supabase SQL editor.
--
-- 1. signup_requests.source distinguishes a submission from the public
--    /get-started form (the default, unchanged) from one made through
--    /get-started-affiliate — the dedicated partner-facing page where
--    online payment is mandatory rather than optional. This is what lets
--    /api/signup-requests/[id]/pay allow payment regardless of the
--    admin's general "allow customer payment at signup" toggle (that
--    toggle only ever governed the PUBLIC form's optional pay-now
--    button; a partner's own page has its own, separate, always-on
--    payment requirement).
--
-- 2. addons.show_on_affiliate_page lets an admin curate which add-ons
--    appear on the affiliate page independently of the public form —
--    defaults to true so nothing already configured disappears from
--    either page just from running this migration.
alter table signup_requests add column if not exists source text not null default 'get_started'
  check (source in ('get_started', 'affiliate'));

alter table addons add column if not exists show_on_affiliate_page boolean not null default true;
