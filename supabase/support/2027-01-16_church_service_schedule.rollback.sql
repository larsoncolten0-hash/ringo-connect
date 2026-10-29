-- ROLLBACK for 2027-01-16_church_service_schedule.sql — FOR OWNER REVIEW; do not run unless rolling back.
--
-- Removes exactly what that migration created: public.church_service_schedule (its policies, indexes, constraints and trigger go with it) and the church_service_schedule_guard() function.
-- It touches no existing table, row, policy, trigger or function (events, announcements, attendance and every earlier phase stay exactly as they are).
--
-- DATA SAFETY: the table holds the churches' weekly schedules (and, later, the key attendance will attach to). This file REFUSES to run while any row exists. To drop it anyway, first export what
-- you need and then confirm the loss explicitly by adding this line as the FIRST statement inside the transaction (same script, same transaction):
--     select set_config('church_service_schedule.allow_data_loss', 'yes', true);
-- Dropping a table is irreversible; there is no soft rollback. Safe to re-run: every drop is "if exists".
begin;

set local lock_timeout = '5s';

do $$
declare
  v_marker constant text := 'managed by 2027-01-16_church_service_schedule.sql';
  v_bad text;
  v_rows bigint := 0;
begin
  -- never drop anything that is not provably this migration's own
  if to_regclass('public.church_service_schedule') is not null and coalesce(obj_description(to_regclass('public.church_service_schedule'), 'pg_class'), '') <> v_marker then
    raise exception 'rollback refused: public.church_service_schedule exists but is not managed by this migration';
  end if;
  if to_regclass('public.church_service_schedule') is not null then
    select count(*) into v_rows from public.church_service_schedule;
  end if;
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'church_service_schedule_guard' and coalesce(obj_description(p.oid, 'pg_proc'), '') <> v_marker;
  if v_bad is not null then raise exception 'rollback refused: function(s) % exist but are not managed by this migration', v_bad; end if;

  if v_rows > 0 and coalesce(current_setting('church_service_schedule.allow_data_loss', true), '') <> 'yes' then
    raise exception 'rollback refused: the table holds % row(s). Export what you need, then confirm the loss with: select set_config(''church_service_schedule.allow_data_loss'', ''yes'', true);', v_rows;
  end if;

  perform set_config('church_service_schedule.pre', jsonb_build_object(
    'profiles', (select count(*) from public.profiles),
    'policies', (select coalesce(jsonb_agg(p.polname order by p.polrelid::regclass::text, p.polname), '[]'::jsonb)
                   from pg_policy p where p.polrelid in ('public.profiles'::regclass, 'public.organization_roles'::regclass, 'public.organization_members'::regclass) or p.polrelid = to_regclass('public.ministry_events'))
  )::text, true);
end $$;

drop table if exists public.church_service_schedule;
drop function if exists public.church_service_schedule_guard();

do $$
declare
  v_pre jsonb := current_setting('church_service_schedule.pre')::jsonb;
begin
  if to_regclass('public.church_service_schedule') is not null then raise exception 'rollback failed: the table is still there'; end if;
  if to_regprocedure('public.church_service_schedule_guard()') is not null then raise exception 'rollback failed: the guard function is still there'; end if;
  if (select count(*) from public.profiles) <> (v_pre->>'profiles')::bigint then
    raise exception 'rollback failed: a row count of an existing table changed';
  end if;
  if (select coalesce(jsonb_agg(p.polname order by p.polrelid::regclass::text, p.polname), '[]'::jsonb)
        from pg_policy p where p.polrelid in ('public.profiles'::regclass, 'public.organization_roles'::regclass, 'public.organization_members'::regclass) or p.polrelid = to_regclass('public.ministry_events')) is distinct from v_pre->'policies' then
    raise exception 'rollback failed: a policy of an existing table changed';
  end if;
end $$;

commit;
