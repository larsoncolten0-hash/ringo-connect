// The EXACT files the Android fixes change: "Write Your Ringo Card" (the NFC write now starts inside the tap, so Chrome's NFC permission prompt is not lost to a slow network call made
// first) and the dashboard's "Add to Home Screen" menu item (it now listens for the browser's install event from page load, not only once the avatar menu is opened).
// Nothing else changes: no database, no API route, no manifest, no service worker, no copy.
// Same convention as phase28Files.mjs .. phase33Files.mjs: explicit, no wildcards, no directories.
export const PHASE34_FILES = new Set([
  "scripts/tests/phase34Files.mjs",
  "scripts/tests/androidInstallAndNfc.test.mjs",
  "src/components/dashboard/RingoCardWriter.tsx",
  "src/components/dashboard/AddToHomeScreenMenuItem.tsx",
]);
