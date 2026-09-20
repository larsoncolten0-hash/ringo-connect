import { profileHasCategory, profileHasTicketing } from "@/lib/categories";

// ONE place that knows where each kind of thing a creator adds lives on the public site, so a
// share button, a community announcement, an email or a push notification can all link straight
// to that exact item instead of the profile page. Pure functions, safe on server and client.
//
//   product   -> its own detail page (merch / catalog / service card):
//                /m/<u>/merch/<id> for Music & Entertainment, /<u>/item/<id> for every other category
//   track     -> /m/<u>/track/<id>       (Music & Entertainment, Events & Experiences)
//   release   -> /m/<u>/release/<id>     (EP / Album)
//   event     -> /m/<u>/ticket/<id>      (concert / event tickets)
//   menu_item -> /r/<u>/item/<id>        (restaurant menu item)
//   service   -> /<u>/book?service=<id>  (booking form with that service already chosen)
//
// When a kind doesn't apply to the profile's category (e.g. a track on a restaurant), the link
// falls back to the profile page rather than a page that would 404.

export type ShareableKind = "product" | "track" | "release" | "event" | "menu_item" | "service";

type ProfileLike = { username: string; category?: string | null; categories?: string[] | null };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isShareableId(id: unknown): id is string {
  return typeof id === "string" && UUID_RE.test(id);
}

/** Root-relative path to the item (or the profile page when the kind doesn't apply). */
export function itemPath(profile: ProfileLike, kind: ShareableKind, id: string): string {
  const u = profile.username;
  switch (kind) {
    case "product":
      return profileHasCategory(profile, "music_entertainment") ? `/m/${u}/merch/${id}` : `/${u}/item/${id}`;
    case "track":
      return profileHasTicketing(profile) ? `/m/${u}/track/${id}` : `/${u}`;
    case "release":
      return profileHasTicketing(profile) ? `/m/${u}/release/${id}` : `/${u}`;
    case "event":
      return profileHasTicketing(profile) ? `/m/${u}/ticket/${id}` : `/${u}`;
    case "menu_item":
      return profileHasCategory(profile, "restaurant_food") ? `/r/${u}/item/${id}` : `/${u}`;
    case "service":
      return `/${u}/book?service=${id}`;
  }
}

export function siteBase(siteUrl?: string | null): string {
  return (siteUrl || process.env.NEXT_PUBLIC_SITE_URL || "https://ringoconnectltd.com").replace(/\/$/, "");
}

/** Absolute, shareable URL for the item. */
export function itemUrl(profile: ProfileLike, kind: ShareableKind, id: string, siteUrl?: string | null): string {
  return `${siteBase(siteUrl)}${itemPath(profile, kind, id)}`;
}
