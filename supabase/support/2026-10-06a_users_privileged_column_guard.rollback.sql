-- ============================================================================
-- ROLLBACK for supabase/migrations/2026-10-06a_users_privileged_column_guard.sql
-- Removes ONLY the guard trigger and its function. No data, grant, policy or column is touched, so public.users returns to
-- exactly its previous behaviour (INCLUDING the weakness the guard closes: an ordinary user could then edit their own role,
-- plan_id, status and can_approve_requests). Only roll back to unblock a legitimate flow you have identified, and re-apply
-- a fixed guard promptly.
-- ============================================================================
begin;
drop trigger if exists trg_a_protect_users_privileged on public.users;
drop function if exists public.protect_users_privileged_columns();
commit;
