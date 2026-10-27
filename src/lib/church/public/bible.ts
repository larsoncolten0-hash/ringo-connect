// Churches & Ministries: what the PUBLIC page may show of the Bible programmes (Phase 5). Pure helpers plus a fail-safe loader. No React.
//
// A visitor sees only a PUBLISHED programme of a published church page: its title, description and how many days it has. The days themselves (titles and scripture references) are public content too, but
// they are read on the programme's own page, behind the visitor's My Ringo account, together with their private progress. Nothing about who follows a programme is ever selected here.

import { resolveLanguage, type PublicLang } from "./events";

export interface PublicProgram {
  id: string;
  title_en: string | null;
  title_fr: string | null;
  description_en: string | null;
  description_fr: string | null;
  session_count: number;
}

export const PUBLIC_PROGRAM_COLUMNS = "id, title_en, title_fr, description_en, description_fr";
export const PUBLIC_PROGRAM_LIMIT = 6;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() !== "" ? v.slice(0, max) : null);

export const isProgramReadable = (p: PublicProgram, lang: PublicLang): boolean => !!p[`title_${lang}`];
export { resolveLanguage };

/** Published programmes that have at least one day and a readable title, in the order received, at most `limit`. A draft, an empty programme and a malformed row are dropped. */
export function shapePublicPrograms(rows: unknown, counts: Map<string, number> | Record<string, number> = {}, limit: number = PUBLIC_PROGRAM_LIMIT): PublicProgram[] {
  if (!Array.isArray(rows)) return [];
  const count = (id: string) => (counts instanceof Map ? counts.get(id) : (counts as Record<string, number>)[id]) ?? 0;
  const out: PublicProgram[] = [];
  for (const r of rows as Record<string, unknown>[]) {
    if (!r || typeof r !== "object") continue;
    if (typeof r.id !== "string" || !UUID.test(r.id)) continue;
    if (r.status !== undefined && r.status !== "published") continue; // defence in depth: a draft is never shown
    const p: PublicProgram = {
      id: r.id,
      title_en: text(r.title_en, 120), title_fr: text(r.title_fr, 120),
      description_en: text(r.description_en, 2000), description_fr: text(r.description_fr, 2000),
      session_count: Math.max(0, Math.floor(count(r.id))),
    };
    if (p.session_count < 1) continue;
    if (!isProgramReadable(p, "en") && !isProgramReadable(p, "fr")) continue;
    out.push(p);
  }
  return out.slice(0, limit);
}

type Reader = { from(table: string): any };

/** The published programmes of one church for its PUBLIC page. Uses the visitor's own session: the database's public policy decides which rows exist. FAIL-SAFE: any error gives []. */
export async function loadPublicPrograms(supabase: Reader, profileId: string, limit: number = PUBLIC_PROGRAM_LIMIT): Promise<PublicProgram[]> {
  try {
    const { data, error } = await supabase.from("bible_programs").select(PUBLIC_PROGRAM_COLUMNS).eq("profile_id", profileId).eq("status", "published").order("published_at", { ascending: false }).limit(limit);
    if (error || !Array.isArray(data) || data.length === 0) return [];
    const ids = (data as { id: string }[]).map((r) => r.id);
    const { data: sessions, error: e2 } = await supabase.from("bible_program_sessions").select("program_id").in("program_id", ids).limit(5000);
    if (e2) return [];
    const counts = new Map<string, number>();
    for (const s of (sessions as { program_id: string }[]) || []) counts.set(s.program_id, (counts.get(s.program_id) ?? 0) + 1);
    return shapePublicPrograms(data, counts, limit);
  } catch {
    return [];
  }
}
