-- Rollback for supabase/migrations/2026-10-07d_watchdog_events.sql. Drops the Watchdog incident table (and with it the incident history: export it first if you
-- want to keep it), its trigger and function, and the admin_audit_log lookup index. admin_audit_log itself is not touched.
begin;
drop trigger if exists watchdog_events_guard_trg on public.watchdog_events;
drop function if exists public.watchdog_events_guard();
drop table if exists public.watchdog_events;
drop index if exists public.admin_audit_log_action_target_created_idx;
commit;
