import type { ChurchActor } from "../actor";
import { classifyDbError, failure } from "../errors";
import type { Result } from "../handlers";
import { isTimestamp } from "../lifecycle/validation";
import { has, isUuid, optionalText, plainObject } from "../validation";
import { isValidTimezone, normalizeTime } from "./occurrences";

// Churches & Ministries Recurring Weekly Services: everything behind /api/church/services/**. Same rules as the other church handlers:
//   * the church is always actor.profileId (server-resolved), never read from a request;
//   * every query goes through the user's own session, so row-level security and the guard trigger are the authority; the checks written here only answer earlier and more clearly;
//   * a write that row-level security filters away raises no error, it touches zero rows: every update asks for the affected rows back and reports a refusal, never a success;
//   * a failure is returned as a short code, never as the database's own message.
// A weekly service is a RULE (weekday + local times + the church's own timezone), stored once. No dated copy is ever written here. Removing a service ARCHIVES it: the row (and whatever will
// later attach to it, such as attendance) is kept, and no API role can delete it.
// Reading needs church.events.view (or manage / publish); writing needs church.events.publish, because an enabled service is public at once.

const ok = (body: Record<string, unknown> = {}, status = 200): Result => ({ status, body: { ok: true, ...body } });
const fail = (status: number, code: string, field?: string): Result => failure(status, code, field);
const fromDb = (error: unknown): Result => {
  const o = classifyDbError(error as any);
  if (o.status >= 500) console.error(JSON.stringify({ scope: "church_services", result: "db_error", code: String((error as any)?.code || "") }));
  return fail(o.status, o.code);
};
const newId = (): string => globalThis.crypto.randomUUID();
const sameInstant = (a: unknown, b: unknown) => Date.parse(String(a)) === Date.parse(String(b));

type Row = Record<string, any>;

export const SERVICE_LIMIT = 30;
export const SERVICE_TITLE_MAX = 80;
export const SERVICE_DESCRIPTION_MAX = 400;
export const SERVICE_LOCATION_MAX = 160;

export interface ServiceInput {
  title_en?: string | null;
  title_fr?: string | null;
  description_en?: string | null;
  description_fr?: string | null;
  location?: string | null;
  weekday?: number;
  start_time?: string;
  end_time?: string;
  timezone?: string;
  is_enabled?: boolean;
  archived?: boolean;
  expected_updated_at?: string;
}
type Checked = { ok: true; value: ServiceInput } | { ok: false; code: string; field?: string };

const TEXT_FIELDS: [keyof ServiceInput, number][] = [
  ["title_en", SERVICE_TITLE_MAX],
  ["title_fr", SERVICE_TITLE_MAX],
  ["description_en", SERVICE_DESCRIPTION_MAX],
  ["description_fr", SERVICE_DESCRIPTION_MAX],
  ["location", SERVICE_LOCATION_MAX],
];

export function parseServiceBody(body: unknown, mode: "create" | "update"): Checked {
  const o = plainObject(body, ["title_en", "title_fr", "description_en", "description_fr", "location", "weekday", "start_time", "end_time", "timezone", "is_enabled", ...(mode === "update" ? ["archived", "expected_updated_at"] : [])]);
  if (!o.ok) return o;
  const b = o.value;
  const out: ServiceInput = {};
  for (const [field, max] of TEXT_FIELDS) {
    if (!has(b, field)) continue;
    const t = optionalText(b[field], field, max);
    if (!t.ok) return t;
    (out as Record<string, unknown>)[field] = t.value;
  }
  if (has(b, "weekday") || mode === "create") {
    if (typeof b.weekday !== "number" || !Number.isInteger(b.weekday) || b.weekday < 0 || b.weekday > 6) return { ok: false, code: "invalid_weekday", field: "weekday" };
    out.weekday = b.weekday;
  }
  for (const field of ["start_time", "end_time"] as const) {
    if (!has(b, field) && mode !== "create") continue;
    const t = normalizeTime(b[field]);
    if (!t) return { ok: false, code: "invalid_time", field };
    out[field] = t;
  }
  if (has(b, "timezone") || mode === "create") {
    if (!isValidTimezone(b.timezone)) return { ok: false, code: "invalid_timezone", field: "timezone" };
    out.timezone = b.timezone as string;
  }
  if (has(b, "is_enabled")) {
    if (typeof b.is_enabled !== "boolean") return { ok: false, code: "invalid_body", field: "is_enabled" };
    out.is_enabled = b.is_enabled;
  }
  if (has(b, "archived")) {
    if (b.archived !== true) return { ok: false, code: "invalid_body", field: "archived" }; // archiving is one-way here; there is no "un-archive" through this API
    out.archived = true;
  }
  if (has(b, "expected_updated_at")) {
    if (!isTimestamp(b.expected_updated_at)) return { ok: false, code: "invalid_body", field: "expected_updated_at" };
    out.expected_updated_at = b.expected_updated_at;
  }
  if (mode === "create") {
    if (!out.title_en && !out.title_fr) return { ok: false, code: "needs_title", field: "title_en" };
    if ((out.start_time as string) >= (out.end_time as string)) return { ok: false, code: "invalid_time_range", field: "end_time" };
  }
  if (mode === "update" && Object.keys(out).filter((k) => k !== "expected_updated_at").length === 0) return { ok: false, code: "empty_update" };
  return { ok: true, value: out };
}

const COLUMNS = "id, title_en, title_fr, description_en, description_fr, location, weekday, start_time, end_time, timezone, is_enabled, updated_at";
export function shapeService(r: Row) {
  return {
    id: r.id,
    title_en: r.title_en ?? null,
    title_fr: r.title_fr ?? null,
    description_en: r.description_en ?? null,
    description_fr: r.description_fr ?? null,
    location: r.location ?? null,
    weekday: r.weekday,
    start_time: normalizeTime(r.start_time) ?? "00:00",
    end_time: normalizeTime(r.end_time) ?? "00:00",
    timezone: r.timezone,
    is_enabled: r.is_enabled === true,
    updated_at: r.updated_at,
  };
}

export async function listServices(a: ChurchActor, params: URLSearchParams): Promise<Result> {
  if (!a.caps.viewEvents) return fail(403, "forbidden");
  for (const k of Array.from(params.keys())) return fail(400, "unexpected_field", k);
  const { data, error } = await a.supabase
    .from("church_service_schedule")
    .select(COLUMNS)
    .eq("profile_id", a.profileId)
    .is("archived_at", null)
    .order("weekday", { ascending: true })
    .order("start_time", { ascending: true })
    .limit(SERVICE_LIMIT + 1);
  if (error) return fromDb(error);
  return ok({ items: ((data as Row[]) || []).map(shapeService), limit: SERVICE_LIMIT, can_edit: a.caps.publishEvents });
}

const canWrite = (a: ChurchActor) => a.kind !== "leader" && a.caps.publishEvents;

export async function createService(a: ChurchActor, body: unknown): Promise<Result> {
  if (!canWrite(a)) return fail(403, "forbidden");
  const parsed = parseServiceBody(body, "create");
  if (!parsed.ok) return fail(400, parsed.code, parsed.field);
  const v = parsed.value;
  const { data, error } = await a.supabase
    .from("church_service_schedule")
    .insert({
      id: newId(),
      profile_id: a.profileId,
      title_en: v.title_en ?? null,
      title_fr: v.title_fr ?? null,
      description_en: v.description_en ?? null,
      description_fr: v.description_fr ?? null,
      location: v.location ?? null,
      weekday: v.weekday,
      start_time: v.start_time,
      end_time: v.end_time,
      timezone: v.timezone,
      is_enabled: v.is_enabled ?? true,
    })
    .select(COLUMNS);
  if (error) return fromDb(error);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return fail(403, "forbidden");
  return ok({ item: shapeService(row as Row) }, 201);
}

async function readOne(a: ChurchActor, id: string) {
  const { data, error } = await a.supabase.from("church_service_schedule").select("id, title_en, title_fr, start_time, end_time, updated_at, archived_at").eq("id", id).eq("profile_id", a.profileId).maybeSingle();
  return { row: (data as Row | null) ?? null, error };
}

export async function updateService(a: ChurchActor, id: string, body: unknown): Promise<Result> {
  if (!isUuid(id)) return fail(404, "not_found");
  if (!canWrite(a)) return fail(403, "forbidden");
  const parsed = parseServiceBody(body, "update");
  if (!parsed.ok) return fail(400, parsed.code, parsed.field);
  const { expected_updated_at: expected, archived, ...rest } = parsed.value;
  if (!expected) return fail(400, "invalid_body", "expected_updated_at");
  const cur = await readOne(a, id);
  if (cur.error) return fromDb(cur.error);
  if (!cur.row || cur.row.archived_at) return fail(404, "not_found");
  if (!sameInstant(expected, cur.row.updated_at)) return fail(409, "stale");
  // the pair that will be stored must still make sense: a title in one language at least, and an end after the start
  const title = has(rest, "title_en") || has(rest, "title_fr") ? { en: has(rest, "title_en") ? rest.title_en : cur.row.title_en, fr: has(rest, "title_fr") ? rest.title_fr : cur.row.title_fr } : null;
  if (title && !title.en && !title.fr) return fail(400, "needs_title", "title_en");
  const start = (rest.start_time ?? normalizeTime(cur.row.start_time)) as string;
  const end = (rest.end_time ?? normalizeTime(cur.row.end_time)) as string;
  if (start >= end) return fail(400, "invalid_time_range", "end_time");
  const changes: Record<string, unknown> = { ...rest };
  if (archived) changes.archived_at = new Date().toISOString();
  const { data, error } = await a.supabase.from("church_service_schedule").update(changes).eq("id", id).eq("profile_id", a.profileId).eq("updated_at", cur.row.updated_at).select(COLUMNS);
  if (error) return fromDb(error);
  if (!Array.isArray(data) || data.length === 0) {
    const again = await readOne(a, id);
    return again.row && !sameInstant(again.row.updated_at, cur.row.updated_at) ? fail(409, "stale") : fail(403, "forbidden");
  }
  return ok({ item: shapeService(data[0] as Row) });
}

/** "Remove" a service: it is archived (kept for ever, no longer shown or editable), never deleted. */
export async function archiveService(a: ChurchActor, id: string, params: URLSearchParams): Promise<Result> {
  if (!isUuid(id)) return fail(404, "not_found");
  if (!canWrite(a)) return fail(403, "forbidden");
  for (const k of Array.from(params.keys())) if (k !== "expected_updated_at") return fail(400, "unexpected_field", k);
  const expected = params.get("expected_updated_at");
  if (!isTimestamp(expected)) return fail(400, "invalid_body", "expected_updated_at");
  return updateService(a, id, { archived: true, expected_updated_at: expected });
}
