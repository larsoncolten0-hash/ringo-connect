// The EXACT files Ringo Watchdog V1 changes or adds: the rule engine, the incident table (UN-APPLIED migration that REQUIRES OWNER APPROVAL), the owner feed and its
// acknowledge route, the WD-005 intake route, the audit hook, the four team-permission escalation audit calls, bilingual alert text, and the tests. No payment / payout calculation,
// no Fapshi call, no authentication or authorization decision and no existing RLS policy changes. Same convention as phase16Files.mjs: explicit, no wildcards.
export const PHASE23_FILES = new Set([
  "scripts/security-suite.mjs",
  "scripts/tests/ownerWorkspaceFiles.mjs",
  "scripts/tests/phase16Files.mjs",
  "scripts/tests/phase23Files.mjs",
  "scripts/tests/receivables.test.mjs",
  "scripts/tests/whatsappSecurityAudit.test.mjs",
  "scripts/tests/securityPhase7.test.mjs",
  "scripts/tests/shopReceiptPdf.test.mjs",
  "scripts/tests/watchdog.test.mjs",
  "src/app/admin/watchdog/page.tsx",
  "src/app/api/admin/watchdog/[id]/route.ts",
  "src/app/api/team/invitations/route.ts",
  "src/app/api/team/members/[id]/route.ts",
  "src/app/api/team/roles/[id]/route.ts",
  "src/app/api/team/roles/route.ts",
  "src/app/api/watchdog/security-suite/route.ts",
  "src/components/admin/AdminShell.tsx",
  "src/components/admin/AdminWatchdogView.tsx",
  "src/lib/adminAudit.ts",
  "src/lib/i18n/translations.ts",
  "src/lib/watchdog/alerts.ts",
  "src/lib/watchdog/index.ts",
  "src/lib/watchdog/rules.ts",
  "supabase/migrations/2026-10-07d_watchdog_events.sql",
  "supabase/support/2026-10-07d_watchdog_events.rollback.sql",
  "supabase/support/2026-10-07d_watchdog_events.verify.sql",
  "supabase/support/tests/watchdog.adversarial.mjs",
]);

// The files of this phase that sit inside an area an OLDER scope guard protects (admin, team, payouts, payments): exempted by exact path, never by directory.
export const PHASE23_PROTECTED_FILES = new Set([
  "src/app/admin/watchdog/page.tsx",
  "src/app/api/admin/watchdog/[id]/route.ts",
  "src/app/api/team/invitations/route.ts",
  "src/app/api/team/members/[id]/route.ts",
  "src/app/api/team/roles/[id]/route.ts",
  "src/app/api/team/roles/route.ts",
  "src/app/api/watchdog/security-suite/route.ts",
  "src/components/admin/AdminShell.tsx",
  "src/components/admin/AdminWatchdogView.tsx",
  "src/lib/adminAudit.ts",
  "src/lib/i18n/translations.ts",
  "src/lib/watchdog/alerts.ts",
  "src/lib/watchdog/index.ts",
  "src/lib/watchdog/rules.ts",
]);
export const isPhase23ProtectedFile = (f) => PHASE23_PROTECTED_FILES.has(String(f).replace(/\\/g, "/"));

// Older guards that require "any new migration is dated AFTER the latest existing one" exempt exactly this path (and nothing else).
export const PHASE23_MIGRATIONS = new Set(["supabase/migrations/2026-10-07d_watchdog_events.sql"]);
export const isPhase23Migration = (f) => PHASE23_MIGRATIONS.has(String(f).replace(/\\/g, "/"));
