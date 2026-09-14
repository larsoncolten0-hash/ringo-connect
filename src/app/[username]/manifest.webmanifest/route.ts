import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// A per-profile Web App Manifest — this is what makes "Add to Home Screen"
// install JAY KAY specifically (name, icon, launch URL) rather than a
// generic "Ringo Connect" app. Linked from every public profile variant's
// <head> via generateMetadata's `manifest` field (see
// src/lib/profileMetadata.ts) — the browser fetches this URL when it
// evaluates installability / when the visitor taps "Add to Home Screen".
//
// A plain Route Handler rather than Next's `manifest.ts` file convention:
// this needs the dynamic `[username]` route param, and a Route Handler is
// unambiguous about supporting that (always does) — see the
// implementation plan for why not risking an unverified assumption about
// manifest.ts's own dynamic-params support here.
export async function GET(_request: Request, { params }: { params: { username: string } }) {
  const supabase = createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "name, username, avatar_url, theme_color, background_color, published, avatar_icon_192_url, avatar_icon_512_url, avatar_icon_maskable_512_url"
    )
    .eq("username", params.username)
    .eq("published", true)
    .single();

  if (!profile) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const displayName = profile.name || profile.username;
  const themeColor = profile.theme_color || "#4F46E5";

  // The creator's own avatar becomes the home-screen icon where one
  // exists. Proper sized/padded derivatives (see
  // /api/profile/avatar-icons and 2026-10-09_profile_pwa_icons.sql), not
  // the raw avatar file referenced twice — generated once at avatar
  // upload time, not computed fresh on every manifest request. Falls
  // back to the raw avatar_url (no `purpose: maskable` entry, since an
  // unprocessed photo isn't safe-zone padded) for a profile whose avatar
  // predates this feature, then to the site's own generated PWA icons
  // (scripts/generate-pwa-icons.js) when there's no avatar at all.
  const icons =
    profile.avatar_icon_192_url && profile.avatar_icon_512_url
      ? [
          { src: profile.avatar_icon_192_url, sizes: "192x192", type: "image/png" },
          { src: profile.avatar_icon_512_url, sizes: "512x512", type: "image/png" },
          ...(profile.avatar_icon_maskable_512_url
            ? [{ src: profile.avatar_icon_maskable_512_url, sizes: "512x512", type: "image/png", purpose: "maskable" }]
            : []),
        ]
      : profile.avatar_url
      ? [
          { src: profile.avatar_url, sizes: "192x192", type: "image/png" },
          { src: profile.avatar_url, sizes: "512x512", type: "image/png" },
        ]
      : [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ];

  const manifest = {
    id: `/${profile.username}`,
    // Exactly the profile URL, nothing appended — installing must always
    // reopen precisely "/username", never a tracking-decorated variant.
    start_url: `/${profile.username}`,
    name: displayName,
    short_name: displayName.length > 12 ? `${displayName.slice(0, 11)}…` : displayName,
    // Deliberately site-wide, not just "/username" — so tapping from the
    // installed shell into that same profile's Book/Community/menu pages
    // (or a restaurant's /r/username ordering page) stays in standalone
    // mode instead of escaping to the regular browser.
    scope: "/",
    display: "standalone",
    background_color: profile.background_color || "#0A0A0A",
    theme_color: themeColor,
    icons,
  };

  return NextResponse.json(manifest, {
    headers: { "Content-Type": "application/manifest+json" },
  });
}
