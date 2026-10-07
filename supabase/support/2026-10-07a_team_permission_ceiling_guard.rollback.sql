-- ============================================================================
-- ROLLBACK for supabase/migrations/2026-10-07a_team_permission_ceiling_guard.sql
-- Removes ONLY the three triggers and the four functions this migration added. No row, policy, grant or other function is touched, so the team tables
-- return to their previous behaviour (INCLUDING the weakness the guard closes: a staff member could grant themselves permissions they do not hold by
-- writing directly to the tables). The Inbox guard (2026-12-13) is not affected.
-- ============================================================================
begin;
drop trigger if exists organization_roles_ceiling_guard_trg on public.organization_roles;
drop trigger if exists organization_members_ceiling_guard_trg on public.organization_members;
drop trigger if exists organization_invitations_ceiling_guard_trg on public.organization_invitations;
drop function if exists public.organization_roles_ceiling_guard();
drop function if exists public.organization_members_ceiling_guard();
drop function if exists public.organization_invitations_ceiling_guard();
drop function if exists public.team_permissions_not_held(uuid, text[]);
commit;
