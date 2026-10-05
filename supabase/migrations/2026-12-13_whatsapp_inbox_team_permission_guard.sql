-- WhatsApp Inbox staff roles — STEP 1: owner-only control of `inbox.*` permissions on the Team tables.  PROPOSED, NOT APPLIED. FOR OWNER REVIEW ONLY.
--
-- WHY: the Team RLS (2026-10-01 / 2026-10-03) lets ANY member holding `staff.manage` write organization_roles and organization_members directly
-- (the API routes' "you can't grant what you don't hold" and "you can't edit your own membership" checks are not a database boundary). So a manager
-- could rewrite a role, or move themselves onto a role, through the Supabase client. For `inbox.*` that is not acceptable: only the organization's
-- OWNER may grant or revoke Inbox access (it exposes customer conversations and phone numbers and lets a person send WhatsApp messages).
--
-- WHAT: three BEFORE INSERT/UPDATE triggers (plus small helper functions). They reject, with SQLSTATE 42501 ('inbox_permission_owner_only'), any
-- change by a non-owner that involves an `inbox.*` permission:
--   organization_roles        a role gains, loses or changes its `inbox.*` permissions (insert / update), or a role holding them changes organization
--   organization_members      a member is inserted onto, moved onto, moved away from, or REACTIVATED into a role that holds `inbox.*`
--                             (also: a membership row that holds such a role changes organization or person)
--   organization_invitations  an invitation is created for a role that holds `inbox.*`, its role is changed to/from one, or it is otherwise modified
--                             (token / expiry / invitee ...). REVOKING (status -> revoked / cancelled / expired) stays allowed to managers.
-- Who passes: the organization's owner (profiles.user_id = auth.uid() for THE ROLE'S / MEMBER'S / INVITATION'S OWN profile, never a value from the
-- request) — and NOBODY else: a platform admin who is not the owner is refused, exactly like a manager — and trusted server-side callers that carry no end-user identity
-- (service role / direct database access: auth.uid() is null) — e.g. the invitation-accept route that creates the membership after verifying the token.
--
-- DELIBERATELY NOT CHANGED: every other Team rule. A manager can still invite, change roles, activate/deactivate/remove members and edit roles that do
-- not involve `inbox.*`, exactly as before; they can still DEACTIVATE or REMOVE a member who holds an Inbox role (that only takes access away).
-- This migration does NOT fix the separate, pre-existing ability of a `staff.manage` holder to escalate OTHER permissions (e.g. payments.view); that is
-- reported separately.
--
-- Additive: new functions and three triggers only. No table, column, policy or row is created, altered or removed. No Inbox function is touched.
-- Rollback: supabase/support/2026-12-13_whatsapp_inbox_team_permission_guard.rollback.sql

begin;

-- 'inbox.view', 'Inbox.Reply', ' inbox.ai ' ... (anything the permission check could ever be asked about under the inbox namespace)
create or replace function public.team_is_inbox_permission(p_permission text)
returns boolean
language sql
immutable
as $$
  select lower(btrim(coalesce(p_permission, ''))) like 'inbox.%'
$$;

-- The distinct, normalised `inbox.*` subset of a permission list (sorted, so two lists can be compared with IS DISTINCT FROM).
create or replace function public.team_inbox_permissions(p_permissions text[])
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(distinct lower(btrim(x)) order by lower(btrim(x))), '{}'::text[])
    from unnest(coalesce(p_permissions, '{}'::text[])) as x
   where public.team_is_inbox_permission(x)
$$;

-- Does this role grant any `inbox.*` permission?  (false for a missing role)
create or replace function public.team_role_has_inbox(p_role_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.organization_roles r
     where r.id = p_role_id and cardinality(public.team_inbox_permissions(r.permissions)) > 0
  )
$$;

-- May the CURRENT caller change Inbox access for this organization?  The organization is the profile stored on the row being written.
create or replace function public.team_inbox_grant_allowed(p_profile_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  -- Trusted server-side callers (service role, direct database access) carry no end-user identity.
  if auth.uid() is null then return true; end if;
  if p_profile_id is null then return false; end if;
  -- The owner ONLY: profiles.user_id of the organization's own profile. Platform-admin status is deliberately NOT an alternative for inbox.* permissions.
  return exists (select 1 from public.profiles p where p.id = p_profile_id and p.user_id = auth.uid());
end;
$$;

create or replace function public.organization_roles_inbox_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_new text[] := public.team_inbox_permissions(new.permissions);
  v_old text[];
begin
  if tg_op = 'INSERT' then
    if cardinality(v_new) > 0 and not public.team_inbox_grant_allowed(new.profile_id) then
      raise exception 'inbox_permission_owner_only' using errcode = '42501';
    end if;
    return new;
  end if;

  v_old := public.team_inbox_permissions(old.permissions);
  if v_old is distinct from v_new and not public.team_inbox_grant_allowed(new.profile_id) then
    raise exception 'inbox_permission_owner_only' using errcode = '42501';
  end if;
  if new.profile_id is distinct from old.profile_id and (cardinality(v_old) > 0 or cardinality(v_new) > 0)
     and not (public.team_inbox_grant_allowed(old.profile_id) and public.team_inbox_grant_allowed(new.profile_id)) then
    raise exception 'inbox_permission_owner_only' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.organization_members_inbox_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old boolean;
  v_new boolean := public.team_role_has_inbox(new.role_id);
begin
  if tg_op = 'INSERT' then
    if v_new and not public.team_inbox_grant_allowed(new.profile_id) then
      raise exception 'inbox_permission_owner_only' using errcode = '42501';
    end if;
    return new;
  end if;

  v_old := public.team_role_has_inbox(old.role_id);
  -- moving onto / away from an Inbox role, or moving an Inbox-holding membership to another organization or person
  if (v_old or v_new)
     and (new.role_id is distinct from old.role_id or new.profile_id is distinct from old.profile_id or new.user_id is distinct from old.user_id)
     and not (public.team_inbox_grant_allowed(old.profile_id) and public.team_inbox_grant_allowed(new.profile_id)) then
    raise exception 'inbox_permission_owner_only' using errcode = '42501';
  end if;
  -- reactivating a member whose role holds Inbox permissions (a manager may still deactivate or remove them)
  if v_new and old.status is distinct from 'active' and new.status = 'active' and not public.team_inbox_grant_allowed(new.profile_id) then
    raise exception 'inbox_permission_owner_only' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.organization_invitations_inbox_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old boolean;
  v_new boolean := public.team_role_has_inbox(new.role_id);
begin
  if tg_op = 'INSERT' then
    if v_new and not public.team_inbox_grant_allowed(new.profile_id) then
      raise exception 'inbox_permission_owner_only' using errcode = '42501';
    end if;
    return new;
  end if;

  v_old := public.team_role_has_inbox(old.role_id);
  if v_old or v_new then
    -- anything except moving the status to revoked / cancelled / expired counts as modifying an Inbox invitation
    if ((to_jsonb(new) - 'status' - 'updated_at') is distinct from (to_jsonb(old) - 'status' - 'updated_at')
        or (new.status is distinct from old.status and new.status not in ('revoked', 'cancelled', 'expired')))
       and not (public.team_inbox_grant_allowed(old.profile_id) and public.team_inbox_grant_allowed(new.profile_id)) then
      raise exception 'inbox_permission_owner_only' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists organization_roles_inbox_guard_trg on public.organization_roles;
create trigger organization_roles_inbox_guard_trg before insert or update on public.organization_roles
  for each row execute function public.organization_roles_inbox_guard();
drop trigger if exists organization_members_inbox_guard_trg on public.organization_members;
create trigger organization_members_inbox_guard_trg before insert or update on public.organization_members
  for each row execute function public.organization_members_inbox_guard();
drop trigger if exists organization_invitations_inbox_guard_trg on public.organization_invitations;
create trigger organization_invitations_inbox_guard_trg before insert or update on public.organization_invitations
  for each row execute function public.organization_invitations_inbox_guard();

do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('team_is_inbox_permission', 'team_inbox_permissions', 'team_role_has_inbox', 'team_inbox_grant_allowed',
                                                         'organization_roles_inbox_guard', 'organization_members_inbox_guard', 'organization_invitations_inbox_guard')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;

commit;
