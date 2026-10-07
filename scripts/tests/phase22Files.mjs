// The EXACT files the Phase 7 security testing & observability hardening changes or adds: the security-suite aggregator, PGlite fail-closed wrappers, the payout
// destination / failed-send / refused-request audit events, and the audit rows for the add-on, branding, request-charge and request-reject admin routes. No migration, no
// payment / payout calculation, no Fapshi call, no RLS, no authentication or authorization change. Same convention as phase16Files.mjs: explicit, no wildcards.
export const PHASE22_FILES = new Set([
  "package.json",
  "scripts/security-suite.mjs",
  "scripts/tests/ownerWorkspaceFiles.mjs",
  "scripts/tests/phase16Files.mjs",
  "scripts/tests/phase22Files.mjs",
  "scripts/tests/securityPhase1.test.mjs",
  "scripts/tests/securityPhase2.test.mjs",
  "scripts/tests/securityPhase3.test.mjs",
  "scripts/tests/securityPhase6.test.mjs",
  "scripts/tests/securityPhase7.test.mjs",
  "src/app/api/admin/addons/[id]/route.ts",
  "src/app/api/admin/addons/route.ts",
  "src/app/api/admin/affiliate/payouts/[id]/send/route.ts",
  "src/app/api/admin/branding/route.ts",
  "src/app/api/admin/branding/upload/route.ts",
  "src/app/api/admin/music/payouts/[id]/send/route.ts",
  "src/app/api/admin/requests/[id]/charge/route.ts",
  "src/app/api/admin/requests/[id]/reject/route.ts",
  "src/app/api/admin/shop/payouts/[id]/send/route.ts",
  "src/app/api/affiliate/payout-method/route.ts",
  "src/app/api/affiliate/payouts/route.ts",
  "src/app/api/music/payouts/route.ts",
  "src/app/api/shop/payouts/route.ts",
  "src/lib/adminAudit.ts",
  "src/lib/i18n/translations.ts",
  "src/lib/payoutAudit.ts",
]);

// The files of this phase that sit inside an area an OLDER scope guard protects (payments, payouts, music, shop, admin, package files): exempted by exact path, never by directory.
export const PHASE22_PROTECTED_FILES = new Set([
  "package.json",
  "src/app/api/admin/addons/[id]/route.ts",
  "src/app/api/admin/addons/route.ts",
  "src/app/api/admin/affiliate/payouts/[id]/send/route.ts",
  "src/app/api/admin/branding/route.ts",
  "src/app/api/admin/branding/upload/route.ts",
  "src/app/api/admin/music/payouts/[id]/send/route.ts",
  "src/app/api/admin/requests/[id]/charge/route.ts",
  "src/app/api/admin/requests/[id]/reject/route.ts",
  "src/app/api/admin/shop/payouts/[id]/send/route.ts",
  "src/app/api/affiliate/payout-method/route.ts",
  "src/app/api/affiliate/payouts/route.ts",
  "src/app/api/music/payouts/route.ts",
  "src/app/api/shop/payouts/route.ts",
  "src/lib/adminAudit.ts",
  "src/lib/i18n/translations.ts",
  "src/lib/payoutAudit.ts",
]);
export const isPhase22ProtectedFile = (f) => PHASE22_PROTECTED_FILES.has(String(f).replace(/\\/g, "/"));
