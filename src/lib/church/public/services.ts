// Churches & Ministries: what the PUBLIC page may show of the weekly service schedule. Pure helpers plus a fail-safe loader. No React.
//
// A visitor receives only the SCHEDULE RULES of enabled, non-archived services of a published church (weekday, local times, timezone, the texts the church wrote). Dated occurrences, countdowns and
// the live / upcoming / ended status are computed in the browser from these rules (lib/church/schedule/occurrences.ts), so the page is cacheable and nothing dated is ever stored.
// Each row is re-checked here, so a row that violates the rules (a bad timezone or time, a disabled or archived service) is dropped, not shown. Any failure gives [] so a church page can never
// break because of this feature (including a database where the table has not been created yet).

import { isValidTimezone, normalizeTime, type ScheduleService } from "../schedule/occurrences";

export interface PublicService extends ScheduleService {
  title_en: string | null;
  title_fr: string | null;
  description_en: string | null;
  description_fr: string | null;
  location: string | null;
}

export const PUBLIC_SERVICE_COLUMNS = "id, title_en, title_fr, description_en, description_fr, location, weekday, start_time, end_time, timezone, is_enabled";
export const PUBLIC_SERVICE_LIMIT = 30;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim().slice(0, max) : null);

/** The services to carry to the page, in weekday then time order. A disabled or archived service, a bad weekday / time / timezone and a service with no title are dropped. */
export function shapePublicServices(rows: unknown, limit: number = PUBLIC_SERVICE_LIMIT): PublicService[] {
  if (!Array.isArray(rows)) return [];
  const out: PublicService[] = [];
  for (const r of rows as Record<string, unknown>[]) {
    if (!r || typeof r !== "object") continue;
    if (typeof r.id !== "string" || !UUID.test(r.id)) continue;
    if (r.is_enabled !== true) continue; // defence in depth: a switched-off service is never shown
    if (r.archived_at !== undefined && r.archived_at !== null) continue; // nor an archived one
    if (typeof r.weekday !== "number" || !Number.isInteger(r.weekday) || r.weekday < 0 || r.weekday > 6) continue;
    const start = normalizeTime(r.start_time);
    const end = normalizeTime(r.end_time);
    if (!start || !end || start >= end) continue;
    if (!isValidTimezone(r.timezone)) continue;
    const s: PublicService = {
      id: r.id,
      weekday: r.weekday,
      start_time: start,
      end_time: end,
      timezone: r.timezone,
      is_enabled: true,
      title_en: text(r.title_en, 80),
      title_fr: text(r.title_fr, 80),
      description_en: text(r.description_en, 400),
      description_fr: text(r.description_fr, 400),
      location: text(r.location, 160),
    };
    if (!s.title_en && !s.title_fr) continue;
    out.push(s);
  }
  return out.sort((a, b) => a.weekday - b.weekday || (a.start_time < b.start_time ? -1 : a.start_time > b.start_time ? 1 : a.id < b.id ? -1 : 1)).slice(0, limit);
}

type Reader = { from(table: string): any };

/** The enabled weekly services of one church for its PUBLIC page. Uses the visitor's own session: the database's public policy decides which rows exist. FAIL-SAFE: any error gives []. */
export async function loadPublicServices(supabase: Reader, profileId: string): Promise<PublicService[]> {
  try {
    const { data, error } = await supabase
      .from("church_service_schedule")
      .select(PUBLIC_SERVICE_COLUMNS)
      .eq("profile_id", profileId)
      .eq("is_enabled", true)
      .is("archived_at", null)
      .order("weekday", { ascending: true })
      .order("start_time", { ascending: true })
      .limit(PUBLIC_SERVICE_LIMIT);
    if (error) return [];
    return shapePublicServices(data);
  } catch {
    return [];
  }
}
