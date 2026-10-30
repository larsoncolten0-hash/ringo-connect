// The EXACT files the Churches & Ministries Phase 4 work changes or adds: the Church Store stock card and store sales/orders summary (one owner-only, read-only route), one safeguard in the church push job
// (it stops a notification when a delivery cannot be noted, so nobody is pushed twice), the strings, the Ringo AI knowledge note, and the tests. NO migration: it reads existing Shop orders and the existing Inventory.
// Also: the daily church-gift and Shop payment reconcile sweeps (one secret-protected cron route that calls the existing gift sweep, plus two vercel.json schedules). Not touched: giving/gift/payment logic, the church report (still counts only), any migration.
// Same convention as customerRetentionFiles.mjs: explicit, no wildcards, no directories. tsconfig.tsbuildinfo is the generated TypeScript cache and is never part of a commit.
export const CHURCH_PHASE4_FILES = new Set([
  "scripts/tests/churchPhase4Files.mjs",
  "scripts/tests/ownerWorkspaceFiles.mjs",
  "scripts/tests/churchPhase4.test.mjs",
  "scripts/tests/churchReconcileCron.test.mjs",
  "scripts/tests/cronAuth.test.mjs",
  "scripts/tests/inventory.test.mjs",
  "scripts/tests/churchCategory.test.mjs",
  "scripts/tests/churchDailyWordsApi.test.mjs",
  "scripts/tests/churchPeopleGroups.test.mjs",
  "scripts/tests/avatarShape.test.mjs",
  "scripts/tests/legal.test.mjs",
  "scripts/tests/performance.test.mjs",
  "scripts/tests/saveContactAndroid.test.mjs",
  "src/app/api/church/store-summary/route.ts",
  "src/app/api/cron/reconcile-church-gifts/route.ts",
  "src/app/dashboard/church/store/page.tsx",
  "src/components/church/store/ChurchStoreEntry.tsx",
  "src/components/church/store/ChurchStoreStock.tsx",
  "src/components/church/store/ChurchStoreSummary.tsx",
  "src/lib/ai/knowledge/modules/churchMinistries.ts",
  "src/lib/church/push/run.ts",
  "src/lib/church/store/statuses.ts",
  "src/lib/church/store/stock.ts",
  "src/lib/church/store/summary.ts",
  "src/lib/i18n/translations.en.ts",
  "src/lib/i18n/translations.fr.ts",
  "tsconfig.tsbuildinfo",
  "vercel.json",
]);
