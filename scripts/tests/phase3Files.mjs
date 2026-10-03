// The EXACT files the Phase 3 public-experience work (first pass: meaningful public content, public states and
// language, public accessibility) changes or adds. Same purpose and convention as phase2Files.mjs: the older
// scope-guard tests allow these files and nothing else, via isPhase2File (which accepts this list too).
// An explicit list (no wildcards, no directories) is deliberate: adding a file here is a conscious, reviewable act.
export const PHASE3_FILES = new Set([
  "scripts/tests/editorReliability.test.mjs",
  "scripts/tests/phase2Files.mjs",
  "scripts/tests/phase3Files.mjs",
  "scripts/tests/publicExperience.test.mjs",
  "scripts/tests/publicLanguageAndFooter.test.mjs",
  "scripts/tests/subscriptionEntitlements.test.mjs",
  "src/app/[username]/not-found.tsx",
  "src/app/[username]/page.tsx",
  "src/app/loading.tsx",
  "src/components/FanRecognitionHeader.tsx",
  "src/components/ProfileView.tsx",
  "src/components/PublicLanguageSelector.tsx",
  "src/components/ShareButton.tsx",
  "src/components/catalog/CatalogSection.tsx",
  "src/components/connect/StayConnectedModal.tsx",
  "src/components/music/EventsSection.tsx",
  "src/components/music/MusicSection.tsx",
  "src/components/music/ReleasesSection.tsx",
  "src/components/music/SupportArtistSection.tsx",
  "src/components/public/PublicStates.tsx",
  "src/components/restaurant/FeaturedMenuSection.tsx",
  "src/components/ui/menuNav.ts",
  "src/lib/i18n/translations.ts",
  "src/lib/previewPlan.ts",
  "src/lib/publicContent.ts"
]);
