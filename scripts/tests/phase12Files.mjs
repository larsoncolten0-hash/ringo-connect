// The EXACT files Phase 3B (category stages for every public profile) changes or adds, on top of phase11Files.mjs.
// Same convention as phase2Files.mjs ... phase11Files.mjs: an explicit list, no wildcards, no directories.
export const PHASE12_FILES = new Set([
  "scripts/tests/heroActionPins.json", // RestaurantHeroButtons was edited on purpose (colour, and the Call label now translated; its pin carries the new hash)
  "scripts/tests/phase12Files.mjs",
  "src/app/dev-preview-profile/fixtures.ts", // dev-only visual QA route (same production gate as the other dev-preview routes)
  "src/app/dev-preview-profile/page.tsx",
  "src/components/catalog/CatalogSection.tsx", // accentText prop, 11px label contrast, a lone product is featured
  "src/components/profile/ConnectionPath.tsx", // the closing journey: seal + Discover/Connect/Reach out/Meet (presentational)
  "src/components/profile/ConnectionSeal.tsx", // the closing seal: hairline, Ring, hairline
  "src/components/restaurant/FeaturedMenuSection.tsx", // class/colour only: readable text on the accent, 11px badge
  "src/components/restaurant/RestaurantHeroButtons.tsx" // colour only: readable text on the accent instead of fixed white
]);
