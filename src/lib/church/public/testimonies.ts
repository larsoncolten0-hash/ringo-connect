// Churches & Ministries: what the PUBLIC page may show of Testimonies. Pure helpers plus a fail-safe loader. No React.
//
// The ONLY way a visitor's session reads testimonies is the database function ministry_testimonies_public(): it recomputes, on every call, that the testimony is approved AND published AND that its
// submitter consented to publication, and it returns the name only when name consent is held. It returns no phone number, group, note or status. This file re-checks the shape of what it receives
// (so a mistake there could not put an odd value on a page) and takes nothing else from the database. There is no table access for visitors at all.

import { churchWeekStartMs } from "@/lib/church/week";

export interface PublicTestimony {
  id: string;
  /** null unless the submitter agreed to be named. */
  display_name: string | null;
  body: string;
  lang: "en" | "fr";
}

export const PUBLIC_TESTIMONY_LIMIT = 12;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The testimonies to show, in the order received, at most `limit`. Only these four fields are ever kept, whatever else the row carried.
 *  With `sinceMs` (the public page passes the start of the current church week) a testimony whose `published_at` is earlier, missing or not a real time is dropped: testimonies stay on the page for
 *  one week, Monday to Sunday, and leave it by themselves on Monday at 00:00 Cameroon time. The timestamp is only used to decide; it is never part of what is returned. */
export function shapePublicTestimonies(rows: unknown, limit: number = PUBLIC_TESTIMONY_LIMIT, sinceMs?: number): PublicTestimony[] {
  if (!Array.isArray(rows)) return [];
  const out: PublicTestimony[] = [];
  for (const r of rows as Record<string, unknown>[]) {
    if (!r || typeof r !== "object") continue;
    if (typeof r.id !== "string" || !UUID.test(r.id)) continue;
    if (typeof r.body !== "string" || r.body.trim() === "") continue;
    if (sinceMs !== undefined) {
      const at = typeof r.published_at === "string" ? Date.parse(r.published_at) : NaN;
      if (!Number.isFinite(at) || at < sinceMs) continue; // fail closed: without a publication time the week cannot be checked
    }
    const name = typeof r.display_name === "string" && r.display_name.trim() !== "" ? r.display_name.trim().slice(0, 120) : null;
    out.push({ id: r.id, display_name: name, body: r.body.slice(0, 3000), lang: r.lang === "fr" ? "fr" : "en" });
  }
  return out.slice(0, limit);
}

type Reader = { rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: any; error: any }> };

/** How many testimonies the "all of this week" landing page reads at most (the database function itself never returns more than 100). */
export const PUBLIC_TESTIMONY_LANDING_LIMIT = 100;

/** The testimonies of this church week for the LANDING page: up to 100 through ministry_testimonies_public_week (the same conditions as the profile's function). While that function is not in the database yet
 *  (the owner applies the SQL after the code is deployed) it falls back to the profile's own newest twelve, so the page works either way. FAIL-SAFE: any error gives []. */
export async function loadPublicTestimoniesWeek(supabase: Reader, profileId: string, now: number = Date.now()): Promise<PublicTestimony[]> {
  const since = churchWeekStartMs(now);
  try {
    const { data, error } = await supabase.rpc("ministry_testimonies_public_week", { p_profile_id: profileId, p_since: new Date(since).toISOString(), p_limit: PUBLIC_TESTIMONY_LANDING_LIMIT });
    if (!error) return shapePublicTestimonies(data, PUBLIC_TESTIMONY_LANDING_LIMIT, since);
  } catch {
    /* fall through to the profile's own function */
  }
  return loadPublicTestimonies(supabase, profileId, now);
}

/** The published, consented testimonies of one church for its PUBLIC page, published since this church week began (Monday 00:00 Cameroon time). FAIL-SAFE: any error gives []. */
export async function loadPublicTestimonies(supabase: Reader, profileId: string, now: number = Date.now()): Promise<PublicTestimony[]> {
  try {
    const { data, error } = await supabase.rpc("ministry_testimonies_public", { p_profile_id: profileId });
    if (error) return [];
    return shapePublicTestimonies(data, PUBLIC_TESTIMONY_LIMIT, churchWeekStartMs(now));
  } catch {
    return [];
  }
}
