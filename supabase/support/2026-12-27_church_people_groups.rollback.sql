-- ROLLBACK for 2026-12-27_church_people_groups.sql — FOR OWNER REVIEW; do not run unless rolling back.
--
-- Removes exactly what that migration created: the three Team grant-guard triggers, the four church tables (their policies, indexes, constraints and triggers go with them) and the
-- church_* / team_church_* functions. It touches no existing table, row, policy, trigger or function, and it proves that at the end.
--
-- DATA SAFETY: the church tables hold personal data (and possibly children's records). This file REFUSES to run while any church row exists. To drop them anyway, you must first export
-- what you need and then confirm the loss explicitly by adding this line as the FIRST statement inside the transaction (same script, same transaction):
--     select set_config('church_people.allow_data_loss', 'yes', true);
-- Dropping the tables is irreversible; there is no soft rollback. Safe to re-run: every drop is "if exists".
begin;

set local lock_timeout = '5s';

do $$
declare
  v_rows bigint := 0;
  t text;
  v_n bigint;
  v_bad text;
  v_marker constant text := 'managed by 2026-12-27_church_people_groups.sql';
begin
  -- Never drop anything that is not provably this migration's own: every table, function and Team trigger it created carries the marker comment.
  select string_agg(x, ', ') into v_bad from unnest(array['church_members', 'church_groups', 'church_group_members', 'church_leadership']) x
   where to_regclass('public.' || x) is not null and coalesce(obj_description(to_regclass('public.' || x), 'pg_class'), '') <> v_marker;
  if v_bad is not null then raise exception 'rollback refused: table(s) % exist but are not managed by this migration', v_bad; end if;
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad from pg_proc p
   where p.pronamespace = 'public'::regnamespace and coalesce(obj_description(p.oid, 'pg_proc'), '') <> v_marker
     and p.oid::regprocedure::text = any (array['church_is_owner(uuid)', 'church_has_permission(uuid,text)', 'is_church_profile(uuid)', 'church_is_group_leader(uuid)', 'church_is_group_member(uuid)',
       'church_member_in_led_group(uuid)', 'church_member_is_me(uuid)', 'church_tenant_guard()', 'church_members_guard()', 'church_group_members_guard()', 'church_leadership_guard()',
       'church_members_age_sync()', 'church_groups_delete_guard()', 'team_church_permissions(text[])', 'team_church_permission_tier(text)', 'team_church_change_denied(uuid,text[],text[])', 'team_role_church_permissions(uuid)',
       'organization_roles_church_guard()', 'organization_members_church_guard()', 'organization_invitations_church_guard()']);
  if v_bad is not null then raise exception 'rollback refused: function(s) % exist but are not managed by this migration', v_bad; end if;
  select string_agg(g.tgname, ', ') into v_bad from pg_trigger g
   where not g.tgisinternal and g.tgname in ('organization_roles_church_guard_trg', 'organization_members_church_guard_trg', 'organization_invitations_church_guard_trg')
     and coalesce(obj_description(g.oid, 'pg_trigger'), '') <> v_marker;
  if v_bad is not null then raise exception 'rollback refused: trigger(s) % exist but are not managed by this migration', v_bad; end if;

  foreach t in array array['church_members', 'church_groups', 'church_group_members', 'church_leadership'] loop
    if to_regclass('public.' || t) is not null then
      execute format('select count(*) from public.%I', t) into v_n;
      v_rows := v_rows + v_n;
    end if;
  end loop;
  if v_rows > 0 and coalesce(current_setting('church_people.allow_data_loss', true), '') <> 'yes' then
    raise exception 'rollback refused: the church tables hold % row(s) of personal data. Export what you need, then confirm the loss with: select set_config(''church_people.allow_data_loss'', ''yes'', true);', v_rows;
  end if;

  perform set_config('church_people.pre', jsonb_build_object(
    'org_roles',    (select count(*) from public.organization_roles),
    'org_members',  (select count(*) from public.organization_members),
    'org_invites',  (select count(*) from public.organization_invitations),
    'profiles',     (select count(*) from public.profiles),
    'org_policies', (select coalesce(jsonb_agg(p.polname order by p.polrelid::regclass::text, p.polname), '[]'::jsonb)
                       from pg_policy p where p.polrelid in ('public.organization_roles'::regclass, 'public.organization_members'::regclass, 'public.organization_invitations'::regclass, 'public.profiles'::regclass)),
    'org_triggers', (select coalesce(jsonb_agg(g.tgrelid::regclass::text || '.' || g.tgname order by g.tgrelid::regclass::text, g.tgname), '[]'::jsonb)
                       from pg_trigger g where not g.tgisinternal and g.tgrelid in ('public.organization_roles'::regclass, 'public.organization_members'::regclass, 'public.organization_invitations'::regclass)
                        and g.tgname not in ('organization_roles_church_guard_trg', 'organization_members_church_guard_trg', 'organization_invitations_church_guard_trg')),
    'fn_defs',      (select jsonb_object_agg(f.proname, md5(pg_get_functiondef(f.oid)))
                       from pg_proc f where f.pronamespace = 'public'::regnamespace and f.proname in ('is_admin', 'has_org_permission', 'is_org_member'))
  )::text, true);
end $$;

drop trigger if exists organization_roles_church_guard_trg on public.organization_roles;
drop trigger if exists organization_members_church_guard_trg on public.organization_members;
drop trigger if exists organization_invitations_church_guard_trg on public.organization_invitations;

drop table if exists public.church_group_members;
drop table if exists public.church_leadership;
drop table if exists public.church_groups;
drop table if exists public.church_members;

drop function if exists public.organization_roles_church_guard();
drop function if exists public.organization_members_church_guard();
drop function if exists public.organization_invitations_church_guard();
drop function if exists public.team_church_change_denied(uuid, text[], text[]);
drop function if exists public.team_role_church_permissions(uuid);
drop function if exists public.team_church_permission_tier(text);
drop function if exists public.team_church_permissions(text[]);
drop function if exists public.church_members_age_sync();
drop function if exists public.church_groups_delete_guard();
drop function if exists public.church_tenant_guard();
drop function if exists public.church_members_guard();
drop function if exists public.church_group_members_guard();
drop function if exists public.church_leadership_guard();
drop function if exists public.church_member_is_me(uuid);
drop function if exists public.church_member_in_led_group(uuid);
drop function if exists public.church_is_group_member(uuid);
drop function if exists public.church_is_group_leader(uuid);
drop function if exists public.is_church_profile(uuid);
drop function if exists public.church_has_permission(uuid, text);
drop function if exists public.church_is_owner(uuid);

-- Postconditions: everything this file removes is gone, and everything it must not touch is exactly as before.
do $$
declare
  v_pre jsonb := current_setting('church_people.pre', true)::jsonb;
  v_bad text;
begin
  select string_agg(t, ', ') into v_bad from unnest(array['church_members', 'church_groups', 'church_group_members', 'church_leadership']) t where to_regclass('public.' || t) is not null;
  if v_bad is not null then raise exception 'rollback postcondition failed: table still exists: %', v_bad; end if;
  select string_agg(proname, ', ') into v_bad from pg_proc
   where pronamespace = 'public'::regnamespace and (proname like 'church\_%' or proname like 'team\_church\_%' or proname = 'is_church_profile' or proname like 'organization\_%\_church\_guard');
  if v_bad is not null then raise exception 'rollback postcondition failed: function still exists: %', v_bad; end if;
  if exists (select 1 from pg_trigger where not tgisinternal and tgname like 'organization\_%\_church\_guard\_trg') then raise exception 'rollback postcondition failed: a Team guard trigger remains'; end if;
  if (select count(*) from public.organization_roles) <> (v_pre->>'org_roles')::bigint or (select count(*) from public.organization_members) <> (v_pre->>'org_members')::bigint
     or (select count(*) from public.organization_invitations) <> (v_pre->>'org_invites')::bigint or (select count(*) from public.profiles) <> (v_pre->>'profiles')::bigint then
    raise exception 'rollback postcondition failed: a row count of an existing table changed';
  end if;
  if (select coalesce(jsonb_agg(p.polname order by p.polrelid::regclass::text, p.polname), '[]'::jsonb)
        from pg_policy p where p.polrelid in ('public.organization_roles'::regclass, 'public.organization_members'::regclass, 'public.organization_invitations'::regclass, 'public.profiles'::regclass)) is distinct from v_pre->'org_policies' then
    raise exception 'rollback postcondition failed: the policies on the Team tables or profiles changed';
  end if;
  select string_agg(x, ', ') into v_bad from jsonb_array_elements_text(v_pre->'org_triggers') x
   where not exists (select 1 from pg_trigger g where g.tgrelid::regclass::text || '.' || g.tgname = x and g.tgenabled = 'O' and not g.tgisinternal);
  if v_bad is not null then raise exception 'rollback postcondition failed: an existing trigger is missing or disabled: %', v_bad; end if;
  if (select jsonb_object_agg(f.proname, md5(pg_get_functiondef(f.oid))) from pg_proc f where f.pronamespace = 'public'::regnamespace and f.proname in ('is_admin', 'has_org_permission', 'is_org_member'))
       is distinct from v_pre->'fn_defs' then
    raise exception 'rollback postcondition failed: is_admin / has_org_permission / is_org_member changed';
  end if;
end $$;

commit;
