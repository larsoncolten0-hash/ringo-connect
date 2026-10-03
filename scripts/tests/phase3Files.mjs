// The EXACT files the Phase 3 public-experience work (first pass: meaningful public content, public states and
// language, public accessibility) changes or adds. Same purpose and convention as phase2Files.mjs: the older
// scope-guard tests allow these files and nothing else, via isPhase2File (which accepts this list too).
// An explicit list (no wildcards, no directories) is deliberate: adding a file here is a conscious, reviewable act.
export const PHASE3_FILES = new Set([
  "scripts/tests/heroAction.test.mjs",
  "scripts/tests/heroActionPins.json",
  "scripts/tests/phase3Files.mjs",
  "scripts/tests/publicExperience.test.mjs",
  "src/components/CallButton.tsx",
  "src/components/GenericHeroActions.tsx",
  "src/components/ProfileView.tsx",
  "src/components/SaveContactButton.tsx",
  "src/components/WhatsAppButton.tsx",
  "src/components/connect/ConnectButton.tsx",
  "src/components/ui/useModalA11y.ts",
  "src/lib/heroAction.ts",
  "src/lib/i18n/translations.ts"
]);
