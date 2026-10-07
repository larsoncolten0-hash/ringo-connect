-- ============================================================================
-- ROLLBACK for supabase/migrations/2026-10-06b_profiles_privileged_column_guard.sql
-- Removes ONLY this guard's trigger and function. trg_protect_demo_flags (2026-10-16) is not touched. Profiles return to their
-- previous behaviour, including owners being able to set verified and staff being able to change user_id.
-- ============================================================================
begin;
drop trigger if exists trg_a_protect_profile_privileged on public.profiles;
drop function if exists public.protect_profile_privileged_columns();
commit;
