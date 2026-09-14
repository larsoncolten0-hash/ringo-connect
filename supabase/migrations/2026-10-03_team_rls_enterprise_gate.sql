-- Closes a gap left by 2026-10-02_team_plan_gate.sql: that migration only
-- taught the APPLICATION layer (src/lib/team/access.ts's
-- requireOrgAccess/requireOrgAccessJson, which every /api/team/* route and
-- the /dashboard/team pages go through) that Team Management requires an
-- Enterprise-tier ("business") plan. It never touched the database, which
-- means a Personal-plan owner could still bypass the paywall entirely by
-- calling Supabase directly (their own session already passes
-- has_org_permission() for their own profile, regardless of plan) — this
-- migration is the actual security boundary IN THE DATABASE, per "use
-- server-side authorization and RLS, do not rely on frontend checks."
--
-- Deliberately scoped to only the WRITE policies on the three Team-specific
-- tables (creating/editing roles, changing a member's role/status,
-- creating an invitation) — never the READ policies (an owner who
-- downgraded should still be able to see their existing team, just not
-- grow or reconfigure it), and never anything on `profiles` or any
-- Restaurant & Food table from 2026-10-01_team_management.sql: an already-
-- active team member's day-to-day category access (kitchen.view,
-- orders.update, ...) is a separate concern from whether the
-- organization's OWNER can currently use the Team Management *engine*, and
-- is left completely alone here, exactly as instructed.
--
-- This only DROPs and recreates the exact 3 named policies it lists below
-- (all owned by 2026-10-01_team_management.sql, none from any other
-- migration) — RLS policies are not data, so this touches zero rows and
-- is fully reversible by re-running that migration's original CREATE
-- POLICY statements.

-- Mirrors src/lib/team/access.ts's getOrgTeamEnabled() exactly — kept as
-- an independent SQL implementation (not a wrapper around anything
-- client-supplied) for the same reason has_org_permission() is: it must
-- be trustworthy from inside RLS itself, re-derived from the database on
-- every check.
create or replace function org_team_enabled(p_profile_id uuid) returns boolean
language sql security definer stable as $$
  select coalesce(
    (
      select pl.team_enabled
      from profiles p
      join public.users u on u.id = p.user_id
      join plans pl on pl.id = u.plan_id
      where p.id = p_profile_id
    ),
    false
  );
$$;

drop policy if exists "organization_roles write" on organization_roles;
create policy "organization_roles write" on organization_roles for all using (
  has_org_permission(profile_id, 'staff.manage') and org_team_enabled(profile_id)
) with check (
  has_org_permission(profile_id, 'staff.manage') and org_team_enabled(profile_id)
);

drop policy if exists "organization_members write" on organization_members;
create policy "organization_members write" on organization_members for update using (
  has_org_permission(profile_id, 'staff.manage') and org_team_enabled(profile_id)
) with check (
  has_org_permission(profile_id, 'staff.manage') and org_team_enabled(profile_id)
);

drop policy if exists "organization_invitations insert" on organization_invitations;
create policy "organization_invitations insert" on organization_invitations for insert with check (
  has_org_permission(profile_id, 'staff.invite') and invited_by = auth.uid() and org_team_enabled(profile_id)
);
