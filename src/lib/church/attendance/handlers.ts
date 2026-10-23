import type { ChurchActor } from "../actor";
import { classifyDbError, failure } from "../errors";
import { todayDouala, type Result } from "../handlers";
import { has, isUuid, plainObject } from "../validation";
import { isTimestamp } from "../lifecycle/validation";

// Churches & Ministries Attendance (Phase 7): everything behind /api/church/attendance/**. Same rules as the other church handlers:
//   * the church is always actor.profileId (server-resolved), never read from a request;
//   * every query goes through the user's own session, so the table's row-level security and guard triggers are the authority; the checks written here only answer earlier and more clearly;
//   * a write that row-level security filters away raises no error, it touches zero rows: every delete / update asks for the affected rows back and reports a refusal, never a success;
//   * a failure is returned as a short code, never as the database's own message.
// Attendance is PRIVATE: it names people. It is recorded against an event of Phase 4 (a published, uncancelled event that has started). Only roster people who may be named are recorded (never a child:
// children and visitors who are not on the roster are counted). Names come from the roster through the caller's OWN roster permission: without People view the screen shows numbers only.

const ok = (body: Record<string, unknown> = {}, status = 200): Result => ({ status, body: { ok: true, ...body } });
const fail = (status: number, code: string, field?: string): Result => failure(status, code, field);
const fromDb = (error: unknown): Result => {
  const o = classifyDbError(error as any);
  if (o.status >= 500) console.error(JSON.stringify({ scope: "church_attendance", result: "db_error", code: String((error as any)?.code || "") }));
  return fail(o.status, o.code);
};
const newId = (): string => globalThis.crypto.randomUUID();
const sameInstant = (a: unknown, b: unknown) => Date.parse(String(a)) === Date.parse(String(b));

export const ATTENDANCE_PAGE_SIZE = 20;
export const MAX_RECORD_BATCH = 100;
export const MAX_COUNT = 100000;
type Row = Record<string, any>;

const EVENT_COLS = "id, event_date, start_time, end_time, title_en, title_fr, venue, is_cancelled, status";
const hhmm = (t: unknown): string | null => (typeof t === "string" && t.length >= 5 ? t.slice(0, 5) : null);
const eventShape = (e: Row) => ({ id: e.id, event_date: e.event_date, start_time: hhmm(e.start_time), end_time: hhmm(e.end_time), title_en: e.title_en, title_fr: e.title_fr, venue: e.venue, is_cancelled: e.is_cancelled === true });

async function readEvent(a: ChurchActor, eventId: string) {
  // a PUBLISHED event of THIS church (published events are public; a draft is never attendable)
  const { data, error } = await a.supabase.from("ministry_events").select(EVENT_COLS).eq("id", eventId).eq("profile_id", a.profileId).eq("status", "published").maybeSingle();
  return { event: (data as Row | null) ?? null, error };
}

/** Parses the list query: only `page` is allowed. */
export function parseAttendanceListQuery(params: URLSearchParams): { ok: true; page: number } | { ok: false; code: string; field?: string } {
  for (const k of Array.from(params.keys())) if (k !== "page") return { ok: false, code: "unexpected_field", field: k };
  const page = params.get("page");
  if (page === null) return { ok: true, page: 1 };
  if (!/^\d{1,4}$/.test(page) || Number(page) < 1 || Number(page) > 2000) return { ok: false, code: "invalid_page", field: "page" };
  return { ok: true, page: Number(page) };
}

/** Body of a record request: exactly one of `member_id` (one person) or `member_ids` (up to 100, for example a whole group). */
export function parseRecordBody(body: unknown): { ok: true; ids: string[] } | { ok: false; code: string; field?: string } {
  const o = plainObject(body, ["member_id", "member_ids"]);
  if (!o.ok) return o;
  const hasOne = has(o.value, "member_id"), hasMany = has(o.value, "member_ids");
  if (hasOne === hasMany) return { ok: false, code: "invalid_body" };
  if (hasOne) return isUuid(o.value.member_id) ? { ok: true, ids: [o.value.member_id as string] } : { ok: false, code: "invalid_member_id", field: "member_id" };
  const list = o.value.member_ids;
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_RECORD_BATCH || !list.every(isUuid)) return { ok: false, code: "invalid_member_ids", field: "member_ids" };
  return { ok: true, ids: Array.from(new Set(list as string[])) };
}

export function parseCountsBody(body: unknown): { ok: true; visitors: number; children: number; expected_updated_at?: string } | { ok: false; code: string; field?: string } {
  const o = plainObject(body, ["visitors", "children", "expected_updated_at"]);
  if (!o.ok) return o;
  for (const f of ["visitors", "children"] as const) {
    const v = o.value[f];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > MAX_COUNT) return { ok: false, code: "invalid_count", field: f };
  }
  if (has(o.value, "expected_updated_at") && !isTimestamp(o.value.expected_updated_at)) return { ok: false, code: "invalid_body", field: "expected_updated_at" };
  return { ok: true, visitors: o.value.visitors as number, children: o.value.children as number, expected_updated_at: o.value.expected_updated_at as string | undefined };
}

export async function listAttendance(a: ChurchActor, params: URLSearchParams): Promise<Result> {
  if (!a.caps.viewAttendance) return fail(403, "forbidden");
  const parsed = parseAttendanceListQuery(params);
  if (!parsed.ok) return fail(400, parsed.code, parsed.field);
  const today = todayDouala();
  const from = (parsed.page - 1) * ATTENDANCE_PAGE_SIZE;
  // events that can have attendance: published and already started (today included), newest first. A cancelled one is listed (it says so) but cannot be recorded.
  const { data, error, count } = await a.supabase
    .from("ministry_events")
    .select(EVENT_COLS, { count: "exact" })
    .eq("profile_id", a.profileId)
    .eq("status", "published")
    .lte("event_date", today)
    .order("event_date", { ascending: false })
    .order("id", { ascending: true })
    .range(from, from + ATTENDANCE_PAGE_SIZE - 1);
  if (error) return fromDb(error);
  const events = (data as Row[]) || [];
  const ids = events.map((e) => e.id);
  const present = new Map<string, number>();
  const counts = new Map<string, Row>();
  if (ids.length > 0) {
    const [cnt, ...heads] = await Promise.all([
      a.supabase.from("ministry_attendance_counts").select("event_id, visitors, children").eq("profile_id", a.profileId).in("event_id", ids),
      ...ids.map((id) => a.supabase.from("ministry_attendance").select("id", { count: "exact", head: true }).eq("profile_id", a.profileId).eq("event_id", id)),
    ]);
    if (cnt.error) return fromDb(cnt.error);
    for (const r of (cnt.data as Row[]) || []) counts.set(r.event_id, r);
    for (let i = 0; i < ids.length; i++) {
      if (heads[i].error) return fromDb(heads[i].error);
      present.set(ids[i], heads[i].count ?? 0);
    }
  }
  const total = typeof count === "number" ? count : events.length;
  return ok({
    today,
    items: events.map((e) => ({ ...eventShape(e), present: present.get(e.id) ?? 0, visitors: counts.get(e.id)?.visitors ?? 0, children: counts.get(e.id)?.children ?? 0, recordable: e.is_cancelled !== true })),
    page: parsed.page,
    pageSize: ATTENDANCE_PAGE_SIZE,
    total,
    hasMore: from + events.length < total,
  });
}

export async function getAttendance(a: ChurchActor, eventId: string): Promise<Result> {
  if (!isUuid(eventId)) return fail(404, "not_found");
  if (!a.caps.viewAttendance) return fail(403, "forbidden");
  const { event, error } = await readEvent(a, eventId);
  if (error) return fromDb(error);
  if (!event) return fail(404, "not_found");
  const today = todayDouala();
  const { data: rows, error: e2 } = await a.supabase.from("ministry_attendance").select("member_id, created_at").eq("profile_id", a.profileId).eq("event_id", eventId).order("created_at", { ascending: true }).limit(2000);
  if (e2) return fromDb(e2);
  const present = (rows as Row[]) || [];
  // names come from the roster under the CALLER's own People permission; without it the screen shows numbers only
  const names = new Map<string, string>();
  if (a.caps.viewMembers && present.length > 0) {
    const { data: members, error: e3 } = await a.supabase.from("church_members").select("id, full_name").eq("profile_id", a.profileId).in("id", present.map((r) => r.member_id)).limit(2000);
    if (e3) return fromDb(e3);
    for (const m of (members as Row[]) || []) names.set(m.id, m.full_name);
  }
  const { data: cnt, error: e4 } = await a.supabase.from("ministry_attendance_counts").select("visitors, children, updated_at").eq("profile_id", a.profileId).eq("event_id", eventId).maybeSingle();
  if (e4) return fromDb(e4);
  const started = event.event_date <= today;
  return ok({
    today,
    event: eventShape(event),
    people: present.map((r) => ({ member_id: r.member_id, full_name: names.get(r.member_id) ?? null, recorded_at: r.created_at })),
    counts: cnt ? { visitors: (cnt as Row).visitors, children: (cnt as Row).children, updated_at: (cnt as Row).updated_at } : null,
    can: { record: a.caps.manageAttendance && event.is_cancelled !== true && started, remove: a.caps.manageAttendance, seeNames: a.caps.viewMembers },
    open: event.is_cancelled !== true && started,
  });
}

export async function recordAttendance(a: ChurchActor, eventId: string, body: unknown): Promise<Result> {
  if (!isUuid(eventId)) return fail(404, "not_found");
  if (a.kind === "leader" || !a.caps.manageAttendance) return fail(403, "forbidden");
  const parsed = parseRecordBody(body);
  if (!parsed.ok) return fail(400, parsed.code, parsed.field);
  const { event, error } = await readEvent(a, eventId);
  if (error) return fromDb(error);
  if (!event) return fail(404, "not_found");
  // those already present are skipped (recording is idempotent for the person); the rest go in ONE statement, so a refusal for one person records nobody
  const { data: existing, error: e2 } = await a.supabase.from("ministry_attendance").select("member_id").eq("profile_id", a.profileId).eq("event_id", eventId).in("member_id", parsed.ids);
  if (e2) return fromDb(e2);
  const already = new Set(((existing as Row[]) || []).map((r) => r.member_id));
  const fresh = parsed.ids.filter((id) => !already.has(id));
  if (fresh.length > 0) {
    // the database checks the event (live, not cancelled, started), the person (this church, active, not a child) and the unique key
    const { error: e3 } = await a.supabase.from("ministry_attendance").insert(fresh.map((member_id) => ({ id: newId(), profile_id: a.profileId, event_id: eventId, member_id })));
    if (e3) return fromDb(e3);
  }
  return ok({ recorded: fresh.length, already: already.size }, fresh.length > 0 ? 201 : 200);
}

export async function removeAttendance(a: ChurchActor, eventId: string, params: URLSearchParams): Promise<Result> {
  if (!isUuid(eventId)) return fail(404, "not_found");
  if (a.kind === "leader" || !a.caps.manageAttendance) return fail(403, "forbidden");
  for (const k of Array.from(params.keys())) if (k !== "member_id") return fail(400, "unexpected_field", k);
  const memberId = params.get("member_id");
  if (!isUuid(memberId)) return fail(400, "invalid_member_id", "member_id");
  const { data, error } = await a.supabase.from("ministry_attendance").delete().eq("profile_id", a.profileId).eq("event_id", eventId).eq("member_id", memberId).select("id");
  if (error) return fromDb(error);
  if (!Array.isArray(data) || data.length === 0) return fail(404, "not_found");
  return ok({ removed: 1 });
}

export async function saveCounts(a: ChurchActor, eventId: string, body: unknown): Promise<Result> {
  if (!isUuid(eventId)) return fail(404, "not_found");
  if (a.kind === "leader" || !a.caps.manageAttendance) return fail(403, "forbidden");
  const parsed = parseCountsBody(body);
  if (!parsed.ok) return fail(400, parsed.code, parsed.field);
  const { event, error } = await readEvent(a, eventId);
  if (error) return fromDb(error);
  if (!event) return fail(404, "not_found");
  const { data: cur, error: e2 } = await a.supabase.from("ministry_attendance_counts").select("updated_at").eq("profile_id", a.profileId).eq("event_id", eventId).maybeSingle();
  if (e2) return fromDb(e2);
  if (!cur) {
    const { error: e3 } = await a.supabase.from("ministry_attendance_counts").insert({ event_id: eventId, profile_id: a.profileId, visitors: parsed.visitors, children: parsed.children });
    if (e3) return fromDb(e3);
  } else {
    // changing a count that already exists must say which version it is based on, like every other change of an existing entry
    if (!parsed.expected_updated_at) return fail(400, "invalid_body", "expected_updated_at");
    if (!sameInstant(parsed.expected_updated_at, (cur as Row).updated_at)) return fail(409, "stale");
    const { data, error: e3 } = await a.supabase
      .from("ministry_attendance_counts")
      .update({ visitors: parsed.visitors, children: parsed.children })
      .eq("profile_id", a.profileId)
      .eq("event_id", eventId)
      .eq("updated_at", (cur as Row).updated_at)
      .select("event_id");
    if (e3) return fromDb(e3);
    if (!Array.isArray(data) || data.length === 0) return fail(409, "stale");
  }
  const { data: fresh } = await a.supabase.from("ministry_attendance_counts").select("visitors, children, updated_at").eq("profile_id", a.profileId).eq("event_id", eventId).maybeSingle();
  return ok({ counts: fresh ? { visitors: (fresh as Row).visitors, children: (fresh as Row).children, updated_at: (fresh as Row).updated_at } : null }, cur ? 200 : 201);
}
