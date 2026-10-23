-- ROLLBACK for 2027-01-01_ministry_music_links.sql — FOR OWNER REVIEW; do not run unless rolling back.
--
-- Removes exactly what that migration created: public.ministry_music_links (its policies, indexes, constraints and trigger go with it) and the ministry_music_link_guard() function.
-- It touches no existing table, row, policy, trigger or function (the artist music tables, events, attendance and Phase 2A / 3 / 4 / 5 objects stay exactly as they are), and it proves that at the end.
--
-- DATA SAFETY: the table holds the church's music links. This file REFUSES to run while any row exists. To drop it anyway, first export what you need and then confirm the loss explicitly by
-- adding this line as the FIRST statement inside the transaction (same script, same transaction):
--     select set_config('ministry_music.allow_data_loss', 'yes', true);
-- Dropping a table is irreversible; there is no soft rollback. Safe to re-run: every drop is "if exists".
begin;

set local lock_timeout = '5s';

do $$
declare
  v_marker constant text := 'managed by 2027-01-01_ministry_music_links.sql';
  v_bad text;
  v_rows bigint := 0;
begin
  -- never drop anything that is not provably this migration's own
  if to_regclass('public.ministry_music_links') is not null and coalesce(obj_description(to_regclass('public.ministry_music_links'), 'pg_class'), '') <> v_marker then
    raise exception 'rollback refused: public.ministry_music_links exists but is not managed by this migration';
  end if;
  if to_regclass('public.ministry_music_links') is not null then
    select count(*) into v_rows from public.ministry_music_links;
  end if;
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'ministry_music_link_guard' and coalesce(obj_description(p.oid, 'pg_proc'), '') <> v_marker;
  if v_bad is not null then raise exception 'rollback refused: function(s) % exist but are not managed by this migration', v_bad; end if;

  if v_rows > 0 and coalesce(current_setting('ministry_music.allow_data_loss', true), '') <> 'yes' then
    raise exception 'rollback refused: the table holds % row(s). Export what you need, then confirm the loss with: select set_config(''ministry_music.allow_data_loss'', ''yes'', true);', v_rows;
  end if;

  perform set_config('ministry_music.pre', jsonb_build_object(
    'profiles',  (select count(*) from public.profiles),
    'members',   (select count(*) from public.church_members),
    'policies',  (select coalesce(jsonb_agg(p.polname order by p.polrelid::regclass::text, p.polname), '[]'::jsonb)
                    from pg_policy p where p.polrelid in ('public.profiles'::regclass, 'public.organization_roles'::regclass, 'public.organization_members'::regclass,
                                                           'public.church_members'::regclass, 'public.church_groups'::regclass, 'public.church_group_members'::regclass, 'public.church_leadership'::regclass)
                       or p.polrelid = to_regclass('public.ministry_events') or p.polrelid = to_regclass('public.ministry_announcements') or p.polrelid = to_regclass('public.daily_words')
                       or p.polrelid = to_regclass('public.tracks') or p.polrelid = to_regclass('public.music_releases')),
    'fn_defs',   (select jsonb_object_agg(f.proname, md5(pg_get_functiondef(f.oid)))
                    from pg_proc f where f.pronamespace = 'public'::regnamespace
                     and (f.proname like 'church\_%' or f.proname like 'team\_church\_%' or f.proname like 'daily\_word%' or f.proname like 'bible\_%'
                          or (f.proname like 'ministry\_%' and f.proname <> 'ministry_music_link_guard')
                          or f.proname in ('is_admin', 'has_org_permission', 'is_org_member', 'is_church_profile')))
  )::text, true);
end $$;

drop table if exists public.ministry_music_links;
drop function if exists public.ministry_music_link_guard();

do $$
declare
  v_pre jsonb := current_setting('ministry_music.pre')::jsonb;
begin
  if to_regclass('public.ministry_music_links') is not null then raise exception 'rollback postcondition failed: the table still exists'; end if;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname like 'ministry\_music%') then raise exception 'rollback postcondition failed: a function remains'; end if;
  if (select count(*) from public.profiles) <> (v_pre->>'profiles')::bigint or (select count(*) from public.church_members) <> (v_pre->>'members')::bigint then
    raise exception 'rollback postcondition failed: a row count of an existing table changed';
  end if;
  if (select coalesce(jsonb_agg(p.polname order by p.polrelid::regclass::text, p.polname), '[]'::jsonb)
        from pg_policy p where p.polrelid in ('public.profiles'::regclass, 'public.organization_roles'::regclass, 'public.organization_members'::regclass,
                                               'public.church_members'::regclass, 'public.church_groups'::regclass, 'public.church_group_members'::regclass, 'public.church_leadership'::regclass)
                           or p.polrelid = to_regclass('public.ministry_events') or p.polrelid = to_regclass('public.ministry_announcements') or p.polrelid = to_regclass('public.daily_words')
                           or p.polrelid = to_regclass('public.tracks') or p.polrelid = to_regclass('public.music_releases')) is distinct from v_pre->'policies' then
    raise exception 'rollback postcondition failed: a policy of an existing table changed';
  end if;
  if (select jsonb_object_agg(f.proname, md5(pg_get_functiondef(f.oid)))
        from pg_proc f where f.pronamespace = 'public'::regnamespace
         and (f.proname like 'church\_%' or f.proname like 'team\_church\_%' or f.proname like 'daily\_word%' or f.proname like 'bible\_%' or f.proname like 'ministry\_%'
              or f.proname in ('is_admin', 'has_org_permission', 'is_org_member', 'is_church_profile'))) is distinct from v_pre->'fn_defs' then
    raise exception 'rollback postcondition failed: an existing function changed';
  end if;
end $$;

commit;
