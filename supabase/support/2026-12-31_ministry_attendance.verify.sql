-- VERIFY for 2026-12-31_ministry_attendance.sql — READ-ONLY (a single SELECT, no write). FOR OWNER REVIEW; run once AFTER the migration is applied.
-- Every row must show ok = true. It reads the catalog only: no attendance row is created, read or changed.

with
t(name) as (values ('ministry_attendance'), ('ministry_attendance_counts')),
checks(label, expect, actual) as (
  select '01 both tables exist and are managed by this migration', '2',
         (select count(*)::text from t where obj_description(to_regclass('public.' || t.name), 'pg_class') = 'managed by 2026-12-31_ministry_attendance.sql')
  union all select '02 row-level security is on for both', '2', (select count(*)::text from t where exists (select 1 from pg_class c where c.oid = to_regclass('public.' || t.name) and c.relrowsecurity))
  union all select '03 PUBLIC and anon have no table-level privilege of any kind on either table', '0',
         (select count(*)::text from t, unnest(array['public', 'anon']) r, unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) k where has_table_privilege(r, 'public.' || t.name, k))
  union all select '04 anon has no column privilege on either table', '0',
         (select count(*)::text from t where has_any_column_privilege('anon', 'public.' || t.name, 'select') or has_any_column_privilege('anon', 'public.' || t.name, 'insert') or has_any_column_privilege('anon', 'public.' || t.name, 'update'))
  union all select '05 authenticated cannot reach recorded_by on either table: 0 grants', '0',
         (select count(*)::text from t, unnest(array['select', 'insert', 'update']) k where has_column_privilege('authenticated', 'public.' || t.name, 'recorded_by', k))
  union all select '06 authenticated cannot truncate, reference or trigger either table', '0',
         (select count(*)::text from t where has_table_privilege('authenticated', 'public.' || t.name, 'truncate') or has_table_privilege('authenticated', 'public.' || t.name, 'references') or has_table_privilege('authenticated', 'public.' || t.name, 'trigger'))
  union all select '07 attendance rows cannot be updated by authenticated (recorded or removed, never edited)', '0',
         (select (has_table_privilege('authenticated', 'public.ministry_attendance', 'update') or has_any_column_privilege('authenticated', 'public.ministry_attendance', 'update'))::int::text)
  union all select '08 profile_id and event_id cannot be updated by authenticated on either table', '0',
         (select count(*)::text from t, unnest(array['profile_id', 'event_id']) c where has_column_privilege('authenticated', 'public.' || t.name, c, 'update'))
  union all select '09 attendance has 3 permissive + 2 restrictive policies, counts has 4 + 3, none for PUBLIC', '3+2+4+3+0',
         ((select count(*) filter (where polpermissive) || '+' || count(*) filter (where not polpermissive) from pg_policy where polrelid = to_regclass('public.ministry_attendance')) || '+' ||
          (select count(*) filter (where polpermissive) || '+' || count(*) filter (where not polpermissive) from pg_policy where polrelid = to_regclass('public.ministry_attendance_counts')) || '+' ||
          (select count(*) from pg_policy where polrelid in (to_regclass('public.ministry_attendance'), to_regclass('public.ministry_attendance_counts')) and polroles = array[0::oid]))
  union all select '10 both guard triggers exist', '2',
         (select count(*)::text from pg_trigger where not tgisinternal and tgname in ('ministry_attendance_guard_trg', 'ministry_attendance_counts_guard_trg'))
  union all select '11 the four keys exist and are validated (event and member composite foreign keys, one person once per event, the counts event key)', '4',
         (select count(*)::text from pg_constraint where conname in ('ministry_attendance_event_fk', 'ministry_attendance_member_fk', 'ministry_attendance_event_member_key', 'ministry_attendance_counts_event_fk') and convalidated)
  union all select '12 the two count check constraints exist and are validated', '2',
         (select count(*)::text from pg_constraint where conrelid = to_regclass('public.ministry_attendance_counts') and contype = 'c' and convalidated)
  union all select '13 both functions exist and are managed by this migration', '2',
         (select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace and proname in ('ministry_attendance_guard', 'ministry_attendance_counts_guard') and obj_description(oid, 'pg_proc') = 'managed by 2026-12-31_ministry_attendance.sql')
  union all select '14 both guards are security definer with a pinned search_path', '2',
         (select count(*)::text from pg_proc where proname in ('ministry_attendance_guard', 'ministry_attendance_counts_guard') and pronamespace = 'public'::regnamespace and prosecdef and proconfig::text like '%search_path=pg_catalog, public, pg_temp%')
  union all select '15 the Phase 2A, Phase 3 and Phase 4 tables still have their policies (11+5+8+5, events 8, announcements 8)', '11+5+8+5+8+8',
         ((select count(*) from pg_policy where polrelid = to_regclass('public.church_members')) || '+' || (select count(*) from pg_policy where polrelid = to_regclass('public.church_groups')) || '+' ||
          (select count(*) from pg_policy where polrelid = to_regclass('public.church_group_members')) || '+' || (select count(*) from pg_policy where polrelid = to_regclass('public.church_leadership')) || '+' ||
          (select count(*) from pg_policy where polrelid = to_regclass('public.ministry_events')) || '+' || (select count(*) from pg_policy where polrelid = to_regclass('public.ministry_announcements')))
  union all select '16 no relation named church_* other than the four Phase 2A tables was added (Phase 0 verify row 10 still holds)', '0',
         (select count(*)::text from pg_tables where schemaname = 'public' and tablename like 'church\_%' and tablename not in ('church_members', 'church_groups', 'church_group_members', 'church_leadership'))
)
select label, expect, actual, (expect = actual) as ok from checks order by label;
