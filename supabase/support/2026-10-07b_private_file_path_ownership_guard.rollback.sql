-- Rollback for supabase/migrations/2026-10-07b_private_file_path_ownership_guard.sql. Removes only the two triggers and the function. No data is touched.
begin;
drop trigger if exists tracks_protected_audio_path_guard_trg on public.tracks;
drop trigger if exists products_digital_file_path_guard_trg on public.products;
drop function if exists public.private_file_path_guard();
commit;
