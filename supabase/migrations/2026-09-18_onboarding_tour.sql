-- First-login-only onboarding tour (see OnboardingTour.tsx,
-- /api/onboarding/complete, and dashboard/page.tsx). Purely additive: one
-- new nullable column on `users`, no existing column/table touched.
--
-- Null means "hasn't seen the tour yet" (every existing account today).
-- Set once, the first time that account finishes or skips the tour, and
-- never cleared again — so it never reappears on a later login, on any
-- device.
alter table users add column if not exists onboarding_completed_at timestamptz;
