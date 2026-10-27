// Churches & Ministries: what the PUBLIC page may show of Care & Support cases (Phase 9). Pure helpers plus a fail-safe loader. No React.
//
// A visitor sees ONLY a case the church published, and the database publishes a case only while the beneficiary's consent is recorded and granted: the public read policy requires it, a check constraint
// repeats it, and withdrawing consent turns the case back into a private draft in the same statement. This file re-checks `status = published` on what it receives. It never selects the consent state
// (anon has no privilege on it), the person the case is for (a staff-only table), or any audit column, and there is no amount, target or contribution: nothing here collects or shows money.

import { pictureOf } from "../images";
import { resolveLanguage, type PublicLang } from "./events";

export const CARE_CATEGORY_IDS = ["medical", "education", "bereavement", "housing", "food", "other"] as const;
export type CareCategoryId = (typeof CARE_CATEGORY_IDS)[number];

export interface PublicCareCase {
  id: string;
  category: CareCategoryId;
  title_en: string | null;
  title_fr: string | null;
  summary_en: string | null;
  summary_fr: string | null;
  /** An optional picture. It can only exist with the person's recorded agreement (the database refuses it otherwise) and goes when the case's consent is withdrawn. Absent when there is none. */
  image_url?: string | null;
}

export const PUBLIC_CARE_COLUMNS = "id, status, category, title_en, title_fr, summary_en, summary_fr, published_at";
export const PUBLIC_CARE_IMAGE_COLUMNS = `${PUBLIC_CARE_COLUMNS}, image_url`;
export const PUBLIC_CARE_LIMIT = 6;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() !== "" ? v.slice(0, max) : null);

export const isCareReadable = (c: PublicCareCase, lang: PublicLang): boolean => !!c[`title_${lang}`] && !!c[`summary_${lang}`];
export { resolveLanguage };

/** The cases to show, in the order received, at most `limit`. A draft, an unknown category, an unreadable case and a malformed row are dropped. */
export function shapePublicCare(rows: unknown, limit: number = PUBLIC_CARE_LIMIT): PublicCareCase[] {
  if (!Array.isArray(rows)) return [];
  const out: PublicCareCase[] = [];
  for (const r of rows as Record<string, unknown>[]) {
    if (!r || typeof r !== "object") continue;
    if (typeof r.id !== "string" || !UUID.test(r.id)) continue;
    if (r.status !== "published") continue; // defence in depth: a draft is never shown (and without this field the row is refused)
    if (typeof r.category !== "string" || !(CARE_CATEGORY_IDS as readonly string[]).includes(r.category)) continue;
    const c: PublicCareCase = { id: r.id, category: r.category as CareCategoryId, title_en: text(r.title_en, 120), title_fr: text(r.title_fr, 120), summary_en: text(r.summary_en, 2000), summary_fr: text(r.summary_fr, 2000), ...pictureOf(r) };
    if (!isCareReadable(c, "en") && !isCareReadable(c, "fr")) continue;
    out.push(c);
  }
  return out.slice(0, limit);
}

type Reader = { from(table: string): any };

/** The published cases of one church for its PUBLIC page. Uses the visitor's own session: the database's public policy decides which rows exist. FAIL-SAFE: any error gives []. */
export async function loadPublicCare(supabase: Reader, profileId: string, limit: number = PUBLIC_CARE_LIMIT): Promise<PublicCareCase[]> {
  try {
    const run = (cols: string) => supabase.from("ministry_care_cases").select(cols).eq("profile_id", profileId).eq("status", "published").order("published_at", { ascending: false }).limit(limit);
    let { data, error } = await run(PUBLIC_CARE_IMAGE_COLUMNS);
    if (error) ({ data, error } = await run(PUBLIC_CARE_COLUMNS)); // no picture column yet: ask again without it
    if (error) return [];
    return shapePublicCare(data, limit);
  } catch {
    return [];
  }
}
