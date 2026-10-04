// The EXACT files the Phase 3 public-experience work (first pass: meaningful public content, public states and
// language, public accessibility) changes or adds. Same purpose and convention as phase2Files.mjs: the older
// scope-guard tests allow these files and nothing else, via isPhase2File (which accepts this list too).
// An explicit list (no wildcards, no directories) is deliberate: adding a file here is a conscious, reviewable act.
export const PHASE3_FILES = new Set([
  "scripts/tests/mobileQuality.test.mjs",
  "scripts/tests/phase3Files.mjs",
  "scripts/tests/publicExperience.test.mjs",
  "scripts/tests/sectionOrder.test.mjs",
  "src/components/FanRecognitionHeader.tsx",
  "src/components/ProfileView.tsx",
  "src/components/SocialIcon.tsx",
  "src/components/music/EventsSection.tsx",
  "src/components/music/MusicSection.tsx",
  "src/components/music/SupportArtistSection.tsx",
  "src/components/restaurant/FeaturedMenuSection.tsx",
  "src/lib/sectionOrder.ts"
]);
