// The EXACT files the custom profile address work changes or adds (name.<profile domain>): the host-aware middleware (inert unless NEXT_PUBLIC_PROFILE_DOMAIN is set; the main site's
// /dashboard and /admin guard is unchanged and now proven by behaviour in mainSiteMiddleware.mjs instead of a literal matcher string), one authenticated owner route, one editor section,
// one additive UN-APPLIED migration (two new tables and one service_role-only function, with preflight, verify and rollback scripts), English + French copy, and their tests.
// Not touched: authentication, payments, Fapshi, Stripe, webhooks, plans, existing tables, existing routes, canonical URLs.
// Same convention as phase28Files.mjs .. phase34Files.mjs: explicit, no wildcards, no directories.
export const PHASE35_FILES = new Set([
  "scripts/tests/phase35Files.mjs",
  "scripts/tests/profileSubdomain.test.mjs",
  "scripts/tests/mainSiteMiddleware.mjs",
  "scripts/tests/documentsShare.test.mjs",
  "scripts/tests/commerceA11y.test.mjs",
  "scripts/tests/oauthLogin.test.mjs",
  "scripts/tests/seoRobotsSitemap.test.mjs",
  "scripts/tests/ownerWorkspaceFiles.mjs",
  "scripts/tests/performance.test.mjs",
  "scripts/tests/avatarShape.test.mjs",
  "scripts/tests/legal.test.mjs",
  "scripts/tests/whatsappSecurityAudit.test.mjs",
  ".env.example",
  "docs/profile-subdomains.md",
  "src/middleware.ts",
  "src/lib/profileSubdomain.ts",
  "src/app/api/profile/subdomain/route.ts",
  "src/components/editor/ProfileAddressCard.tsx",
  "src/components/Editor.tsx",
  "src/lib/i18n/translations.en.ts",
  "src/lib/i18n/translations.fr.ts",
  "supabase/migrations/2026-12-25_profile_subdomains.sql",
  "supabase/support/2026-12-25_profile_subdomains.preflight.sql",
  "supabase/support/2026-12-25_profile_subdomains.verify.sql",
  "supabase/support/2026-12-25_profile_subdomains.rollback.sql",
]);
