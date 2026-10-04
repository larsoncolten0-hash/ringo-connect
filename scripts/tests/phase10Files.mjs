// The EXACT files the Phase 2A work (the landing hero) and the Phase 2 work (the complete landing page transformation) change, add or
// remove, on top of phase9Files.mjs. Same convention as phase2Files.mjs ... phase9Files.mjs: an explicit list, no wildcards, no directories.
export const PHASE10_FILES = new Set([
  "scripts/tests/landingHero.test.mjs",
  "scripts/tests/landingStory.test.mjs",
  "scripts/tests/phase10Files.mjs",
  "src/components/landing/AboutSection.tsx", // removed: hard-coded English, a separate cream/Manrope world, unreferenced after Phase 2
  "src/components/landing/AffiliateSection.tsx",
  "src/components/landing/CardStorySection.tsx",
  "src/components/landing/ClosingSection.tsx",
  "src/components/landing/CommerceStory.tsx",
  "src/components/landing/ConnectionSection.tsx",
  "src/components/landing/EcosystemDiagram.tsx",
  "src/components/landing/GradientMesh.tsx", // removed: unreferenced after the hero pilot
  "src/components/landing/HeroRingoObject.tsx",
  "src/components/landing/IdeaSection.tsx",
  "src/components/landing/IndustriesGrid.tsx", // removed: replaced by IndustriesSection
  "src/components/landing/IndustriesSection.tsx",
  "src/components/landing/IndustryShowcase.tsx",
  "src/components/landing/JourneySteps.tsx",
  "src/components/landing/LandingView.tsx",
  "src/components/landing/NavDropdown.tsx",
  "src/components/landing/NfcQrSection.tsx", // removed: replaced by CardStorySection
  "src/components/landing/PathPickerSection.tsx",
  "src/components/landing/PhoneMockup.tsx",
  "src/components/landing/PricingSection.tsx",
  "src/components/landing/RestaurantSection.tsx",
  "src/components/landing/RestaurantShowcase.tsx",
  "src/components/landing/Reveal.tsx",
  "src/components/landing/Section.tsx",
  "src/components/landing/heroFont.ts"
]);
