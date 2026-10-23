-- VERIFY for 2026-12-29_ministry_events_announcements.sql — READ-ONLY (a single SELECT, no write). FOR OWNER REVIEW; run once AFTER the migration is applied.
-- Every row must show ok = true. It reads the catalog only: no event or announcement is created, read or changed.

with
t(name) as (values ('ministry_events'), ('ministry_announcements')),
checks(label, expect, actual) as (
  select '01 both tables exist and are managed by this migration', '2',
         (select count(*)::text from t where obj_description(to_regclass('public.' || t.name), 'pg_class') = 'managed by 2026-12-29_ministry_events_announcements.sql')
  union all select '02 row-level security is on for both', '2', (select count(*)::text from t where exists (select 1 from pg_class c where c.oid = to_regclass('public.' || t.name) and c.relrowsecurity))
  union all select '03 PUBLIC has no table privilege on either', '0',
         (select count(*)::text from t where has_table_privilege('public', 'public.' || t.name, 'select') or has_table_privilege('public', 'public.' || t.name, 'insert'))
  union all select '04 anon has no TABLE-level privilege on either (column SELECT only)', '0',
         (select count(*)::text from t where has_table_privilege('anon', 'public.' || t.name, 'select') or has_table_privilege('anon', 'public.' || t.name, 'insert')
                                           or has_table_privilege('anon', 'public.' || t.name, 'update') or has_table_privilege('anon', 'public.' || t.name, 'delete'))
  union all select '05 anon can read the public content columns of both', '2', (select count(*)::text from t where has_column_privilege('anon', 'public.' || t.name, 'title_en', 'select'))
  union all select '06 neither anon nor authenticated can reach an audit column (created_by, updated_by, published_by) of either table: 0 grants', '0',
         (select count(*)::text from t, unnest(array['anon', 'authenticated']) r, unnest(array['created_by', 'updated_by', 'published_by']) c, unnest(array['select', 'insert', 'update']) k
           where has_column_privilege(r, 'public.' || t.name, c, k))
  union all select '07 anon cannot write any column of either table', '0',
         (select count(*)::text from t where has_column_privilege('anon', 'public.' || t.name, 'title_en', 'insert') or has_column_privilege('anon', 'public.' || t.name, 'title_en', 'update'))
  union all select '08 authenticated cannot truncate, reference or trigger either table', '0',
         (select count(*)::text from t where has_table_privilege('authenticated', 'public.' || t.name, 'truncate') or has_table_privilege('authenticated', 'public.' || t.name, 'references') or has_table_privilege('authenticated', 'public.' || t.name, 'trigger'))
  union all select '09 profile_id cannot be updated by authenticated on either table', '0',
         (select count(*)::text from t where has_column_privilege('authenticated', 'public.' || t.name, 'profile_id', 'update'))
  union all select '10 five permissive and three restrictive policies on each table, none for PUBLIC', '10+6+0',
         (select count(*) filter (where polpermissive)::text || '+' || count(*) filter (where not polpermissive)::text || '+' || count(*) filter (where polroles = array[0::oid])::text
            from pg_policy where polrelid in (to_regclass('public.ministry_events'), to_regclass('public.ministry_announcements')))
  union all select '11 both guard triggers exist', '2',
         (select count(*)::text from pg_trigger where not tgisinternal and tgname in ('ministry_events_guard_trg', 'ministry_announcements_guard_trg'))
  union all select '12 the check constraints exist and are validated (events 12 + announcements 8)', '20',
         (select count(*)::text from pg_constraint where conrelid in (to_regclass('public.ministry_events'), to_regclass('public.ministry_announcements')) and contype = 'c' and convalidated)
  union all select '13 both functions exist and are managed by this migration', '2',
         (select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace and proname in ('ministry_today', 'ministry_content_guard') and obj_description(oid, 'pg_proc') = 'managed by 2026-12-29_ministry_events_announcements.sql')
  union all select '14 ministry_content_guard is security definer with a pinned search_path', '1',
         (select count(*)::text from pg_proc where oid = to_regprocedure('public.ministry_content_guard()') and prosecdef and proconfig::text like '%search_path=pg_catalog, public, pg_temp%')
  union all select '15 the Phase 2A tables still have their policies (7+4, 4+1, 4+4, 4+1 permissive+restrictive)', '11+5+8+5',
         ((select count(*) from pg_policy where polrelid = to_regclass('public.church_members')) || '+' || (select count(*) from pg_policy where polrelid = to_regclass('public.church_groups')) || '+' ||
          (select count(*) from pg_policy where polrelid = to_regclass('public.church_group_members')) || '+' || (select count(*) from pg_policy where polrelid = to_regclass('public.church_leadership')))
  union all select '16 no relation named church_* other than the four Phase 2A tables was added (Phase 0 verify row 10 still holds)', '0',
         (select count(*)::text from pg_tables where schemaname = 'public' and tablename like 'church\_%' and tablename not in ('church_members', 'church_groups', 'church_group_members', 'church_leadership'))
)
select label, expect, actual, (expect = actual) as ok from checks order by label;
