-- ROLLBACK for 2027-01-03_ministry_testimonies.sql — FOR OWNER REVIEW; do not run unless rolling back.
--
-- Removes exactly what that migration created: public.ministry_testimony_history and public.ministry_testimonies (their policies, indexes, constraints and triggers go with them) and the four
-- ministry_testimon* functions. It touches no existing table, row, policy, trigger or function, and it proves that at the end.
--
-- DATA SAFETY: the tables hold people's names, phone numbers and testimonies, and the moderation history. This file REFUSES to run while any row exists. To drop them anyway, first export what you
-- need and then confirm the loss explicitly by adding this line as the FIRST statement inside the transaction (same script, same transaction):
--     select set_config('ministry_testimonies.allow_data_loss', 'yes', true);
-- Dropping a table is irreversible; there is no soft rollback. Safe to re-run: every drop is "if exists".
begin;

set local lock_timeout = '5s';

do $$
declare
  v_marker constant text := 'managed by 2027-01-03_ministry_testimonies.sql';
  v_bad text;
  v_t text;
  v_rows bigint := 0;
begin
  foreach v_t in array array['ministry_testimonies', 'ministry_testimony_history'] loop
    if to_regclass('public.' || v_t) is not null and coalesce(obj_description(to_regclass('public.' || v_t), 'pg_class'), '') <> v_marker then
      raise exception 'rollback refused: public.% exists but is not managed by this migration', v_t;
    end if;
  end loop;
  if to_regclass('public.ministry_testimonies') is not null then v_rows := v_rows + (select count(*) from public.ministry_testimonies); end if;
  if to_regclass('public.ministry_testimony_history') is not null then v_rows := v_rows + (select count(*) from public.ministry_testimony_history); end if;
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname in ('ministry_testimony_guard', 'ministry_testimony_audit', 'ministry_testimony_history_guard', 'ministry_testimonies_public')
     and coalesce(obj_description(p.oid, 'pg_proc'), '') <> v_marker;
  if v_bad is not null then raise exception 'rollback refused: function(s) % exist but are not managed by this migration', v_bad; end if;

  if v_rows > 0 and coalesce(current_setting('ministry_testimonies.allow_data_loss', true), '') <> 'yes' then
    raise exception 'rollback refused: the tables hold % row(s). Export what you need, then confirm the loss with: select set_config(''ministry_testimonies.allow_data_loss'', ''yes'', true);', v_rows;
  end if;

  perform set_config('ministry_testimonies.pre', jsonb_build_object(
    'profiles',  (select count(*) from public.profiles),
    'policies',  (select coalesce(jsonb_agg(p.polname order by p.polrelid::regclass::text, p.polname), '[]'::jsonb)
                    from pg_policy p where p.polrelid in ('public.profiles'::regclass, 'public.organization_roles'::regclass, 'public.organization_members'::regclass)
                       or p.polrelid = to_regclass('public.church_members') or p.polrelid = to_regclass('public.ministry_events') or p.polrelid = to_regclass('public.daily_words')
                       or p.polrelid = to_regclass('public.ministry_care_cases') or p.polrelid = to_regclass('public.bible_programs')),
    'fn_defs',   (select jsonb_object_agg(f.proname, md5(pg_get_functiondef(f.oid)))
                    from pg_proc f where f.pronamespace = 'public'::regnamespace
                     and (f.proname like 'church\_%' or f.proname like 'team\_church\_%' or f.proname like 'daily\_word%' or f.proname like 'bible\_%'
                          or (f.proname like 'ministry\_%' and f.proname not like 'ministry\_testimon%')
                          or f.proname in ('is_admin', 'has_org_permission', 'is_org_member', 'is_church_profile')))
  )::text, true);
end $$;

-- the history first (its foreign key points at the testimony)
drop table if exists public.ministry_testimony_history;
drop table if exists public.ministry_testimonies;
drop function if exists public.ministry_testimonies_public(uuid);
drop function if exists public.ministry_testimony_history_guard();
drop function if exists public.ministry_testimony_audit();
drop function if exists public.ministry_testimony_guard();

do $$
declare
  v_pre jsonb := current_setting('ministry_testimonies.pre')::jsonb;
begin
  if exists (select 1 from pg_class where relnamespace = 'public'::regnamespace and relname like 'ministry\_testimon%') then raise exception 'rollback postcondition failed: a ministry_testimon relation remains'; end if;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname like 'ministry\_testimon%') then raise exception 'rollback postcondition failed: a function remains'; end if;
  if (select count(*) from public.profiles) <> (v_pre->>'profiles')::bigint then raise exception 'rollback postcondition failed: a row count of an existing table changed'; end if;
  if (select coalesce(jsonb_agg(p.polname order by p.polrelid::regclass::text, p.polname), '[]'::jsonb)
        from pg_policy p where p.polrelid in ('public.profiles'::regclass, 'public.organization_roles'::regclass, 'public.organization_members'::regclass)
                           or p.polrelid = to_regclass('public.church_members') or p.polrelid = to_regclass('public.ministry_events') or p.polrelid = to_regclass('public.daily_words')
                           or p.polrelid = to_regclass('public.ministry_care_cases') or p.polrelid = to_regclass('public.bible_programs')) is distinct from v_pre->'policies' then
    raise exception 'rollback postcondition failed: a policy of an existing table changed';
  end if;
  if (select jsonb_object_agg(f.proname, md5(pg_get_functiondef(f.oid)))
        from pg_proc f where f.pronamespace = 'public'::regnamespace
         and (f.proname like 'church\_%' or f.proname like 'team\_church\_%' or f.proname like 'daily\_word%' or f.proname like 'bible\_%'
              or (f.proname like 'ministry\_%' and f.proname not like 'ministry\_testimon%')
              or f.proname in ('is_admin', 'has_org_permission', 'is_org_member', 'is_church_profile'))) is distinct from v_pre->'fn_defs' then
    raise exception 'rollback postcondition failed: an existing function changed';
  end if;
end $$;

commit;
