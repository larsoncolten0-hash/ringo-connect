// The EXACT files the Phase 6 payments / financial security audit adds: the database-level payout-request concurrency guard (UN-APPLIED migration that REQUIRES OWNER
// APPROVAL), its rollback / read-only verify script, and its tests. No application code, API route, payment or payout function body, RLS policy or existing migration is
// changed. Same convention as phase16Files.mjs: explicit, no wildcards.
export const PHASE21_FILES = new Set([
  "scripts/tests/phase21Files.mjs",
  "scripts/tests/securityPhase6.test.mjs",
  "scripts/tests/ownerWorkspaceFiles.mjs",
  "scripts/tests/receivables.test.mjs",
  "scripts/tests/shopReceiptPdf.test.mjs",
  "supabase/migrations/2026-10-07c_payout_request_concurrency_guard.sql",
  "supabase/support/2026-10-07c_payout_request_concurrency_guard.rollback.sql",
  "supabase/support/2026-10-07c_payout_request_concurrency_guard.verify.sql",
  "supabase/support/tests/payout_concurrency.adversarial.mjs",
]);

// Older guards that require "any new migration is dated AFTER the latest existing one" exempt exactly this path (and nothing else).
export const PHASE21_MIGRATIONS = new Set(["supabase/migrations/2026-10-07c_payout_request_concurrency_guard.sql"]);
export const isPhase21Migration = (f) => PHASE21_MIGRATIONS.has(String(f).replace(/\\/g, "/"));
