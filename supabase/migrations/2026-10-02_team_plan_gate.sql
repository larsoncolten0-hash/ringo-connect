-- Personal vs Enterprise gating for Team & Organization Management.
--
-- Reuses the existing plan-feature-flag pattern (pixels_enabled,
-- custom_theme_enabled, full_analytics_enabled, badge_removed on `plans`
-- — see supabase/schema.sql and src/components/admin/PlansManager.tsx)
-- rather than inventing a parallel "account type" concept or hardcoding
-- `plan.name === 'business'` checks throughout the app. Team Management is
-- just another plan-gated feature: which plan(s) unlock it is an
-- admin-editable column, exactly like every other one.
--
-- Gates WHO CAN USE Team Management (invite, manage roles/permissions, see
-- the roster) — it does not touch, and is never checked by, the
-- category-level RLS added in 2026-10-01_team_management.sql (Restaurant's
-- kitchen.view/orders.update/etc.). An already-active team member's
-- day-to-day category access is unaffected by this migration; only the
-- Team *management* surface (src/lib/team/access.ts's
-- requireOrgAccess/requireOrgAccessJson, which every /api/team/* route and
-- the /dashboard/team pages go through) checks it.
alter table plans add column if not exists team_enabled boolean not null default false;

-- Seeds the sensible default (today's top "business" tier unlocks Team) —
-- admin-editable afterwards from /admin/plans, same as every other flag.
-- Guarded so this never clobbers an admin's own later choice if this
-- migration is ever re-applied.
update plans set team_enabled = true where name = 'business' and team_enabled = false;
