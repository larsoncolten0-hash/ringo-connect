-- ============================================================================
-- Ringo Connect - security (Phase 2): enforce the team "permission ceiling" in the DATABASE
--
-- REQUIRES OWNER APPROVAL AND MANUAL APPLICATION. Additive: two functions and three BEFORE INSERT / UPDATE triggers. No policy, grant,
-- column, row or existing function is changed. Roll back with supabase/support/2026-10-07a_team_permission_ceiling_guard.rollback.sql and
-- check it with supabase/support/2026-10-07a_team_permission_ceiling_guard.verify.sql (read-only).
--
-- THE PROBLEM (confirmed from the repository's own policies and routes)
--   The rule "you can't grant permissions you don't have" - the control that stops a staff member from promoting themselves - exists ONLY in four
--   API routes (team/roles POST + PATCH, team/members/[id] PATCH, team/invitations POST). The tables themselves accept any write from a
--   member who holds the broad permission, with no column or value limit:
--     organization_roles       "write"  FOR ALL    using has_org_permission(profile_id, 'staff.manage')
--     organization_members     "write"  FOR UPDATE using has_org_permission(profile_id, 'staff.manage')
--     organization_invitations insert / update       using has_org_permission(profile_id, 'staff.invite')
--   Every signed-in user holds a JWT and can call the Supabase REST API directly, so none of the API checks applies to them:
--     * a staff.manage holder:  PATCH organization_roles  {permissions: [every permission]}  on their own role, or PATCH their own
--       organization_members row onto a stronger role, or swap a member's user_id to a second account;
--     * a staff.invite holder:  INSERT an invitation for the strongest role and accept it with a second account, or UPDATE token_hash on
--       an existing pending invitation (the API "resend" action re-tokens one too, without the ceiling) and accept that.
--   Result: any employee with a partial staff permission can give themselves every staff permission (sales, payments, settings, tickets...).
--   (Owner-only abilities such as billing and payouts are not staff permissions and are not reachable this way.) Only the Inbox permissions
--   were guarded in the database (2026-12-13_whatsapp_inbox_team_permission_guard.sql); this generalises that pattern to every permission.
--
-- THE FIX - the same rule the API states, enforced where it cannot be bypassed
--   For any write by a signed-in end user (auth.uid() is not null; the service role, which the accept route uses, carries no user and is
--   unaffected, exactly as in the Inbox guard):
--     roles        every permission ADDED to a role must be one the caller holds (removing permissions is always allowed); a role can never be moved
--                  to another organization.
--     members      moving a membership onto a role, or onto another person / organization, requires the (organization's own) role's permissions to be
--                  held by the caller. Status-only changes (deactivate, reactivate, remove) are not affected.
--     invitations  creating one, or changing anything on one other than revoking / cancelling / expiring it, requires the invited role's permissions
--                  to be held by the caller. This also closes "resend" for a role the caller could not have invited to.
--   "Holds" means public.has_org_permission(profile, permission), the function the RLS policies already use: it is true for the organization's
--   owner and for platform admins (as the API's own isOwner / isAdmin exemption) and for a member whose active role contains the permission.
--
-- BEHAVIOUR CHANGES a reviewer should know about (all are the API's stated intent, now enforced everywhere):
--   * a manager can no longer "resend" an invitation to a role stronger than their own (the API did not check this; the invitation can be revoked and
--     re-issued by someone who holds those permissions, such as the owner);
--   * the owner and platform admins are unaffected.
-- ============================================================================

-- Which of these permissions does the CURRENT caller NOT hold in this organization? (empty array = holds them all)
create or replace function public.team_permissions_not_held(p_profile_id uuid, p_permissions text[])
returns text[]
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select coalesce(array_agg(p.perm order by p.perm), '{}'::text[])
    from unnest(coalesce(p_permissions, '{}'::text[])) as p(perm)
   where not public.has_org_permission(p_profile_id, p.perm)
$$;

revoke all on function public.team_permissions_not_held(uuid, text[]) from public, anon, authenticated, service_role;

create or replace function public.organization_roles_ceiling_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_added text[];
  v_missing text[];
begin
  if auth.uid() is null then return new; end if; -- the service role / direct database access: no end-user identity
  if tg_op = 'UPDATE' and new.profile_id is distinct from old.profile_id then
    raise exception 'team_permission_ceiling' using errcode = '42501', detail = 'a role cannot be moved to another organization';
  end if;
  if tg_op = 'INSERT' then
    v_added := new.permissions;
  else
    v_added := array(select unnest(new.permissions) except select unnest(old.permissions));
  end if;
  v_missing := public.team_permissions_not_held(new.profile_id, v_added);
  if cardinality(v_missing) > 0 then
    raise exception 'team_permission_ceiling' using errcode = '42501', detail = array_to_string(v_missing, ', ');
  end if;
  return new;
end;
$$;

create or replace function public.organization_members_ceiling_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_perms text[];
  v_missing text[];
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'UPDATE'
     and new.role_id is not distinct from old.role_id
     and new.user_id is not distinct from old.user_id
     and new.profile_id is not distinct from old.profile_id then
    return new; -- status / timestamps only: this takes nothing new and gives nothing new
  end if;
  -- the role must be one of THIS organization's own roles (the API says "Invalid role for this organization")
  select r.permissions into v_perms from public.organization_roles r where r.id = new.role_id and r.profile_id = new.profile_id;
  if not found then
    raise exception 'team_permission_ceiling' using errcode = '42501', detail = 'the role does not belong to this organization';
  end if;
  v_missing := public.team_permissions_not_held(new.profile_id, v_perms);
  if cardinality(v_missing) > 0 then
    raise exception 'team_permission_ceiling' using errcode = '42501', detail = array_to_string(v_missing, ', ');
  end if;
  return new;
end;
$$;

create or replace function public.organization_invitations_ceiling_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_perms text[];
  v_missing text[];
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'UPDATE' then
    if (to_jsonb(new) - 'updated_at') is not distinct from (to_jsonb(old) - 'updated_at') then
      return new; -- nothing but the timestamp changed
    end if;
    if (to_jsonb(new) - 'status' - 'updated_at') is not distinct from (to_jsonb(old) - 'status' - 'updated_at')
       and new.status in ('revoked', 'cancelled', 'expired') then
      return new; -- only taking an invitation away
    end if;
  end if;
  select r.permissions into v_perms from public.organization_roles r where r.id = new.role_id and r.profile_id = new.profile_id;
  if not found then
    raise exception 'team_permission_ceiling' using errcode = '42501', detail = 'the role does not belong to this organization';
  end if;
  v_missing := public.team_permissions_not_held(new.profile_id, v_perms);
  if cardinality(v_missing) > 0 then
    raise exception 'team_permission_ceiling' using errcode = '42501', detail = array_to_string(v_missing, ', ');
  end if;
  return new;
end;
$$;

-- Trigger functions are never called directly: nobody needs EXECUTE on them.
revoke all on function public.organization_roles_ceiling_guard() from public, anon, authenticated, service_role;
revoke all on function public.organization_members_ceiling_guard() from public, anon, authenticated, service_role;
revoke all on function public.organization_invitations_ceiling_guard() from public, anon, authenticated, service_role;

drop trigger if exists organization_roles_ceiling_guard_trg on public.organization_roles;
create trigger organization_roles_ceiling_guard_trg before insert or update on public.organization_roles
  for each row execute function public.organization_roles_ceiling_guard();
drop trigger if exists organization_members_ceiling_guard_trg on public.organization_members;
create trigger organization_members_ceiling_guard_trg before insert or update on public.organization_members
  for each row execute function public.organization_members_ceiling_guard();
drop trigger if exists organization_invitations_ceiling_guard_trg on public.organization_invitations;
create trigger organization_invitations_ceiling_guard_trg before insert or update on public.organization_invitations
  for each row execute function public.organization_invitations_ceiling_guard();

-- Postconditions (structure only: this migration does not write to any live row, so there is nothing to undo).
do $$
declare
  v_bad text;
begin
  select string_agg(t.tgname, ', ') into v_bad
    from (values ('public.organization_roles'::regclass, 'organization_roles_ceiling_guard_trg'),
                 ('public.organization_members'::regclass, 'organization_members_ceiling_guard_trg'),
                 ('public.organization_invitations'::regclass, 'organization_invitations_ceiling_guard_trg')) t(rel, tgname)
   where not exists (select 1 from pg_trigger g where g.tgrelid = t.rel and g.tgname = t.tgname and g.tgenabled = 'O' and not g.tgisinternal);
  if v_bad is not null then
    raise exception 'postcondition failed: trigger missing or disabled: %', v_bad;
  end if;
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('team_permissions_not_held', 'organization_roles_ceiling_guard', 'organization_members_ceiling_guard', 'organization_invitations_ceiling_guard')
     and a.privilege_type = 'EXECUTE' and (a.grantee = 0 or pg_get_userbyid(a.grantee) in ('anon', 'authenticated', 'service_role'));
  if v_bad is not null then
    raise exception 'postcondition failed: an API role can EXECUTE: %', v_bad;
  end if;
end $$;
