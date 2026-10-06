// The EXACT files the scalability and reliability Phase 0 pass changes or adds: the additive profile lookup indexes (un-applied migration + rollback), photo
// downscaling and long caching for immutable uploads, and the public profile's parallel reads. No payment, checkout, auth, RLS, commission, payout, bookkeeping or WhatsApp-logic file is on this
// list. Same convention as phase13Files.mjs / phase14Files.mjs: explicit, no wildcards.
export const SCALABILITY_PHASE0_FILES = new Set([
  "scripts/tests/scalabilityPhase0.test.mjs",
  "scripts/tests/scalabilityPhase0Files.mjs",
  "scripts/tests/ownerWorkspaceFiles.mjs",
  "scripts/tests/phase14.test.mjs",
  "src/app/[username]/page.tsx",
  "src/components/editor/AvatarCropperField.tsx",
  "src/components/editor/ImageGalleryUploadField.tsx",
  "src/components/editor/ImageUploadField.tsx",
  "src/lib/imageDownscale.ts",
  "supabase/migrations/2026-12-16_profile_lookup_indexes.sql", // UN-APPLIED, additive: nine CREATE INDEX IF NOT EXISTS
  "supabase/support/2026-12-16_profile_lookup_indexes.rollback.sql",
]);
