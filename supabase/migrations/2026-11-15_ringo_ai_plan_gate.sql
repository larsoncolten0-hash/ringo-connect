-- Plan-based access for Ringo AI (every paid plan, not Free).
--
-- Reuses the existing plan-feature-flag pattern (pixels_enabled,
-- custom_theme_enabled, full_analytics_enabled, badge_removed, team_enabled,
-- commerce_enabled, bookings_feature_enabled on `plans` — see
-- supabase/schema.sql, 2026-10-02_team_plan_gate.sql and
-- src/components/admin/PlansManager.tsx) rather than inventing a parallel
-- concept or hardcoding plan-name checks (e.g. `plan.name === 'free'`) in
-- src/lib/ai/guard.ts. Which plan(s) unlock Ringo AI is an admin-editable
-- column, exactly like every other plan-gated feature — a future paid plan
-- can be granted access from /admin/plans with no code change.
--
-- Gates the baseline plan-eligibility check in resolveAiAccess()
-- (src/lib/ai/guard.ts) — layered alongside, never replacing, every other
-- existing Ringo AI control: the global kill switch, provider configuration,
-- account status, profile ownership, the staff-workspace rule, the
-- demo-account rule, the ai_beta_access allowlist, daily/monthly limits and
-- the global budget. A caller with an ai_beta_access grant remains able to
-- use Ringo AI even on a plan where ai_enabled is false — the beta grant is
-- an explicit override for testing, not something this column changes.
alter table plans add column if not exists ai_enabled boolean not null default false;

-- Seeds today's business rule: every paid plan gets Ringo AI, Free doesn't.
-- Guarded so this never clobbers an admin's own later choice if this
-- migration is ever re-applied; Free needs no statement since the column
-- default (false) already matches the intended state.
update plans set ai_enabled = true where name in ('basic', 'pro', 'business_basic', 'business_pro') and ai_enabled = false;
