// The EXACT files the Phase 6 (engagement and return: share address and copy, add-to-home-screen, push prompt storage) and
// Phase 7 (premium polish: public error state, QR sheet address) work changes or adds. Same purpose and convention as
// phase2Files.mjs ... phase5Files.mjs: the older scope-guard tests allow these files and nothing else, via isPhase2File.
// An explicit list (no wildcards, no directories) is deliberate: adding a file here is a conscious, reviewable act.
export const PHASE6_FILES = new Set([
  "scripts/tests/engagement.test.mjs",
  "scripts/tests/phase2Files.mjs",
  "scripts/tests/phase6Files.mjs",
  "scripts/tests/premiumPolish.test.mjs",
  "src/app/[username]/error.tsx",
  "src/components/AddToHomeScreen.tsx",
  "src/components/PushPermissionPrompt.tsx",
  "src/components/ShareButton.tsx",
  "src/lib/i18n/translations.ts",
  "src/lib/shareUrl.ts"
]);
