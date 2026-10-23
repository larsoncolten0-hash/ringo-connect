// Churches & Ministries Daily Word: what the PUBLIC page may show (Phase 3). Pure helpers plus one fail-safe loader. No React.
//
// Only fields a church chose to publish are ever selected (never the audit columns: no API role can read them). The database already returns only published entries whose date has arrived;
// this file re-checks that on what it receives, so a policy mistake could not put a draft or a future entry on a public page.

export type WordLang = "en" | "fr";

export interface PublicWord {
  id: string;
  publish_on: string;
  title_en: string | null;
  title_fr: string | null;
  scripture_ref_en: string | null;
  scripture_ref_fr: string | null;
  scripture_text_en: string | null;
  scripture_text_fr: string | null;
  body_en: string | null;
  body_fr: string | null;
  prayer_en: string | null;
  prayer_fr: string | null;
}

export const PUBLIC_WORD_COLUMNS =
  "id, publish_on, title_en, title_fr, scripture_ref_en, scripture_ref_fr, scripture_text_en, scripture_text_fr, body_en, body_fr, prayer_en, prayer_fr";

/** How many words a public page carries: today's (the latest) and a few earlier ones. */
export const PUBLIC_WORD_LIMIT = 7;

/** Today's date in Africa/Douala (UTC+1, no daylight saving), YYYY-MM-DD. The database computes the same value (daily_word_today). */
export const doualaDate = (now: number = Date.now()): string => new Date(now + 3600_000).toISOString().slice(0, 10);

const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() !== "" ? v.slice(0, max) : null);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isLangComplete = (w: PublicWord, lang: WordLang): boolean => !!w[`title_${lang}`] && !!w[`body_${lang}`];

/** The language to show a word in: the visitor's own when it is complete, otherwise the other one (flagged as a fallback), otherwise null (nothing readable: the word is not shown). */
export function resolveWordLanguage(w: PublicWord, preferred: WordLang): { lang: WordLang; fallback: boolean } | null {
  if (isLangComplete(w, preferred)) return { lang: preferred, fallback: false };
  const other: WordLang = preferred === "en" ? "fr" : "en";
  if (isLangComplete(w, other)) return { lang: other, fallback: true };
  return null;
}

/** Cleans whatever the database returned into at most `limit` showable words, newest first, never one dated after `today`. */
export function shapePublicWords(rows: unknown, today: string = doualaDate(), limit: number = PUBLIC_WORD_LIMIT): PublicWord[] {
  if (!Array.isArray(rows)) return [];
  const out: PublicWord[] = [];
  for (const r of rows as Record<string, unknown>[]) {
    if (!r || typeof r !== "object") continue;
    if (typeof r.id !== "string" || !UUID.test(r.id) || typeof r.publish_on !== "string" || !ISO_DAY.test(r.publish_on) || r.publish_on > today) continue;
    if (r.status !== undefined && r.status !== "published") continue; // defence in depth: a draft is never shown
    const w: PublicWord = {
      id: r.id,
      publish_on: r.publish_on,
      title_en: text(r.title_en, 120), title_fr: text(r.title_fr, 120),
      scripture_ref_en: text(r.scripture_ref_en, 120), scripture_ref_fr: text(r.scripture_ref_fr, 120),
      scripture_text_en: text(r.scripture_text_en, 1000), scripture_text_fr: text(r.scripture_text_fr, 1000),
      body_en: text(r.body_en, 4000), body_fr: text(r.body_fr, 4000),
      prayer_en: text(r.prayer_en, 1000), prayer_fr: text(r.prayer_fr, 1000),
    };
    if (!isLangComplete(w, "en") && !isLangComplete(w, "fr")) continue;
    out.push(w);
  }
  return out.sort((a, b) => (a.publish_on < b.publish_on ? 1 : a.publish_on > b.publish_on ? -1 : 0)).slice(0, limit);
}

/** The slice of a Supabase client the loader needs (structural, so a test can hand it a database-backed double). */
type Reader = { from(table: string): any };

/**
 * The published Daily Words of one church for its PUBLIC page, newest first. Uses the visitor's own (anonymous or signed-in) session: the database's public policy decides which rows exist for
 * them. FAIL-SAFE: any error (including the table not existing yet) gives an empty list, so a church page can never break because of this feature.
 */
export async function loadPublicWords(supabase: Reader, profileId: string, now: number = Date.now()): Promise<PublicWord[]> {
  try {
    const today = doualaDate(now);
    const { data, error } = await supabase
      .from("daily_words")
      .select(PUBLIC_WORD_COLUMNS)
      .eq("profile_id", profileId)
      .eq("status", "published")
      .lte("publish_on", today)
      .order("publish_on", { ascending: false })
      .limit(PUBLIC_WORD_LIMIT);
    if (error) return [];
    return shapePublicWords(data, today);
  } catch {
    return [];
  }
}
