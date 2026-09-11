import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// The dashboard's own Web App Manifest — same "Add to Home Screen"
// mechanism as the public profile's (see
// src/app/[username]/manifest.webmanifest/route.ts), but installs the
// creator's management app instead of their public page: a distinct
// id/start_url/scope so a creator who installs both ends up with two
// separate home-screen icons, neither overwriting the other. Linked from
// every /dashboard/** page via generateMetadata's `manifest` field (see
// src/lib/dashboardMetadata.ts, exported from dashboard/layout.tsx).
//
// Gated behind the signed-in user because the dashboard itself is — but
// unlike a page, a Route Handler is never wrapped by dashboard/layout.tsx
// (Next only nests layouts around page.tsx, never route.ts), so the auth
// check has to happen here too, not just there.
export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("name, username, avatar_url, theme_color")
    .eq("user_id", user.id)
    .single();

  const displayName = profile?.name || profile?.username || "Ringo Connect";
  const themeColor = profile?.theme_color || "#4F46E5";

  // Same reasoning as the profile route: no image-processing pipeline
  // exists here, so the creator's own avatar is referenced at whatever
  // size it actually is (browsers scale to fit) and falls back to the
  // site's own generated PWA icons when there's no avatar.
  const icons = profile?.avatar_url
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
    id: "/dashboard",
    start_url: "/dashboard",
    name: `${displayName} Dashboard`,
    // Deliberately generic ("Dashboard"), not the creator's own name —
    // the profile manifest already uses their name, and both manifests
    // reference the same avatar as their icon, so this is what lets a
    // creator who installs both tell the two home-screen icons apart.
    short_name: "Dashboard",
    // Deliberately narrower than the profile manifest's site-wide scope
    // — auth pages (login/logout) and the public profile are meant to
    // open in the regular browser, not get swallowed into the installed
    // dashboard shell.
    scope: "/dashboard",
    display: "standalone",
    background_color: "#0A0A0A",
    theme_color: themeColor,
    icons,
  };

  return NextResponse.json(manifest, {
    headers: { "Content-Type": "application/manifest+json" },
  });
}
