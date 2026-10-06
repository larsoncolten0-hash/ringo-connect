// The EXACT files the scalability and reliability Phases 1-5 pass changes or adds: the dashboard layout's independent reads started together, per-request
// memoisation of the duplicated public loaders (src/lib/requestMemo.ts), a restaurant storefront error boundary (/r), a failure log on a route that returned a bare 500, lazy loading
// of below-the-fold public images and a year-long cache on immutable preview audio. No payment, checkout, auth, RLS, order, stock, bookkeeping, invoice,
// commission, payout, WhatsApp-logic, cron, migration or package file is on this list. Same convention as phase13Files.mjs / phase14Files.mjs: explicit, no wildcards.
export const SCALABILITY_PHASE1TO5_FILES = new Set([
  "scripts/tests/scalabilityPhase1to5.test.mjs",
  "scripts/tests/scalabilityPhase1to5Files.mjs",
  "scripts/tests/ownerWorkspaceFiles.mjs",
  "scripts/tests/customers.test.mjs", // nav pin: the clause that pinned a sequential `await` now matches the parallel form; every other clause is unchanged
  "scripts/tests/documentsUi.test.mjs", // same
  "scripts/tests/inbox.test.mjs", // same
  "scripts/tests/inventory.test.mjs", // same
  "scripts/tests/reports.test.mjs", // same
  "scripts/tests/shopSeller.test.mjs", // same (a baseline-failing test: only this one clause changed; its baseline failures are untouched)
  "src/app/[username]/item/[id]/page.tsx",
  "src/app/[username]/shop/page.tsx",
  "src/app/api/associations/[associationId]/members/route.ts",
  "src/app/dashboard/layout.tsx",
  "src/app/r/[username]/error.tsx",
  "src/app/r/[username]/item/[id]/page.tsx",
  "src/components/ImageGallery.tsx",
  "src/components/ProfileView.tsx",
  "src/components/editor/AudioUploadField.tsx",
  "src/components/editor/ProtectedAudioUploadField.tsx",
  "src/components/music/EventsSection.tsx",
  "src/components/music/MusicStorePage.tsx",
  "src/components/music/ReleasesSection.tsx",
  "src/components/restaurant/FeaturedMenuSection.tsx",
  "src/lib/profileMetadata.ts",
  "src/lib/requestMemo.ts",
]);
