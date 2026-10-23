-- VERIFY for 2026-12-30_bible_programs.sql — READ-ONLY (a single SELECT, no write). FOR OWNER REVIEW; run once AFTER the migration is applied.
-- Every row must show ok = true. It reads the catalog only: no programme, enrolment or progress row is created, read or changed.

with
t(name) as (values ('bible_programs'), ('bible_program_sessions'), ('bible_enrollments'), ('bible_session_progress')),
content(name) as (values ('bible_programs'), ('bible_program_sessions')),
private(name) as (values ('bible_enrollments'), ('bible_session_progress')),
checks(label, expect, actual) as (
  select '01 all four tables exist and are managed by this migration', '4',
         (select count(*)::text from t where obj_description(to_regclass('public.' || t.name), 'pg_class') = 'managed by 2026-12-30_bible_programs.sql')
  union all select '02 row-level security is on for all four', '4', (select count(*)::text from t where exists (select 1 from pg_class c where c.oid = to_regclass('public.' || t.name) and c.relrowsecurity))
  union all select '03 PUBLIC and anon have no TABLE-level privilege of any kind on any table', '0',
         (select count(*)::text from t, unnest(array['public', 'anon']) r, unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) k where has_table_privilege(r, 'public.' || t.name, k))
  union all select '04 anon can read the public content columns of the two content tables and write none', '2+0',
         ((select count(*)::text from content where has_column_privilege('anon', 'public.' || content.name, 'title_en', 'select')) || '+' ||
          (select count(*)::text from content where has_any_column_privilege('anon', 'public.' || content.name, 'insert') or has_any_column_privilege('anon', 'public.' || content.name, 'update')))
  union all select '05 neither anon nor authenticated can reach an audit column (created_by, updated_by, published_by) of the content tables: 0 grants', '0',
         (select count(*)::text from content, unnest(array['anon', 'authenticated']) r, unnest(array['created_by', 'updated_by', 'published_by']) c, unnest(array['select', 'insert', 'update']) k
           where exists (select 1 from pg_attribute a where a.attrelid = to_regclass('public.' || content.name) and a.attname = c and not a.attisdropped) and has_column_privilege(r, 'public.' || content.name, c, k))
  union all select '06 the two PRIVATE tables have no policy at all and no privilege or column privilege for anon or authenticated', '0+0',
         ((select count(*)::text from pg_policy where polrelid in (to_regclass('public.bible_enrollments'), to_regclass('public.bible_session_progress'))) || '+' ||
          (select count(*)::text from private, unnest(array['anon', 'authenticated']) r, unnest(array['select', 'insert', 'update']) k
            where has_table_privilege(r, 'public.' || private.name, k) or has_any_column_privilege(r, 'public.' || private.name, k)))
  union all select '07 the service role can reach both private tables', '2', (select count(*)::text from private where has_table_privilege('service_role', 'public.' || private.name, 'select') and has_table_privilege('service_role', 'public.' || private.name, 'delete'))
  union all select '08 authenticated cannot truncate, reference or trigger any of the four', '0',
         (select count(*)::text from t where has_table_privilege('authenticated', 'public.' || t.name, 'truncate') or has_table_privilege('authenticated', 'public.' || t.name, 'references') or has_table_privilege('authenticated', 'public.' || t.name, 'trigger'))
  union all select '09 each content table has 5 permissive and 3 restrictive policies, none for PUBLIC', '10+6+0',
         (select count(*) filter (where polpermissive)::text || '+' || count(*) filter (where not polpermissive)::text || '+' || count(*) filter (where polroles = array[0::oid])::text
            from pg_policy where polrelid in (to_regclass('public.bible_programs'), to_regclass('public.bible_program_sessions')))
  union all select '10 the four guard triggers exist', '4',
         (select count(*)::text from pg_trigger where not tgisinternal and tgname in ('bible_programs_guard_trg', 'bible_program_sessions_guard_trg', 'bible_enrollments_guard_trg', 'bible_session_progress_guard_trg'))
  union all select '11 the seven keys exist and are validated (session, enrolment and progress composite foreign keys, one enrolment per visitor and programme, one tick per session, one session per position)', '7',
         (select count(*)::text from pg_constraint where conname in ('bible_program_sessions_program_fk', 'bible_enrollments_program_fk', 'bible_session_progress_enrollment_fk', 'bible_session_progress_session_fk', 'bible_enrollments_program_customer_key', 'bible_session_progress_enrollment_session_key', 'bible_program_sessions_position_key') and convalidated)
  union all select '12 all six functions exist and are managed by this migration', '6',
         (select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace and proname in ('bible_program_guard', 'bible_session_guard', 'bible_enrollment_guard', 'bible_progress_guard', 'bible_program_stats', 'bible_session_move') and obj_description(oid, 'pg_proc') = 'managed by 2026-12-30_bible_programs.sql')
  union all select '13 the four guards and the stats function are security definer with a pinned search_path; the move function runs as the caller', '5+1',
         ((select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace and proname in ('bible_program_guard', 'bible_session_guard', 'bible_enrollment_guard', 'bible_progress_guard', 'bible_program_stats') and prosecdef and proconfig::text like '%search_path=pg_catalog, public, pg_temp%') || '+' ||
          (select count(*)::text from pg_proc where oid = to_regprocedure('public.bible_session_move(uuid, text)') and not prosecdef))
  union all select '14 stats and move are callable by signed-in users and not by anon or PUBLIC; the guards are callable by nobody', '2+0+0',
         ((select count(*)::text from unnest(array['bible_program_stats(uuid)', 'bible_session_move(uuid, text)']) f where has_function_privilege('authenticated', 'public.' || f, 'execute')) || '+' ||
          (select count(*)::text from unnest(array['bible_program_stats(uuid)', 'bible_session_move(uuid, text)']) f where has_function_privilege('anon', 'public.' || f, 'execute') or has_function_privilege('public', 'public.' || f, 'execute')) || '+' ||
          (select count(*)::text from unnest(array['bible_program_guard()', 'bible_session_guard()', 'bible_enrollment_guard()', 'bible_progress_guard()']) f where has_function_privilege('anon', 'public.' || f, 'execute') or has_function_privilege('authenticated', 'public.' || f, 'execute') or has_function_privilege('public', 'public.' || f, 'execute')))
  union all select '15 the Phase 2A tables still have their policies (7+4, 4+1, 4+4, 4+1 permissive+restrictive)', '11+5+8+5',
         ((select count(*) from pg_policy where polrelid = to_regclass('public.church_members')) || '+' || (select count(*) from pg_policy where polrelid = to_regclass('public.church_groups')) || '+' ||
          (select count(*) from pg_policy where polrelid = to_regclass('public.church_group_members')) || '+' || (select count(*) from pg_policy where polrelid = to_regclass('public.church_leadership')))
  union all select '16 no relation named church_* other than the four Phase 2A tables was added (Phase 0 verify row 10 still holds)', '0',
         (select count(*)::text from pg_tables where schemaname = 'public' and tablename like 'church\_%' and tablename not in ('church_members', 'church_groups', 'church_group_members', 'church_leadership'))
)
select label, expect, actual, (expect = actual) as ok from checks order by label;
