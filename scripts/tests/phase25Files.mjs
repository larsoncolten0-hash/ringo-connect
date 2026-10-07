// The EXACT files the profile picture shape (round or square) changes or adds: the shared helper, the owner's choice in the profile editor card, the public surfaces that read it
// (main profile, Music profile and pages, product / item pages, shop page), the EN/FR strings, the UN-APPLIED migration (REQUIRES OWNER APPROVAL) with its rollback and verify, and the
// tests. A DISPLAY preference only: no upload, crop, storage, payment, auth, analytics, WhatsApp or Music-preview file is on this list. Same convention as phase24Files.mjs.
export const PHASE25_FILES = new Set([
  "scripts/tests/avatarShape.test.mjs",
  "scripts/tests/designFoundation.test.mjs", // foundation opt-in guard: exempts this list
  "scripts/tests/musicProfile.test.mjs", // rendered checks that the profile, Music profile and Music pages follow the choice
  "scripts/tests/ownerWorkspaceFiles.mjs",
  "scripts/tests/phase25Files.mjs",
  "src/app/[username]/shop/page.tsx", // passes the (non-sensitive) shape to the shop page's whitelisted profile
  "src/components/Editor.tsx", // passes the saved shape to the profile card
  "src/components/ProfileView.tsx", // main public profile, every category
  "src/components/catalog/ProductDetailView.tsx", // product / item pages
  "src/components/editor/ProfileHeaderCard.tsx", // the Round / Square choice, saved with the card's own Save
  "src/components/music/profile/MusicArtistView.tsx",
  "src/components/music/profile/MusicDestinationView.tsx",
  "src/components/shop/ShopDestination.tsx",
  "src/lib/avatarShape.ts",
  "src/lib/i18n/translations.ts",
  "supabase/migrations/2026-12-17_profile_avatar_shape.sql", // UN-APPLIED
  "supabase/support/2026-12-17_profile_avatar_shape.rollback.sql",
  "supabase/support/2026-12-17_profile_avatar_shape.verify.sql",
]);

// Older guards that require "any new migration is dated AFTER the latest existing one" exempt exactly this path (and nothing else).
export const PHASE25_MIGRATIONS = new Set(["supabase/migrations/2026-12-17_profile_avatar_shape.sql"]);
export const isPhase25Migration = (f) => PHASE25_MIGRATIONS.has(String(f).replace(/\\/g, "/"));
