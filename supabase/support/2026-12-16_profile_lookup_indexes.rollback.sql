-- Rollback for supabase/migrations/2026-12-16_profile_lookup_indexes.sql. Drops only the nine indexes that migration created (by their own names). Nothing else.
-- Safe to run twice. Query results are unaffected either way; only lookup speed returns to what it was.
begin;
drop index if exists public.profiles_user_id_lookup_idx;
drop index if exists public.links_profile_id_lookup_idx;
drop index if exists public.social_links_profile_id_lookup_idx;
drop index if exists public.products_profile_id_lookup_idx;
drop index if exists public.profile_phone_numbers_profile_lookup_idx;
drop index if exists public.tracks_profile_id_lookup_idx;
drop index if exists public.events_profile_id_lookup_idx;
drop index if exists public.menu_categories_profile_id_lookup_idx;
drop index if exists public.restaurant_tables_profile_id_lookup_idx;
commit;
