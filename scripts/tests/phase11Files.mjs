// The EXACT files Phase 3A (the public profile foundation + the Music pilot) changes or adds, on top of phase9Files.mjs / phase10Files.mjs.
// Same convention as phase2Files.mjs ... phase10Files.mjs: an explicit list, no wildcards, no directories.
export const PHASE11_FILES = new Set([
  "scripts/tests/designFoundation.test.mjs", // the Phase 1/2 historical assertions are pinned to the Phase 1+2 commit instead of the moving working tree
  "scripts/tests/landingHero.test.mjs",
  "scripts/tests/landingStory.test.mjs",
  "scripts/tests/heroActionPins.json", // MusicHeroButtons was edited on purpose (its pin carries the new hash)
  "scripts/tests/mobileQuality.test.mjs", // the radius class on track / event cards moved from rounded-2xl to the foundation's rounded-ringo-lg
  "scripts/tests/musicProfile.test.mjs",
  "scripts/tests/phase11Files.mjs",
  "scripts/tests/publicLanguageAndFooter.test.mjs", // the shared footer link and language control are 44px now (was 40px / 36px)
  "scripts/tests/phase2Files.mjs",
  "src/components/ProfileView.tsx",
  "src/components/PoweredByRingo.tsx", // class-only: the attribution link is a 44px target
  "src/components/PublicLanguageSelector.tsx", // class-only: the glass language control is a 44px target
  "src/components/ShareButton.tsx", // class-only: the share control is a 44px target
  "src/components/brand/Ring.tsx",
  "src/components/music/EventsSection.tsx",
  "src/components/music/MusicHeroButtons.tsx",
  "src/components/music/MusicSection.tsx",
  "src/components/music/PinnedSpotlight.tsx",
  "src/components/music/ReleasesSection.tsx",
  "src/components/music/SupportArtistSection.tsx",
  "src/lib/color.ts",
  "src/lib/i18n/translations.ts",
  "src/lib/profileStage.ts",
  "src/lib/theme.ts"
]);
