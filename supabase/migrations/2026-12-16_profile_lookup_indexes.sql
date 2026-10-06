-- Profile lookup indexes — PROPOSED, NOT APPLIED. Run once in the Supabase SQL editor. No application change depends on it, and it can be applied at any time.
-- Rollback: supabase/support/2026-12-16_profile_lookup_indexes.rollback.sql.
--
-- Why (evidence in this repository's own SQL, not a guess)
--   Postgres does NOT index a foreign key automatically. These tables are always read by their owner's profile id, and none of them has any index on that column in
--   supabase/schema.sql or any migration:
--     * Every public profile view (src/app/[username]/page.tsx) embeds social_links, links, products, profile_phone_numbers, tracks and events by profile_id.
--     * Every dashboard request looks the signed-in person's profile up by profiles.user_id (src/app/dashboard/layout.tsx and ~30 other routes), and the profiles
--       RLS policies compare auth.uid() with user_id.
--     * The restaurant menu and tables are read by profile_id; deleting a profile (ON DELETE CASCADE) also has to find its rows in each of these tables.
--   Without an index each of those is a scan of the whole table. It is invisible while the tables are small and grows with every profile, which is why this is cheap to add now.
--
-- What it does (and nothing else)
--   Creates up to nine plain b-tree indexes, each `IF NOT EXISTS`, each only when its table and column exist (a table this database does not have is skipped silently, never an error).
--   No table, column, row, constraint, policy, trigger, function or grant is created, changed or dropped. Query results do not change; only how the database finds the rows.
--   Idempotent: safe to run twice. Index names are new and specific to this file.
--
-- Operational note
--   A plain CREATE INDEX briefly blocks WRITES to that one table while it builds (reads continue). At Ringo's table sizes that is milliseconds. If a table has become
--   large, run the statements one at a time outside a transaction using CREATE INDEX CONCURRENTLY instead.

begin;

do $$
declare
  r record;
  col text;
  ok boolean;
begin
  for r in
    select * from (values
      ('profiles',              'profiles_user_id_lookup_idx',              'user_id'),
      ('links',                 'links_profile_id_lookup_idx',              'profile_id'),
      ('social_links',          'social_links_profile_id_lookup_idx',       'profile_id'),
      ('products',              'products_profile_id_lookup_idx',           'profile_id'),
      ('profile_phone_numbers', 'profile_phone_numbers_profile_lookup_idx', 'profile_id'),
      ('tracks',                'tracks_profile_id_lookup_idx',             'profile_id'),
      ('events',                'events_profile_id_lookup_idx',             'profile_id'),
      ('menu_categories',       'menu_categories_profile_id_lookup_idx',    'profile_id'),
      ('restaurant_tables',     'restaurant_tables_profile_id_lookup_idx',  'profile_id')
    ) as t(tbl, idx, cols)
  loop
    if to_regclass('public.' || quote_ident(r.tbl)) is null then continue; end if;
    ok := true;
    foreach col in array string_to_array(r.cols, ',') loop
      if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = r.tbl and column_name = trim(col)) then ok := false; end if;
    end loop;
    if ok then
      execute format('create index if not exists %I on public.%I (%s)', r.idx, r.tbl, r.cols);
    end if;
  end loop;
end $$;

commit;
