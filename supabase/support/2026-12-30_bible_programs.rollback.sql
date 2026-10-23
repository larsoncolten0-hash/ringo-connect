-- ROLLBACK for 2026-12-30_bible_programs.sql — FOR OWNER REVIEW; do not run unless rolling back.
--
-- Removes exactly what that migration created: the four bible_* tables (their policies, indexes, constraints and triggers go with them) and the six bible_* functions. It touches no existing table,
-- row, policy, trigger or function (the visitor accounts, the roster, events and every other phase stay exactly as they are), and it proves that at the end.
--
-- DATA SAFETY: the tables hold the church's reading programmes AND visitors' private enrolments and progress. This file REFUSES to run while any row exists. To drop them anyway, first export what
-- you need and then confirm the loss explicitly by adding this line as the FIRST statement inside the transaction (same script, same transaction):
--     select set_config('bible_programs.allow_data_loss', 'yes', true);
-- Dropping a table is irreversible; there is no soft rollback. A softer alternative that keeps everything: unpublish the programmes (nothing is public, and nobody can join or tick).
-- Safe to re-run: every drop is "if exists".
begin;

set local lock_timeout = '5s';

do $$
declare
  v_marker constant text := 'managed by 2026-12-30_bible_programs.sql';
  v_bad text;
  v_rows bigint := 0;
  v_t text;
  v_n bigint;
begin
  -- never drop anything that is not provably this migration's own
  foreach v_t in array array['bible_programs', 'bible_program_sessions', 'bible_enrollments', 'bible_session_progress'] loop
    if to_regclass('public.' || v_t) is not null and coalesce(obj_description(to_regclass('public.' || v_t), 'pg_class'), '') <> v_marker then
      raise exception 'rollback refused: public.% exists but is not managed by this migration', v_t;
    end if;
    if to_regclass('public.' || v_t) is not null then
      execute format('select count(*) from public.%I', v_t) into v_n;
      v_rows := v_rows + v_n;
    end if;
  end loop;
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname in ('bible_program_guard', 'bible_session_guard', 'bible_enrollment_guard', 'bible_progress_guard', 'bible_program_stats', 'bible_session_move')
     and coalesce(obj_description(p.oid, 'pg_proc'), '') <> v_marker;
  if v_bad is not null then raise exception 'rollback refused: function(s) % exist but are not managed by this migration', v_bad; end if;

  if v_rows > 0 and coalesce(current_setting('bible_programs.allow_data_loss', true), '') <> 'yes' then
    raise exception 'rollback refused: the tables hold % row(s). Export what you need, then confirm the loss with: select set_config(''bible_programs.allow_data_loss'', ''yes'', true);', v_rows;
  end if;

  perform set_config('bible_programs.pre', jsonb_build_object(
    'profiles',  (select count(*) from public.profiles),
    'customers', (select count(*) from public.ringo_customers),
    'policies',  (select coalesce(jsonb_agg(p.polname order by p.polrelid::regclass::text, p.polname), '[]'::jsonb)
                    from pg_policy p where p.polrelid in ('public.profiles'::regclass, 'public.organization_roles'::regclass, 'public.organization_members'::regclass, 'public.ringo_customers'::regclass,
                                                           'public.church_members'::regclass, 'public.church_groups'::regclass, 'public.church_group_members'::regclass, 'public.church_leadership'::regclass)
                       or p.polrelid = to_regclass('public.daily_words') or p.polrelid = to_regclass('public.ministry_events') or p.polrelid = to_regclass('public.ministry_announcements')),
    'fn_defs',   (select jsonb_object_agg(f.proname, md5(pg_get_functiondef(f.oid)))
                    from pg_proc f where f.pronamespace = 'public'::regnamespace
                     and (f.proname like 'church\_%' or f.proname like 'team\_church\_%' or f.proname like 'daily\_word%' or f.proname like 'ministry\_%' or f.proname in ('is_admin', 'has_org_permission', 'is_org_member', 'is_church_profile')))
  )::text, true);
end $$;

drop table if exists public.bible_session_progress;
drop table if exists public.bible_enrollments;
drop table if exists public.bible_program_sessions;
drop table if exists public.bible_programs;
drop function if exists public.bible_session_move(uuid, text);
drop function if exists public.bible_program_stats(uuid);
drop function if exists public.bible_progress_guard();
drop function if exists public.bible_enrollment_guard();
drop function if exists public.bible_session_guard();
drop function if exists public.bible_program_guard();

do $$
declare
  v_pre jsonb := current_setting('bible_programs.pre')::jsonb;
begin
  if exists (select 1 from pg_class where relnamespace = 'public'::regnamespace and relname like 'bible\_%') then raise exception 'rollback postcondition failed: a table remains'; end if;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname like 'bible\_%') then raise exception 'rollback postcondition failed: a function remains'; end if;
  if (select count(*) from public.profiles) <> (v_pre->>'profiles')::bigint or (select count(*) from public.ringo_customers) <> (v_pre->>'customers')::bigint then
    raise exception 'rollback postcondition failed: a row count of an existing table changed';
  end if;
  if (select coalesce(jsonb_agg(p.polname order by p.polrelid::regclass::text, p.polname), '[]'::jsonb)
        from pg_policy p where p.polrelid in ('public.profiles'::regclass, 'public.organization_roles'::regclass, 'public.organization_members'::regclass, 'public.ringo_customers'::regclass,
                                               'public.church_members'::regclass, 'public.church_groups'::regclass, 'public.church_group_members'::regclass, 'public.church_leadership'::regclass)
                           or p.polrelid = to_regclass('public.daily_words') or p.polrelid = to_regclass('public.ministry_events') or p.polrelid = to_regclass('public.ministry_announcements')) is distinct from v_pre->'policies' then
    raise exception 'rollback postcondition failed: a policy of an existing table changed';
  end if;
  if (select jsonb_object_agg(f.proname, md5(pg_get_functiondef(f.oid)))
        from pg_proc f where f.pronamespace = 'public'::regnamespace
         and (f.proname like 'church\_%' or f.proname like 'team\_church\_%' or f.proname like 'daily\_word%' or f.proname like 'ministry\_%' or f.proname in ('is_admin', 'has_org_permission', 'is_org_member', 'is_church_profile'))) is distinct from v_pre->'fn_defs' then
    raise exception 'rollback postcondition failed: an existing function changed';
  end if;
end $$;

commit;
