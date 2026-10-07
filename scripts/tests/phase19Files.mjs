// The EXACT files the Phase 4 API / input security audit changes or adds: the Fapshi transaction <-> music order binding (the artist-writable
// pending_fapshi_trans_id could confirm a sale nobody paid) and its test. No migration, no auth, no RLS, no other payment file. Same convention as
// phase16Files.mjs: explicit, no wildcards.
export const PHASE19_FILES = new Set([
  "scripts/tests/phase19Files.mjs",
  "scripts/tests/phase16Files.mjs",
  "scripts/tests/securityPhase4.test.mjs",
  "scripts/tests/ownerWorkspaceFiles.mjs",
  "src/lib/musicOrderPayment.ts",
  "src/lib/musicOrderPaymentBinding.ts",
]);

// The files of this phase that sit inside an area an OLDER scope guard protects ("no payment file"): exempted by exact path, never by directory.
export const PHASE19_PROTECTED_FILES = new Set(["src/lib/musicOrderPayment.ts", "src/lib/musicOrderPaymentBinding.ts"]);
export const isPhase19ProtectedFile = (f) => PHASE19_PROTECTED_FILES.has(String(f).replace(/\\/g, "/"));
