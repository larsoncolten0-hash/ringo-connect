-- Rollback for 2026-10-26_ringo_ai_quota_reservations.sql.
-- Removes ONLY the objects that migration created. Nothing else is touched.
-- Run this BEFORE 2026-10-25_ringo_ai_foundation.rollback.sql if you are
-- removing Ringo AI entirely.
--
-- IMPORTANT: once this is rolled back, the deployed code's reservation call
-- fails and Ringo AI refuses every message (fails closed, "quota_unavailable")
-- until the code is reverted too. No usage history is lost: reservations only
-- hold in-flight estimates.

drop function if exists public.ai_reserve_quota(uuid, int, bigint, numeric, bigint, numeric, int);
drop table if exists public.ai_quota_reservations;
