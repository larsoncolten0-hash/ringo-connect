import type { Metadata, ResolvingMetadata } from "next";
import type { Viewport } from "next";
import { createClient } from "@/lib/supabase/server";

// Shared by every public profile route ([username], r/[username],
// m/[username] — all three use "username" as their dynamic segment name)
// so the per-profile PWA installability (manifest link, iOS home-screen
// name/icon, theme color) and page title/description are defined once
// instead of three times. Re-exported directly as `generateMetadata`/
// `generateViewport` from each page — see those files.
//
// Deliberately a lightweight, standalone query (just the handful of
// fields actually needed here) rather than reusing each page's own
// heavier profile fetch — generateMetadata runs as a separate pass from
// the page component, so there's no way to share the result anyway.
async function getProfileForMetadata(username: string) {
  const supabase = createClient();
  const { data } = await supabase
    .from("profiles")
    .select("name, username, avatar_url, bio, theme_color, category")
    .eq("username", username)
    .eq("published", true)
    .single();
  return data;
}

export async function generateMetadata(
  { params }: { params: { username: string } },
  _parent: ResolvingMetadata
): Promise<Metadata> {
  const profile = await getProfileForMetadata(params.username);
  if (!profile) return {};

  const displayName = profile.name || profile.username;

  return {
    title: `${displayName} | Ringo Connect`,
    description: profile.bio || `${displayName}'s Ringo Connect profile.`,
    // Powers the browser's "Add to Home Screen"/install prompt on
    // Android/Chrome — see the route handler at
    // src/app/[username]/manifest.webmanifest/route.ts (same pattern
    // applies under r/ and m/, which point at the same handler's logic
    // via their own username segment).
    manifest: `/${profile.username}/manifest.webmanifest`,
    // iOS Safari does not reliably read the manifest's `name` for the
    // home-screen label — this is what actually controls it there.
    appleWebApp: {
      capable: true,
      title: displayName,
      statusBarStyle: "default",
    },
    icons: {
      apple: profile.avatar_url || "/apple-touch-icon.png",
    },
  };
}

export async function generateViewport({ params }: { params: { username: string } }): Promise<Viewport> {
  const profile = await getProfileForMetadata(params.username);
  return {
    themeColor: profile?.theme_color || "#4F46E5",
  };
}
