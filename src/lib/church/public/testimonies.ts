// Churches & Ministries: what the PUBLIC page may show of Testimonies. Pure helpers plus a fail-safe loader. No React.
//
// The ONLY way a visitor's session reads testimonies is the database function ministry_testimonies_public(): it recomputes, on every call, that the testimony is approved AND published AND that its
// submitter consented to publication, and it returns the name only when name consent is held. It returns no phone number, group, note or status. This file re-checks the shape of what it receives
// (so a mistake there could not put an odd value on a page) and takes nothing else from the database. There is no table access for visitors at all.

export interface PublicTestimony {
  id: string;
  /** null unless the submitter agreed to be named. */
  display_name: string | null;
  body: string;
  lang: "en" | "fr";
}

export const PUBLIC_TESTIMONY_LIMIT = 12;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The testimonies to show, in the order received, at most `limit`. Only these four fields are ever kept, whatever else the row carried. */
export function shapePublicTestimonies(rows: unknown, limit: number = PUBLIC_TESTIMONY_LIMIT): PublicTestimony[] {
  if (!Array.isArray(rows)) return [];
  const out: PublicTestimony[] = [];
  for (const r of rows as Record<string, unknown>[]) {
    if (!r || typeof r !== "object") continue;
    if (typeof r.id !== "string" || !UUID.test(r.id)) continue;
    if (typeof r.body !== "string" || r.body.trim() === "") continue;
    const name = typeof r.display_name === "string" && r.display_name.trim() !== "" ? r.display_name.trim().slice(0, 120) : null;
    out.push({ id: r.id, display_name: name, body: r.body.slice(0, 3000), lang: r.lang === "fr" ? "fr" : "en" });
  }
  return out.slice(0, limit);
}

type Reader = { rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: any; error: any }> };

/** The published, consented testimonies of one church for its PUBLIC page. FAIL-SAFE: any error gives []. */
export async function loadPublicTestimonies(supabase: Reader, profileId: string): Promise<PublicTestimony[]> {
  try {
    const { data, error } = await supabase.rpc("ministry_testimonies_public", { p_profile_id: profileId });
    if (error) return [];
    return shapePublicTestimonies(data);
  } catch {
    return [];
  }
}
