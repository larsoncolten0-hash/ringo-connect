// Churches & Ministries: what the PUBLIC page may show of the Events and Announcements (Phase 4). Pure helpers plus fail-safe loaders. No React.
//
// Only fields a church chose to publish are ever selected (never the audit columns: no API role can read them). The database already returns only published entries of a published profile (and,
// for announcements, only those not past their last day); this file re-checks that on what it receives, so a policy mistake could not put a draft, an expired notice or an unsafe link on a public
// page. Any failure while loading gives an empty list: a church page can never break because of this feature.

import { safeHttpsUrl } from "../lifecycle/validation";
import { pictureOf } from "../images";
import { doualaDate } from "../content/publicWord";
import { endOfChurchWeek } from "../week";

export type PublicLang = "en" | "fr";

export interface PublicEvent {
  id: string;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  title_en: string | null;
  title_fr: string | null;
  description_en: string | null;
  description_fr: string | null;
  venue: string | null;
  address: string | null;
  online_url: string | null;
  is_cancelled: boolean;
  /** An optional picture, only ever an address in this platform's own storage (lib/church/images.ts). Absent when there is none. */
  image_url?: string | null;
}
export interface PublicAnnouncement {
  id: string;
  title_en: string | null;
  title_fr: string | null;
  body_en: string | null;
  body_fr: string | null;
  expires_on: string | null;
  image_url?: string | null;
}

// The columns WITH the picture are tried first; a database that has not got the picture column yet (the migration is applied after the code is deployed) answers with an error, and the loaders then ask again without it.
export const PUBLIC_EVENT_COLUMNS = "id, event_date, start_time, end_time, title_en, title_fr, description_en, description_fr, venue, address, online_url, is_cancelled";
export const PUBLIC_EVENT_IMAGE_COLUMNS = `${PUBLIC_EVENT_COLUMNS}, image_url`;
export const PUBLIC_ANNOUNCEMENT_COLUMNS = "id, title_en, title_fr, body_en, body_fr, expires_on, published_at";
export const PUBLIC_ANNOUNCEMENT_IMAGE_COLUMNS = `${PUBLIC_ANNOUNCEMENT_COLUMNS}, image_url`;
/** How many of each a public page carries. */
export const PUBLIC_EVENT_LIMIT = 8;
export const PUBLIC_ANNOUNCEMENT_LIMIT = 5;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() !== "" ? v.slice(0, max) : null);
const time = (v: unknown): string | null => (typeof v === "string" && HHMM.test(v) ? v.slice(0, 5) : null);

export const isEventReadable = (e: PublicEvent, lang: PublicLang): boolean => !!e[`title_${lang}`];
export const isAnnouncementReadable = (a: PublicAnnouncement, lang: PublicLang): boolean => !!a[`title_${lang}`] && !!a[`body_${lang}`];

/** The language to show an item in: the visitor's own when it is complete, otherwise the other one (flagged as a fallback), otherwise null (nothing readable: it is not shown). */
export function resolveLanguage(ok: (lang: PublicLang) => boolean, preferred: PublicLang): { lang: PublicLang; fallback: boolean } | null {
  if (ok(preferred)) return { lang: preferred, fallback: false };
  const other: PublicLang = preferred === "en" ? "fr" : "en";
  if (ok(other)) return { lang: other, fallback: true };
  return null;
}

/** Upcoming published events (today included), soonest first, at most `limit`. A past event, a draft and an item with no readable title are dropped. */
export function shapePublicEvents(rows: unknown, today: string = doualaDate(), limit: number = PUBLIC_EVENT_LIMIT): PublicEvent[] {
  if (!Array.isArray(rows)) return [];
  const out: PublicEvent[] = [];
  for (const r of rows as Record<string, unknown>[]) {
    if (!r || typeof r !== "object") continue;
    if (typeof r.id !== "string" || !UUID.test(r.id) || typeof r.event_date !== "string" || !ISO_DAY.test(r.event_date) || r.event_date < today) continue;
    if (r.status !== undefined && r.status !== "published") continue; // defence in depth: a draft is never shown
    const e: PublicEvent = {
      id: r.id,
      event_date: r.event_date,
      start_time: time(r.start_time),
      end_time: time(r.end_time),
      title_en: text(r.title_en, 120), title_fr: text(r.title_fr, 120),
      description_en: text(r.description_en, 2000), description_fr: text(r.description_fr, 2000),
      venue: text(r.venue, 160),
      address: text(r.address, 240),
      online_url: safeHttpsUrl(r.online_url), // an unsafe or malformed link is dropped, never shown
      is_cancelled: r.is_cancelled === true,
      ...pictureOf(r),
    };
    if (!isEventReadable(e, "en") && !isEventReadable(e, "fr")) continue;
    out.push(e);
  }
  return out.sort((a, b) => (a.event_date < b.event_date ? -1 : a.event_date > b.event_date ? 1 : (a.start_time ?? "") < (b.start_time ?? "") ? -1 : 1)).slice(0, limit);
}

/** Published announcements not past their last day, newest first (the order they arrive in), at most `limit`. */
export function shapePublicAnnouncements(rows: unknown, today: string = doualaDate(), limit: number = PUBLIC_ANNOUNCEMENT_LIMIT): PublicAnnouncement[] {
  if (!Array.isArray(rows)) return [];
  const out: PublicAnnouncement[] = [];
  for (const r of rows as Record<string, unknown>[]) {
    if (!r || typeof r !== "object") continue;
    if (typeof r.id !== "string" || !UUID.test(r.id)) continue;
    if (r.status !== undefined && r.status !== "published") continue;
    const expires = typeof r.expires_on === "string" && ISO_DAY.test(r.expires_on) ? r.expires_on : null;
    if (r.expires_on != null && expires === null) continue; // a malformed last day: fail closed
    if (expires !== null && expires < today) continue; // past its last day
    const a: PublicAnnouncement = {
      id: r.id,
      title_en: text(r.title_en, 120), title_fr: text(r.title_fr, 120),
      body_en: text(r.body_en, 2000), body_fr: text(r.body_fr, 2000),
      expires_on: expires,
      ...pictureOf(r),
    };
    if (!isAnnouncementReadable(a, "en") && !isAnnouncementReadable(a, "fr")) continue;
    out.push(a);
  }
  return out.slice(0, limit);
}

/** Announcements split into "this week" (their last day is the coming Sunday or earlier) and "ongoing" (a month, a year, or no end). Nothing is dropped or duplicated; the order inside each group is kept. */
export function groupAnnouncements(list: PublicAnnouncement[], today: string = doualaDate()): { thisWeek: PublicAnnouncement[]; ongoing: PublicAnnouncement[] } {
  const end = endOfChurchWeek(today);
  const thisWeek: PublicAnnouncement[] = [];
  const ongoing: PublicAnnouncement[] = [];
  for (const a of list) (end !== null && a.expires_on !== null && a.expires_on <= end ? thisWeek : ongoing).push(a);
  return { thisWeek, ongoing };
}

/** The slice of a Supabase client the loaders need (structural, so a test can hand them a database-backed double). */
type Reader = { from(table: string): any };

/** The published upcoming events of one church for its PUBLIC page. Uses the visitor's own session: the database's public policy decides which rows exist for them. FAIL-SAFE: any error gives []. */
export async function loadPublicEvents(supabase: Reader, profileId: string, now: number = Date.now(), limit: number = PUBLIC_EVENT_LIMIT): Promise<PublicEvent[]> {
  try {
    const today = doualaDate(now);
    const run = (cols: string) =>
      supabase
        .from("ministry_events")
        .select(cols)
        .eq("profile_id", profileId)
        .eq("status", "published")
        .gte("event_date", today)
        .order("event_date", { ascending: true })
        .limit(limit);
    let { data, error } = await run(PUBLIC_EVENT_IMAGE_COLUMNS);
    if (error) ({ data, error } = await run(PUBLIC_EVENT_COLUMNS)); // no picture column yet: ask again without it
    if (error) return [];
    return shapePublicEvents(data, today, limit);
  } catch {
    return [];
  }
}

/** The published, unexpired announcements of one church for its PUBLIC page, newest first. FAIL-SAFE: any error gives []. */
export async function loadPublicAnnouncements(supabase: Reader, profileId: string, now: number = Date.now(), limit: number = PUBLIC_ANNOUNCEMENT_LIMIT): Promise<PublicAnnouncement[]> {
  try {
    const today = doualaDate(now);
    const run = (cols: string) =>
      supabase
        .from("ministry_announcements")
        .select(cols)
        .eq("profile_id", profileId)
        .eq("status", "published")
        .or(`expires_on.is.null,expires_on.gte.${today}`)
        .order("published_at", { ascending: false })
        .limit(limit);
    let { data, error } = await run(PUBLIC_ANNOUNCEMENT_IMAGE_COLUMNS);
    if (error) ({ data, error } = await run(PUBLIC_ANNOUNCEMENT_COLUMNS)); // no picture column yet: ask again without it
    if (error) return [];
    return shapePublicAnnouncements(data, today, limit);
  } catch {
    return [];
  }
}
