-- ============================================================================
-- ROLLBACK for supabase/migrations/2026-10-06e_unsafe_url_scheme_guard.sql
-- Removes ONLY the triggers and their function. No row is touched.
-- ============================================================================
begin;
drop trigger if exists trg_a_unsafe_url_products on public.products;
drop trigger if exists trg_a_unsafe_url_tracks on public.tracks;
drop trigger if exists trg_a_unsafe_url_events on public.events;
drop trigger if exists trg_a_unsafe_url_links on public.links;
drop trigger if exists trg_a_unsafe_url_social_links on public.social_links;
drop trigger if exists trg_a_unsafe_url_community_announcements on public.community_announcements;
drop function if exists public.reject_unsafe_url_columns();
commit;
