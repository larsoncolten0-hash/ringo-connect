-- ROLLBACK for 2027-01-07_church_bible_year.sql — FOR OWNER REVIEW; do not run unless rolling back.
--
-- Removes exactly what that migration added: the three tables (church switches, reading plan enrolments, ticked days), the three guard functions and their triggers. It touches no other table.
--
-- DATA SAFETY: dropping the tables deletes every church switch, every person's reading plan and every ticked day. This file REFUSES to run while any row exists. To drop them anyway, confirm the loss
-- explicitly by adding this line as the FIRST statement inside the transaction (same script, same transaction):
--     select set_config('church_bible_year.allow_data_loss', 'yes', true);
-- Safe to re-run: every drop is "if exists".
begin;

set local lock_timeout = '5s';

do $$
declare
  v_marker constant text := 'managed by 2027-01-07_church_bible_year.sql';
  v_rows bigint := 0;
  v_t text;
  v_n bigint;
  v_bad text;
begin
  foreach v_t in array array['church_features', 'bible_year_enrollments', 'bible_year_progress'] loop
    if to_regclass('public.' || v_t) is not null then
      if coalesce(obj_description(to_regclass('public.' || v_t), 'pg_class'), '') <> v_marker then raise exception 'rollback refused: public.% exists but is not managed by this migration', v_t; end if;
      execute format('select count(*) from public.%I', v_t) into v_n;
      v_rows := v_rows + v_n;
    end if;
  end loop;
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname in ('church_features_guard', 'bible_year_enrollment_guard', 'bible_year_progress_guard') and coalesce(obj_description(p.oid, 'pg_proc'), '') <> v_marker;
  if v_bad is not null then raise exception 'rollback refused: function(s) % exist but are not managed by this migration', v_bad; end if;
  if v_rows > 0 and coalesce(current_setting('church_bible_year.allow_data_loss', true), '') <> 'yes' then
    raise exception 'rollback refused: % row(s) exist. Confirm the loss with: select set_config(''church_bible_year.allow_data_loss'', ''yes'', true);', v_rows;
  end if;
end $$;

drop table if exists public.bible_year_progress;
drop table if exists public.bible_year_enrollments;
drop table if exists public.church_features;
drop function if exists public.bible_year_progress_guard();
drop function if exists public.bible_year_enrollment_guard();
drop function if exists public.church_features_guard();

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name in ('church_features', 'bible_year_enrollments', 'bible_year_progress')) then raise exception 'rollback postcondition failed: a table is still there'; end if;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('church_features_guard', 'bible_year_enrollment_guard', 'bible_year_progress_guard')) then raise exception 'rollback postcondition failed: a function is still there'; end if;
  if to_regclass('public.profiles') is null or to_regclass('public.ringo_customers') is null then raise exception 'rollback postcondition failed: an earlier table is gone'; end if;
end $$;

commit;
