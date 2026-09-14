-- Bug fix found while running the full Team/Enterprise scenario test suite:
-- a custom role holding staff.manage but NOT staff.view could not actually
-- manage members at all. PATCH /api/team/members/[id] (and the
-- "organization_members write" UPDATE policy) require the caller to first
-- SELECT the target row, and "organization_members read" only granted
-- select access to staff.view holders (or the row's own user) — so a
-- staff.manage-only role's every read came back empty via RLS, and every
-- PATCH attempt 404'd ("Member not found") even though the caller was
-- correctly authorized to manage staff.
--
-- The default role templates (src/lib/team/permissions.ts) always pair
-- staff.manage with staff.view, which is why this never surfaced through
-- them — it only appears for a custom role an owner builds by hand and
-- unchecks staff.view while keeping staff.manage (RolesPanel.tsx makes
-- that a perfectly reachable combination). Fixed at its root: staff.manage
-- now implies read access to the roster, matching what
-- src/app/api/team/members/[id]/route.ts already assumes.
--
-- Purely additive — drops and recreates the one named policy this concerns
-- (owned by 2026-10-01_team_management.sql), touches zero rows.
drop policy if exists "organization_members read" on organization_members;
create policy "organization_members read" on organization_members for select using (
  has_org_permission(profile_id, 'staff.view') or has_org_permission(profile_id, 'staff.manage') or user_id = auth.uid()
);
