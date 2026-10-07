// The EXACT files the Music Artist Profile redesign changes or adds: the composition (hero, featured card, song list, releases, tickets, merch, links, gift, about, close), its fixed
// palette, the music-profile helpers, the EN/FR `musicProfile` strings, the category hook in ProfileView, the ghost social icon, and the "open the dashboard on Ringo Home" entry.
// Music category ONLY. No payment, checkout, Fapshi, preview-limit, purchased-song access, API route, SQL or migration file is on this list.
// Same convention as phase23Files.mjs: explicit, no wildcards, no directories.
export const PHASE24_FILES = new Set([
  "scripts/tests/designFoundation.test.mjs", // foundation opt-in guard: exempts this list
  "scripts/tests/musicProfile.test.mjs", // the theme-safety assertions now verify the fixed Music palette + the creator accent
  "scripts/tests/ownerWorkspaceFiles.mjs",
  "scripts/tests/phase16Files.mjs",
  "scripts/tests/phase24Files.mjs",
  "src/app/dashboard/page.tsx", // opening the dashboard from outside lands on Ringo Home (in-app navigation is unchanged)
  "src/components/ProfileView.tsx", // isMusic renders MusicArtistView; every other category renders exactly as before
  "src/components/SocialIcon.tsx", // optional `ghost` treatment (Music profile only; the default render is unchanged)
  "src/components/music/SupportArtistSection.tsx", // exports SUPPORT_PRESET_AMOUNTS (the same presets, now shared)
  "src/app/m/[username]/merch/page.tsx", // the artist's Merch page (read-only; items open the existing merch pages)
  "src/app/m/[username]/music/page.tsx", // the artist's Music page
  "src/app/m/[username]/tickets/page.tsx", // the artist's Tickets page
  "src/components/music/profile/MusicArtistView.tsx",
  "src/components/music/profile/MusicDestinationView.tsx", // Music / Merch / Tickets destination pages (links into the existing item pages and the one storefront checkout)
  "src/components/music/profile/MusicNav.tsx", // profile quick links + the destination bar
  "src/components/music/profile/musicFont.ts", // the display face, loaded once for Music pages
  "src/components/music/profile/MusicSections.tsx",
  "src/components/music/profile/musicTheme.ts",
  "src/lib/dashboardEntry.ts",
  "src/lib/i18n/translations.ts", // the EN/FR `musicProfile` namespace (added; nothing existing is rewritten)
  "src/lib/music/loadDestination.ts", // read-only loader for the destination pages (same published-profile + plan-limit rules as the profile)
  "src/lib/music/profileMusic.ts", // presentation helpers only (labels, role, hero lines); no pricing, preview or purchase logic
]);

// The files of this phase that sit inside an area an OLDER scope guard protects (src/lib/music): exempted by exact path, never by directory.
export const PHASE24_PROTECTED_FILES = new Set([
  "src/lib/music/loadDestination.ts",
  "src/lib/music/profileMusic.ts",
]);
export const isPhase24ProtectedFile = (f) => PHASE24_PROTECTED_FILES.has(String(f).replace(/\\/g, "/"));
