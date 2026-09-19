-- ============================================================================
-- ROLLBACK for supabase/migrations/2026-10-16_profiles_demo_flag_guard.sql
-- Removes ONLY the guard trigger and its function. No data, grant, policy or column is touched, so profiles
-- return to exactly their previous behavior (including the weakness the guard was added to close).
-- ============================================================================
begin;
drop trigger if exists trg_protect_demo_flags on public.profiles;
drop function if exists public.protect_demo_flags();
commit;
