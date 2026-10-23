-- VERIFY for 2027-01-01_ministry_music_links.sql — READ-ONLY (a single SELECT, no write). FOR OWNER REVIEW; run once AFTER the migration is applied.
-- Every row must show ok = true. It reads the catalog only: no music link row is created, read or changed.

with
checks(label, expect, actual) as (
  select '01 the table exists and is managed by this migration', '1',
         (select count(*)::text from pg_class where oid = to_regclass('public.ministry_music_links') and obj_description(oid, 'pg_class') = 'managed by 2027-01-01_ministry_music_links.sql')
  union all select '02 row-level security is on', '1', (select count(*)::text from pg_class where oid = to_regclass('public.ministry_music_links') and relrowsecurity)
  union all select '03 PUBLIC and anon have no table-level privilege of any kind', '0',
         (select count(*)::text from unnest(array['public', 'anon']) r, unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) k where has_table_privilege(r, 'public.ministry_music_links', k))
  union all select '04 anon has column SELECT only (no insert, no update column privilege)', '0',
         (select (has_any_column_privilege('anon', 'public.ministry_music_links', 'insert') or has_any_column_privilege('anon', 'public.ministry_music_links', 'update'))::int::text)
  union all select '05 anon can read the public url column', '1', (select has_column_privilege('anon', 'public.ministry_music_links', 'url', 'select')::int::text)
  union all select '06 authenticated cannot reach created_by or updated_by: 0 grants', '0',
         (select count(*)::text from unnest(array['anon', 'authenticated']) r, unnest(array['created_by', 'updated_by']) c, unnest(array['select', 'insert', 'update']) k where has_column_privilege(r, 'public.ministry_music_links', c, k))
  union all select '07 authenticated cannot update profile_id, and cannot truncate, reference or trigger', '0',
         (select (has_column_privilege('authenticated', 'public.ministry_music_links', 'profile_id', 'update') or has_table_privilege('authenticated', 'public.ministry_music_links', 'truncate')
                  or has_table_privilege('authenticated', 'public.ministry_music_links', 'references') or has_table_privilege('authenticated', 'public.ministry_music_links', 'trigger'))::int::text)
  union all select '08 5 permissive + 3 restrictive policies, none for PUBLIC', '5+3+0',
         ((select count(*) filter (where polpermissive) || '+' || count(*) filter (where not polpermissive) from pg_policy where polrelid = to_regclass('public.ministry_music_links')) || '+' ||
          (select count(*) from pg_policy where polrelid = to_regclass('public.ministry_music_links') and polroles = array[0::oid]))
  union all select '09 the guard trigger exists', '1',
         (select count(*)::text from pg_trigger where tgrelid = to_regclass('public.ministry_music_links') and not tgisinternal and tgname = 'ministry_music_links_guard_trg')
  union all select '10 the four check constraints exist and are validated (platform, title, url, sort_order)', '4',
         (select count(*)::text from pg_constraint where conrelid = to_regclass('public.ministry_music_links') and contype = 'c' and convalidated)
  union all select '11 the unique address index exists', '1', (select count(*)::text from pg_indexes where schemaname = 'public' and indexname = 'ministry_music_links_profile_url_key')
  union all select '12 the guard function exists, is managed by this migration, security definer with a pinned search_path', '1',
         (select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace and proname = 'ministry_music_link_guard' and obj_description(oid, 'pg_proc') = 'managed by 2027-01-01_ministry_music_links.sql'
             and prosecdef and proconfig::text like '%search_path=pg_catalog, public, pg_temp%')
  union all select '13 the guard is not callable by PUBLIC, anon or authenticated', '0',
         (select (has_function_privilege('anon', 'public.ministry_music_link_guard()', 'execute') or has_function_privilege('authenticated', 'public.ministry_music_link_guard()', 'execute')
                  or has_function_privilege('public', 'public.ministry_music_link_guard()', 'execute'))::int::text)
  union all select '14 no relation named ministry_music* other than the one table (and its indexes) exists', '0',
         (select count(*)::text from pg_class where relnamespace = 'public'::regnamespace and relname like 'ministry\_music%' and relname not in ('ministry_music_links', 'ministry_music_links_pkey', 'ministry_music_links_profile_idx', 'ministry_music_links_profile_url_key'))
  union all select '15 no relation named church_* other than the four Phase 2A tables was added (Phase 0 verify row 10 still holds)', '0',
         (select count(*)::text from pg_tables where schemaname = 'public' and tablename like 'church\_%' and tablename not in ('church_members', 'church_groups', 'church_group_members', 'church_leadership'))
)
select label, expect, actual, (expect = actual) as ok from checks order by label;
