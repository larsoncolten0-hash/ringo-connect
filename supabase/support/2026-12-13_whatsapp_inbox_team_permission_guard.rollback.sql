-- ROLLBACK for 2026-12-13_whatsapp_inbox_team_permission_guard.sql — FOR OWNER REVIEW; do not run unless rolling back.
--
-- Drops the three triggers and the helper functions. Touches no table, row, role, membership or invitation. After a rollback a `staff.manage` holder
-- can again write `inbox.*` onto roles/memberships/invitations directly (the original, pre-existing Team behaviour). Safe to re-run (IF EXISTS).
-- If 2026-12-14_whatsapp_inbox_staff.sql has been applied, roll that back FIRST (staff Inbox access must not exist without this guard).
begin;

drop trigger if exists organization_roles_inbox_guard_trg on public.organization_roles;
drop trigger if exists organization_members_inbox_guard_trg on public.organization_members;
drop trigger if exists organization_invitations_inbox_guard_trg on public.organization_invitations;

drop function if exists public.organization_roles_inbox_guard();
drop function if exists public.organization_members_inbox_guard();
drop function if exists public.organization_invitations_inbox_guard();
drop function if exists public.team_inbox_grant_allowed(uuid);
drop function if exists public.team_role_has_inbox(uuid);
drop function if exists public.team_inbox_permissions(text[]);
drop function if exists public.team_is_inbox_permission(text);

commit;
