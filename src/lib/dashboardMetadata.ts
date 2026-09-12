import type { Metadata, Viewport } from "next";
import { createClient } from "@/lib/supabase/server";

// Same "Add to Home Screen" pattern as the public profile's (see
// src/lib/profileMetadata.ts) but for the dashboard app shell — the
// manifest link, iOS home-screen name/icon, and theme color for the
// signed-in creator's own installed dashboard. Exported as
// generateMetadata/generateViewport from dashboard/layout.tsx, so every
// /dashboard/** page inherits it (no dashboard subroute defines its own
// metadata that would override these fields).
//
// A separate, lightweight query rather than reusing dashboard/layout.tsx's
// own fetch — generateMetadata runs as its own pass from the layout
// component, so there's no way to share the result anyway (same
// reasoning as profileMetadata.ts).
async function getViewerProfile() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("profiles")
    .select("name, username, avatar_url, theme_color")
    .eq("user_id", user.id)
    .single();
  return data;
}

export async function generateMetadata(): Promise<Metadata> {
  const profile = await getViewerProfile();
  if (!profile) return {};

  const displayName = profile.name || profile.username;

  return {
    // Powers the browser's "Add to Home Screen"/install prompt on
    // Android/Chrome — see
    // src/app/dashboard/manifest.webmanifest/route.ts.
    manifest: "/dashboard/manifest.webmanifest",
    // iOS Safari does not reliably read the manifest's `name` for the
    // home-screen label — this is what actually controls it there.
    appleWebApp: {
      capable: true,
      title: `${displayName} Dashboard`,
      statusBarStyle: "default",
    },
    icons: {
      apple: profile.avatar_url || "/apple-touch-icon.png",
    },
  };
}

export async function generateViewport(): Promise<Viewport> {
  const profile = await getViewerProfile();
  return {
    themeColor: profile?.theme_color || "#4F46E5",
  };
}
