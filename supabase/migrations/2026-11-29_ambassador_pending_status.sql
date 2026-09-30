-- Ringo Ambassador Program — 'pending' status for Ambassadors added by a Team Leader. NOT YET RUN.
--
-- A Team Leader may add an existing Ringo account to their team as an Ambassador
-- but cannot grant that person any access: the new Ambassador starts as
-- 'pending' until Ringo Management reviews and activates them
-- (Admin -> Ambassadors -> Activate).
--
-- The ONLY database change is widening the allowed values of
-- ambassador_profiles.status from ('active','inactive','suspended') to also
-- allow 'pending'. No row is touched and no other object is changed.
--
-- Why nothing else is needed: everything that grants access already keys on
-- status = 'active' or excludes only 'suspended', and a pending Ambassador
-- can hold no commission (their code does not resolve, so no sale can be
-- attributed to them):
--   * ambassador_attribute_sale() only matches status = 'active'  -> a pending
--     Ambassador's code/link attributes nothing;
--   * approving clients' accounts requires an ACTIVE Ambassador (application
--     check in src/lib/ambassador/requestReview.ts) and the separate admin-granted
--     users.can_approve_requests switch, which a new Ambassador does not have;
--   * saving a payout destination / requesting a payout is refused for a
--     pending Ambassador by the application (src/lib/ambassador/payouts.ts).
--
-- Depends on: 2026-11-18_ambassador_foundation.sql (ambassador_profiles).

alter table public.ambassador_profiles drop constraint if exists ambassador_profiles_status_check;
alter table public.ambassador_profiles
  add constraint ambassador_profiles_status_check
  check (status in ('pending', 'active', 'inactive', 'suspended'));
