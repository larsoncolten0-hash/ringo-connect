-- "Super creators" — a regular creator (role stays 'creator') that an
-- admin has separately granted permission to review signup requests:
-- approve them into real accounts, reject them, charge the customer, and
-- delete pending/rejected ones. This is deliberately NOT the same as
-- role = 'admin' — it grants exactly one capability, not access to
-- settings, plans, add-ons, affiliate payouts, analytics, or the
-- creators list. See src/lib/assertAdmin.ts (assertCanApproveRequests)
-- and src/app/dashboard/requests/ for where this is enforced/used.
alter table users add column if not exists can_approve_requests boolean not null default false;
