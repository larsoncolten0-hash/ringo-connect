import { isPublicProfileSuspended } from "@/lib/publicProfileVisibility";
import type { Metadata, ResolvingMetadata } from "next";
import type { Viewport } from "next";
import { createClient } from "@/lib/supabase/server";
import { memoPerRequest } from "@/lib/requestMemo";
import { buildProfileSeo, NOINDEX, profileDisplayName, safePublicImageUrl } from "@/lib/seo";

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
//
// Memoised PER REQUEST (src/lib/requestMemo.ts): generateMetadata and generateViewport both call this for the same page view (and an item page's own
// generateMetadata calls the shared one again), and each used to run the same query. The result is shared inside one render only, never across visitors.
const getProfileForMetadata = memoPerRequest(async function getProfileForMetadata(username: string) {
  const supabase = createClient();
  // The profile read and the suspension check do not depend on each other (both start from the username), so they run together: the head of every public page used to wait for
  // them one after the other.
  const [{ data }, suspended] = await Promise.all([
    supabase
      .from("profiles")
      .select("name, username, avatar_url, cover_image_url, bio, about_position, about_company, theme_color, category, is_demo")
      .eq("username", username)
      .eq("published", true)
      .single(),
    isPublicProfileSuspended(username),
  ]);
  // A suspended owner's profile is unavailable: no title, description, icons or theme
  // may leak through <head> (this also feeds generateViewport).
  if (data && suspended) return null;
  return data;
});

// The head tags every public profile route shares. `seo` adds the search / social layer (description,
// canonical, Open Graph, Twitter, see lib/seo.ts); it is off for transactional pages (receipts, ticket passes)
// that must not advertise anything.
function buildMetadata(profile: NonNullable<Awaited<ReturnType<typeof getProfileForMetadata>>>, seo: boolean): Metadata {
  const displayName = profileDisplayName(profile);

  return {
    ...(seo
      ? buildProfileSeo(profile)
      : { title: `${displayName} | Ringo Connect` }),
    // Demo accounts (see supabase/migrations/2026-10-13_demo_accounts.sql)
    // render a real-looking live preview so the "try it" experience feels
    // real, but must never actually be discoverable — shared by every
    // public profile route ([username], r/[username], m/[username]).
    ...(profile.is_demo ? { robots: NOINDEX } : {}),
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
      // Same public-image rule as Open Graph / Twitter / JSON-LD (lib/seo.safePublicImageUrl): an unsafe or
      // foreign avatar value never reaches <head>; the stock Apple icon is used instead.
      apple: safePublicImageUrl(profile.avatar_url) || "/apple-touch-icon.png",
    },
  };
}

// Canonical is always the profile's own page (/{username}, no query), including for the secondary
// representations that share this helper (/r/{username} ordering, /m/{username} store).
export async function generateMetadata(
  { params }: { params: { username: string } },
  _parent: ResolvingMetadata
): Promise<Metadata> {
  const profile = await getProfileForMetadata(params.username);
  if (!profile) return {};
  return buildMetadata(profile, true);
}

// Receipts and ticket passes: reachable only by their unguessable link, so they keep the profile's
// title / manifest / icon but advertise nothing (no description, canonical, Open Graph) and ask not to be indexed.
export async function generateNoIndexMetadata(
  { params }: { params: { username: string } },
  _parent: ResolvingMetadata
): Promise<Metadata> {
  const profile = await getProfileForMetadata(params.username);
  return { ...(profile ? buildMetadata(profile, false) : {}), robots: NOINDEX };
}

export async function generateViewport({ params }: { params: { username: string } }): Promise<Viewport> {
  const profile = await getProfileForMetadata(params.username);
  return {
    // Repeats the root layout's zoom-lock fields (see app/layout.tsx's
    // `viewport` export) rather than relying purely on inheritance — this
    // segment is the one actually installed as a PWA, so it can't afford
    // to silently lose them if that merge behavior ever changes.
    width: "device-width",
    initialScale: 1,
    maximumScale: 1,
    userScalable: false,
    viewportFit: "cover",
    themeColor: profile?.theme_color || "#4F46E5",
  };
}
