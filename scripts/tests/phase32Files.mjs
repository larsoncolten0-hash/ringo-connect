// The EXACT files the Ringo Smart Card QR claim work changes or adds: pre-issued cards (one additive, UN-APPLIED migration: a new table, four service-role-only functions), the public
// /c/<token> page, one authenticated claim endpoint, the claim screen, English + French copy, the reserved username "c", the /c/ response headers, the batch generator and its tests.
// Not touched: the NFC Card Writer and its routes (ringo_cards), association membership cards (/m-card), digital delivery (/d), profile routes, authentication, payments, middleware.
// Same convention as phase28Files.mjs / phase30Files.mjs: explicit, no wildcards, no directories.
export const PHASE32_FILES = new Set([
  "next.config.js",
  "scripts/smartcards/generateBatch.mjs",
  "scripts/smartcards/importBatch.mjs",
  "scripts/smartcards/verifyPackage.mjs",
  "scripts/smartcards/concurrencyCheck.mjs",
  ".gitignore",
  "scripts/tests/phase32Files.mjs",
  "scripts/tests/smartCards.test.mjs",
  "docs/smart-cards-production-plan.md",
  "src/app/api/smart-cards/claim/route.ts",
  "src/app/c/[token]/page.tsx",
  "src/components/smartCard/CardClaim.tsx",
  "src/lib/i18n/translations.en.ts",
  "src/lib/i18n/translations.fr.ts",
  "src/lib/reservedUsernames.ts",
  "src/lib/smartCards/ids.ts",
  "src/lib/smartCards/scan.ts",
  "src/lib/smartCards/token.ts",
  "supabase/migrations/2026-12-22_smart_card_claims.sql",
  "supabase/support/tests/smart_card_claims.test.mjs",
]);
