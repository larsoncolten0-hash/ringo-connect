// The EXACT files the Phase 8 work ("Continue with Google / Apple" on the Log in page: existing accounts only) changes or adds.
// Same purpose and convention as phase2Files.mjs ... phase6Files.mjs: the older scope-guard tests allow these files and nothing
// else, via isPhase2File. An explicit list (no wildcards, no directories) is deliberate: adding a file here is a conscious,
// reviewable act.
// The ONLY files of this work that an older "no auth / no env changed" guard would otherwise flag. A guard exempts exactly
// these paths (never a directory, never a pattern) and ONLY in its auth / env check; every other protected path stays
// protected in every guard.
export const PHASE8_AUTH_SENSITIVE_FILES = new Set([
  ".env.example",
  "src/app/api/auth/login/route.ts",
  "src/app/auth/callback/route.ts",
  "src/app/auth/callback/", // how `git status --porcelain` lists the new callback folder while it is untracked (it holds only route.ts)
  "src/app/auth/login/page.tsx",
  // UX refinement phase: login lands on Ringo Home (login page + oauthLogin.resolveDestination), the sign-out bounce remembers where the person was going
  // (middleware: one added query parameter), and logout removes this device's push subscription. No session, token, cookie, RLS or role logic changed.
  "src/app/auth/logout/page.tsx",
  "src/lib/auth/oauthLogin.ts",
  "src/middleware.ts",
  "src/app/api/admin/requests/[id]/approve/route.ts" // only the "email already exists" 409 mapping; see oauthCleanup.test.mjs
]);
export const isPhase8AuthFile = (f) => PHASE8_AUTH_SENSITIVE_FILES.has(String(f).replace(/\\/g, "/"));

export const PHASE8_FILES = new Set([
  ".env.example",
  "scripts/tests/aiBusinessDrafts.test.mjs",
  "scripts/tests/aiBusinessTools.test.mjs",
  "scripts/tests/customers.test.mjs",
  "scripts/tests/inventory.test.mjs",
  "scripts/tests/oauthCleanup.test.mjs",
  "scripts/tests/oauthLogin.test.mjs",
  "scripts/tests/phase2Files.mjs",
  "scripts/tests/phase8Files.mjs",
  "scripts/tests/receivables.test.mjs",
  "scripts/tests/recordSaleUnit.test.mjs",
  "scripts/tests/reports.test.mjs",
  "scripts/tests/suspendedProfile.test.mjs",
  "src/app/api/admin/requests/[id]/approve/route.ts",
  "src/app/api/auth/login/route.ts",
  "src/app/auth/callback/route.ts",
  "src/app/auth/login/page.tsx",
  "src/components/auth/OAuthButtons.tsx",
  "src/lib/auth/accountAccess.ts",
  "src/lib/auth/createUserError.ts",
  "src/lib/auth/oauthLogin.ts",
  "src/lib/auth/removeStrayOAuthUser.ts",
  "src/lib/auth/strayOAuthUser.ts",
  "src/lib/i18n/translations.ts"
]);
