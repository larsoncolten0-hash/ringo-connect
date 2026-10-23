-- VERIFY for 2026-12-28_daily_words.sql — READ-ONLY (a single SELECT, no write). FOR OWNER REVIEW; run once AFTER the migration is applied.
-- Every row must show ok = true. It reads the catalog only: no daily word is created, read or changed.

with
checks(label, expect, actual) as (
  select '01 public.daily_words exists and is managed by this migration', '1',
         (select count(*)::text from pg_class where oid = to_regclass('public.daily_words') and obj_description(oid, 'pg_class') = 'managed by 2026-12-28_daily_words.sql')
  union all select '02 row-level security is on', '1', (select count(*)::text from pg_class where oid = to_regclass('public.daily_words') and relrowsecurity)
  union all select '03 PUBLIC has no table privilege', '0', (select (has_table_privilege('public', 'public.daily_words', 'select') or has_table_privilege('public', 'public.daily_words', 'insert'))::int::text)
  union all select '04 anon has no TABLE-level privilege (column SELECT only)', '0',
         (select (has_table_privilege('anon', 'public.daily_words', 'select') or has_table_privilege('anon', 'public.daily_words', 'insert') or has_table_privilege('anon', 'public.daily_words', 'update') or has_table_privilege('anon', 'public.daily_words', 'delete'))::int::text)
  union all select '05 anon can read the public content columns', '1', (select has_column_privilege('anon', 'public.daily_words', 'title_en', 'select')::int::text)
  union all select '06 neither anon nor authenticated can reach an audit column (created_by, updated_by, published_by): 0 grants', '0',
         (select count(*)::text from unnest(array['anon', 'authenticated']) r, unnest(array['created_by', 'updated_by', 'published_by']) c, unnest(array['select', 'insert', 'update']) k where has_column_privilege(r, 'public.daily_words', c, k))
  union all select '07 anon cannot write any column', '0', (select (has_column_privilege('anon', 'public.daily_words', 'title_en', 'insert') or has_column_privilege('anon', 'public.daily_words', 'title_en', 'update'))::int::text)
  union all select '08 authenticated cannot truncate, reference or trigger', '0',
         (select (has_table_privilege('authenticated', 'public.daily_words', 'truncate') or has_table_privilege('authenticated', 'public.daily_words', 'references') or has_table_privilege('authenticated', 'public.daily_words', 'trigger'))::int::text)
  union all select '09 profile_id cannot be updated by authenticated', '0', (select has_column_privilege('authenticated', 'public.daily_words', 'profile_id', 'update')::int::text)
  union all select '10 five permissive and three restrictive policies, none for PUBLIC', '5+3+0',
         (select count(*) filter (where polpermissive)::text || '+' || count(*) filter (where not polpermissive)::text || '+' || count(*) filter (where polroles = array[0::oid])::text from pg_policy where polrelid = to_regclass('public.daily_words'))
  union all select '11 the guard trigger exists and the one-published-per-day index exists', '2',
         ((select count(*) from pg_trigger where tgrelid = to_regclass('public.daily_words') and not tgisinternal and tgname = 'daily_word_guard_trg') + (select count(*) from pg_indexes where schemaname = 'public' and indexname = 'daily_words_one_published_per_day_key'))::text
  union all select '12 the table constraints exist and are validated (status, date range, published_at, publish content, ten length checks)', '14',
         (select count(*)::text from pg_constraint where conrelid = to_regclass('public.daily_words') and contype = 'c' and convalidated)
  union all select '13 both functions exist and are managed by this migration', '2',
         (select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace and proname in ('daily_word_today', 'daily_word_guard') and obj_description(oid, 'pg_proc') = 'managed by 2026-12-28_daily_words.sql')
  union all select '14 daily_word_guard is security definer with a pinned search_path', '1',
         (select count(*)::text from pg_proc where oid = to_regprocedure('public.daily_word_guard()') and prosecdef and proconfig::text like '%search_path=pg_catalog, public, pg_temp%')
  union all select '15 the Phase 2A tables still have their policies (7+4, 4+1, 4+4, 4+1 permissive+restrictive)', '11+5+8+5',
         ((select count(*) from pg_policy where polrelid = to_regclass('public.church_members')) || '+' || (select count(*) from pg_policy where polrelid = to_regclass('public.church_groups')) || '+' ||
          (select count(*) from pg_policy where polrelid = to_regclass('public.church_group_members')) || '+' || (select count(*) from pg_policy where polrelid = to_regclass('public.church_leadership')))
  union all select '16 no relation named church_* other than the four Phase 2A tables was added (Phase 0 verify row 10 still holds)', '0',
         (select count(*)::text from pg_tables where schemaname = 'public' and tablename like 'church\_%' and tablename not in ('church_members', 'church_groups', 'church_group_members', 'church_leadership'))
)
select label, expect, actual, (expect = actual) as ok from checks order by label;
