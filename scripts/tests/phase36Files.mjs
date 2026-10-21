// The EXACT files the Android "Save Contact" work changes or adds: on Chrome for Android a tap now tries the Contacts app's pre-filled "create contact" screen (with the existing
// vCard download as the fallback); iPhone, desktop and every other browser keep the unchanged vCard link. Display and click behaviour only.
// Not touched: the vCard content, contact fields, profile data, APIs, database, authentication, payments, NFC card writing, the profile-subdomain feature.
// Same convention as phase28Files.mjs .. phase35Files.mjs: explicit, no wildcards, no directories.
export const PHASE36_FILES = new Set([
  "scripts/tests/phase36Files.mjs",
  "scripts/tests/saveContactAndroid.test.mjs",
  "scripts/tests/ownerWorkspaceFiles.mjs",
  "scripts/tests/avatarShape.test.mjs",
  "scripts/tests/performance.test.mjs",
  "src/lib/vcard.ts",
  "src/components/SaveContactButton.tsx",
  "src/components/music/profile/MusicArtistView.tsx",
]);
