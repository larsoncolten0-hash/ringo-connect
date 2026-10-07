// The EXACT files the Phase 3 database / data security audit adds: the database-level private-file-path ownership guard (UN-APPLIED migration that
// REQUIRES OWNER APPROVAL), its rollback / read-only verify script, and its tests. No application code, API route, payment, auth, RLS policy or
// existing migration is changed. Same convention as phase16Files.mjs / phase17Files.mjs: explicit, no wildcards.
export const PHASE18_FILES = new Set([
  "scripts/tests/phase18Files.mjs",
  "scripts/tests/securityPhase3.test.mjs",
  "scripts/tests/ownerWorkspaceFiles.mjs",
  "scripts/tests/receivables.test.mjs",
  "scripts/tests/shopReceiptPdf.test.mjs",
  "supabase/migrations/2026-10-07b_private_file_path_ownership_guard.sql",
  "supabase/support/2026-10-07b_private_file_path_ownership_guard.rollback.sql",
  "supabase/support/2026-10-07b_private_file_path_ownership_guard.verify.sql",
  "supabase/support/tests/private_file_path.adversarial.mjs",
]);

// Older guards that require "any new migration is dated AFTER the latest existing one" exempt exactly this path (and nothing else).
export const PHASE18_MIGRATIONS = new Set(["supabase/migrations/2026-10-07b_private_file_path_ownership_guard.sql"]);
export const isPhase18Migration = (f) => PHASE18_MIGRATIONS.has(String(f).replace(/\\/g, "/"));
