// The EXACT files the Phase 2 authentication / authorization audit adds: the database-level team "permission ceiling" guard (UN-APPLIED
// migration that REQUIRES OWNER APPROVAL), its rollback / read-only verify script, and its tests. No application code, API route, payment,
// auth, RLS policy or existing migration is changed. Same convention as phase16Files.mjs: explicit, no wildcards.
export const PHASE17_FILES = new Set([
  "scripts/tests/phase17Files.mjs",
  "scripts/tests/securityPhase2.test.mjs",
  "scripts/tests/ownerWorkspaceFiles.mjs",
  "scripts/tests/receivables.test.mjs",
  "scripts/tests/shopReceiptPdf.test.mjs",
  "supabase/migrations/2026-10-07a_team_permission_ceiling_guard.sql",
  "supabase/support/2026-10-07a_team_permission_ceiling_guard.rollback.sql",
  "supabase/support/2026-10-07a_team_permission_ceiling_guard.verify.sql",
  "supabase/support/tests/team_permission_ceiling.adversarial.mjs",
]);

// Older guards that require "any new migration is dated AFTER the latest existing one" exempt exactly this path (and nothing else).
export const PHASE17_MIGRATIONS = new Set(["supabase/migrations/2026-10-07a_team_permission_ceiling_guard.sql"]);
export const isPhase17Migration = (f) => PHASE17_MIGRATIONS.has(String(f).replace(/\\/g, "/"));
