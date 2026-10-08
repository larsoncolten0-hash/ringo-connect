-- Read-only check for 2026-12-16_profile_lookup_indexes.sql (changes nothing). Run in the Supabase SQL editor.
-- 1) Which of the proposed indexes already exist (expect 9 rows once the migration has been applied):
select schemaname, tablename, indexname
from pg_indexes
where schemaname = 'public'
  and indexname in (
    'profiles_user_id_lookup_idx', 'links_profile_id_lookup_idx', 'social_links_profile_id_lookup_idx', 'products_profile_id_lookup_idx',
    'profile_phone_numbers_profile_lookup_idx', 'tracks_profile_id_lookup_idx', 'events_profile_id_lookup_idx', 'menu_categories_profile_id_lookup_idx',
    'restaurant_tables_profile_id_lookup_idx'
  )
order by tablename;
-- 2) Every index (of any name) that leads with profile_id / user_id on the public-profile tables, so nothing is duplicated:
select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('profiles', 'links', 'social_links', 'products', 'profile_phone_numbers', 'tracks', 'events', 'menu_categories', 'restaurant_tables', 'music_releases')
order by tablename, indexname;
-- 3) How big those tables are, to judge whether a sequential scan is already a cost (small tables: it is not):
select relname as table_name, n_live_tup as approx_rows from pg_stat_user_tables
where relname in ('profiles', 'links', 'social_links', 'products', 'profile_phone_numbers', 'tracks', 'events', 'menu_categories', 'restaurant_tables') order by relname;
