// Churches & Ministries: what the PUBLIC page may show of Church Music (Phase 8). Pure helpers plus a fail-safe loader. No React.
//
// A visitor sees only the VISIBLE links of a published church page: the label the church chose, the platform, and the address. Every link is re-checked here (secure address, belongs to its platform)
// so a row that somehow violates the rule is dropped rather than shown. Nothing is played, downloaded or sold on the church page: each link opens the platform in a new tab.

import { safeHttpsUrl } from "../lifecycle/validation";
import { MUSIC_PLATFORM_IDS, urlMatchesPlatform } from "../music/platforms";

export interface PublicMusicLink {
  id: string;
  platform: string;
  title: string;
  url: string;
}

export const PUBLIC_MUSIC_COLUMNS = "id, platform, title, url";
export const PUBLIC_MUSIC_LIMIT = 20;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The links to show, in the order received, at most `limit`. A hidden link, an unknown platform, an unsafe address, a mismatched one and a malformed row are dropped. */
export function shapePublicMusic(rows: unknown, limit: number = PUBLIC_MUSIC_LIMIT): PublicMusicLink[] {
  if (!Array.isArray(rows)) return [];
  const out: PublicMusicLink[] = [];
  const seen = new Set<string>();
  for (const r of rows as Record<string, unknown>[]) {
    if (!r || typeof r !== "object") continue;
    if (typeof r.id !== "string" || !UUID.test(r.id)) continue;
    if (r.is_visible !== undefined && r.is_visible !== true) continue; // defence in depth: a hidden link is never shown
    if (typeof r.platform !== "string" || !MUSIC_PLATFORM_IDS.includes(r.platform)) continue;
    const title = typeof r.title === "string" ? r.title.trim().slice(0, 80) : "";
    if (!title) continue;
    const url = safeHttpsUrl(r.url);
    if (!url || !urlMatchesPlatform(r.platform, url)) continue;
    if (seen.has(url.toLowerCase())) continue;
    seen.add(url.toLowerCase());
    out.push({ id: r.id, platform: r.platform, title, url });
  }
  return out.slice(0, limit);
}

type Reader = { from(table: string): any };

/** The visible links of one church for its PUBLIC page. Uses the visitor's own session: the database's public policy decides which rows exist. FAIL-SAFE: any error gives []. */
export async function loadPublicMusic(supabase: Reader, profileId: string): Promise<PublicMusicLink[]> {
  try {
    const { data, error } = await supabase.from("ministry_music_links").select(PUBLIC_MUSIC_COLUMNS).eq("profile_id", profileId).eq("is_visible", true).order("sort_order", { ascending: true }).order("created_at", { ascending: true }).limit(PUBLIC_MUSIC_LIMIT);
    if (error) return [];
    return shapePublicMusic(data);
  } catch {
    return [];
  }
}
