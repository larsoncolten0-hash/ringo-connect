-- Rollback for supabase/migrations/2026-10-07c_payout_request_concurrency_guard.sql. Removes only the two triggers and two functions. No data is touched.
begin;
drop trigger if exists music_payout_concurrency_guard_trg on public.music_payouts;
drop trigger if exists affiliate_payout_concurrency_guard_trg on public.affiliate_payouts;
drop function if exists public.music_payout_concurrency_guard();
drop function if exists public.affiliate_payout_concurrency_guard();
commit;
