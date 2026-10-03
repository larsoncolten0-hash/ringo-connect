// The EXACT files the Phase 4 SEO and discoverability work (profile / homepage metadata, canonical, Open Graph and
// Twitter, robots, sitemap, structured data, noindex on receipts and ticket passes) changes or adds. Same purpose
// and convention as phase2Files.mjs / phase3Files.mjs: the older scope-guard tests allow these files and nothing
// else, via isPhase2File (which accepts this list too).
// An explicit list (no wildcards, no directories) is deliberate: adding a file here is a conscious, reviewable act.
export const PHASE4_FILES = new Set([
  "scripts/tests/phase2Files.mjs",
  "scripts/tests/phase4Files.mjs",
  "scripts/tests/seoMetadata.test.mjs",
  "scripts/tests/seoRobotsSitemap.test.mjs",
  "scripts/tests/seoStructuredData.test.mjs",
  "src/app/[username]/book/page.tsx",
  "src/app/[username]/item/[id]/page.tsx",
  "src/app/[username]/page.tsx",
  "src/app/m/[username]/[type]/[id]/page.tsx",
  "src/app/m/[username]/receipt/[id]/page.tsx",
  "src/app/m/[username]/ticket-pass/[code]/page.tsx",
  "src/app/page.tsx",
  "src/app/r/[username]/item/[id]/page.tsx",
  "src/app/robots.ts",
  "src/app/sitemap.ts",
  "src/lib/profileMetadata.ts",
  "src/lib/seo.ts"
]);
