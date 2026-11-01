// The EXACT files the public plans / add-ons catalogue cache changes or adds: one shared server-side cache read (src/lib/publicCatalog.ts), the five public pages that display it, the three admin
// plan / add-on save routes that refresh it, and the tests. NO migration, no payment code: signupPayment, applyPayment, the Fapshi / Stripe routes, the renewal cron and the card-bundle initiate route keep reading live rows.
// Same convention as churchPhase4Files.mjs: explicit, no wildcards, no directories.
export const PUBLIC_CATALOG_CACHE_FILES = new Set([
  "scripts/tests/publicCatalogCacheFiles.mjs",
  "scripts/tests/publicCatalogCache.test.mjs",
  "scripts/tests/performance.test.mjs",
  // The older "only registered files changed" guards that exempt this change set by exact file.
  "scripts/tests/avatarShape.test.mjs",
  "scripts/tests/legal.test.mjs",
  "scripts/tests/aiBusinessTools.test.mjs",
  "scripts/tests/overview.test.mjs",
  "scripts/tests/saveContactAndroid.test.mjs",
  "scripts/tests/whatsappSecurityAudit.test.mjs",
  "src/lib/publicCatalog.ts",
  "src/app/page.tsx",
  "src/app/get-started/page.tsx",
  "src/app/get-started-cards/page.tsx",
  "src/app/get-started-affiliate/page.tsx",
  "src/app/get-started-association/page.tsx",
  "src/app/api/admin/plans/[id]/route.ts",
  "src/app/api/admin/addons/route.ts",
  "src/app/api/admin/addons/[id]/route.ts",
]);
