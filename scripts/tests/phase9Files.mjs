// The EXACT files the Phase 9 work (Ringo visual design foundation: tokens, motion, glass, gilt, lamplight, the Ring, the Ringo Card) changes or adds.
// Same purpose and convention as phase2Files.mjs ... phase8Files.mjs: the older scope-guard tests allow these files and nothing else, via
// isPhase2File. An explicit list (no wildcards, no directories) is deliberate: adding a file here is a conscious, reviewable act.
// The three directory entries are only how `git status --porcelain` lists a folder that is still untracked.
export const PHASE9_FILES = new Set([
  "scripts/tests/designFoundation.test.mjs",
  "scripts/tests/phase2Files.mjs",
  "scripts/tests/phase9Files.mjs",
  "src/app/dev-preview-foundation/",
  "src/app/dev-preview-foundation/page.tsx",
  "src/app/globals.css",
  "src/components/brand/",
  "src/components/brand/FoundationPreview.tsx",
  "src/components/brand/MicroLabel.tsx",
  "src/components/brand/Ring.tsx",
  "src/components/brand/RingoCard3D.tsx",
  "src/lib/design/",
  "src/lib/design/motion.ts",
  "src/lib/design/tapToConnect.ts",
  "src/lib/i18n/translations.ts",
  "tailwind.config.ts"
]);
