-- Ringo Ambassador Program — fix RLS policy recursion (Postgres 42P17). NOT YET RUN.
--
-- SYMPTOM (found by post-migration verification): any policy-checked SELECT on
-- ambassador_teams, ambassador_profiles, ambassador_sales or
-- ambassador_commission_ledger fails with
--   "infinite recursion detected in policy for relation ..."  (HTTP 500).
--
-- CAUSE (2026-11-18_ambassador_foundation.sql): the two read policies refer to
-- each other's table, and each subquery is itself subject to that table's RLS:
--   ambassador_teams    policy -> selects from ambassador_profiles -> its policy
--   ambassador_profiles policy -> selects from ambassador_teams    -> its policy  (cycle)
-- The sales and ledger policies read profiles/teams under RLS, so they fail too.
--
-- FIX — the smallest change that breaks the cycle and nothing else:
--   * two tiny SECURITY DEFINER helpers that answer ONE question about THE
--     CALLER (auth.uid()) and take no user argument, so they read the two tables
--     without re-entering their policies;
--   * replace ONLY the two recursive policies, keeping their names and their
--     exact access rules. The sales and ledger policies are NOT touched: once
--     teams/profiles no longer recurse, they evaluate finitely, with the same
--     meaning as before.
--
-- ACCESS RULES PRESERVED EXACTLY
--   ambassador_teams     visible to: the team's leader, an admin, or an Ambassador
--                        who belongs to that team.                     (unchanged)
--   ambassador_profiles  visible to: the profile's owner, an admin, or the leader
--                        of the team the profile belongs to.           (unchanged)
--
-- PRIVACY: nothing here reads or exposes payout destinations. That data lives in
-- ambassador_payout_destinations (no policy, no grants) and ambassador_payouts
-- (admin-only read) — neither is touched. ambassador_profiles no longer even has
-- payout columns (dropped in 2026-11-25).
--
-- Does not edit any earlier migration. Depends on: 2026-11-18 (both tables and
-- the policies being replaced), is_admin() (existing).

begin;

-- ============================================================================
-- 1. HELPERS — SECURITY DEFINER so they read the tables without triggering
--    their own RLS (that is what breaks the cycle). Each one:
--      * takes only a team id — the person is ALWAYS auth.uid() (the caller's
--        own verified session identity), never a parameter, so it cannot be
--        used to ask about anyone else;
--      * returns only a boolean about the caller's own relationship to that team
--        — information the caller already has;
--      * selects no column other than the existence test, so it cannot leak data;
--      * pins search_path to empty and schema-qualifies every object, so a
--        malicious object earlier in a search path cannot be substituted.
-- ============================================================================
create or replace function public.ambassador_is_member_of_team(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.ambassador_profiles p
    where p.user_id = auth.uid() and p.team_id = p_team_id
  );
$$;

create or replace function public.ambassador_leads_team(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.ambassador_teams t
    where t.id = p_team_id and t.team_leader_user_id = auth.uid()
  );
$$;

-- Callable by the roles whose queries evaluate the policies (a policy runs its
-- functions with the querying role's privileges). NOT public. anon is included
-- only so an anonymous read still returns zero rows instead of a permission
-- error; for anon auth.uid() is null, so both helpers return false.
revoke all on function public.ambassador_is_member_of_team(uuid) from public;
revoke all on function public.ambassador_leads_team(uuid) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'grant execute on function public.ambassador_is_member_of_team(uuid) to anon';
    execute 'grant execute on function public.ambassador_leads_team(uuid) to anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.ambassador_is_member_of_team(uuid) to authenticated';
    execute 'grant execute on function public.ambassador_leads_team(uuid) to authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.ambassador_is_member_of_team(uuid) to service_role';
    execute 'grant execute on function public.ambassador_leads_team(uuid) to service_role';
  end if;
end $$;

-- ============================================================================
-- 2. REPLACE ONLY THE TWO RECURSIVE POLICIES (same names, same rules, no cycle).
--    Both run inside this transaction: there is no window in which the tables
--    lack a policy (and with RLS on and no policy they would deny everyone).
-- ============================================================================
drop policy if exists "ambassador_teams own or admin read" on public.ambassador_teams;
create policy "ambassador_teams own or admin read" on public.ambassador_teams for select using (
  team_leader_user_id = auth.uid()
  or is_admin()
  or public.ambassador_is_member_of_team(id)
);

drop policy if exists "ambassador_profiles own or admin read" on public.ambassador_profiles;
create policy "ambassador_profiles own or admin read" on public.ambassador_profiles for select using (
  user_id = auth.uid()
  or is_admin()
  or public.ambassador_leads_team(team_id)
);

commit;
