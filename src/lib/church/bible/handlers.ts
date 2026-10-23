import type { ChurchActor } from "../actor";
import { classifyDbError, failure } from "../errors";
import type { Result } from "../handlers";
import { makeLifecycle, type LifecycleSpec } from "../lifecycle/engine";
import { makeBodyParser } from "../lifecycle/validation";
import { parseDeleteQuery } from "../content/validation";
import { has, isUuid, plainObject } from "../validation";

// Churches & Ministries Bible programmes (Phase 5), the CHURCH side: everything behind /api/church/bible/**.
//   * A programme is a draft -> publish entity: it reuses the shared lifecycle (src/lib/church/lifecycle/engine.ts), so it follows exactly the rules of events and announcements.
//   * Its SESSIONS (days / readings) are edited here. A session carries a title, a scripture REFERENCE the church types (no Bible text is stored or supplied) and a short note. While the programme is a draft
//     the manage permission edits them; once it is live only the publish permission may (the database policies say the same).
//   * Participation is PRIVATE and is not in this file: visitors join and tick sessions through their own My Ringo session (src/lib/church/bible/journey.ts). Church staff only ever see COUNTS, from the
//     database function bible_program_stats(): the number enrolled, and per-session completion once at least 3 people are enrolled. No route here can read an enrolment or a tick.
// The church is always actor.profileId, every query goes through the user's own session (row-level security is the authority), a write that RLS filters away touches zero rows and is reported as a refusal,
// and a failure is a short code, never the database's message. EVERY change of an existing programme or session needs the expected_updated_at it was based on.

const ok = (body: Record<string, unknown> = {}, status = 200): Result => ({ status, body: { ok: true, ...body } });
const fail = (status: number, code: string, field?: string): Result => failure(status, code, field);
const fromDb = (error: unknown): Result => {
  const o = classifyDbError(error as any);
  if (o.status >= 500) console.error(JSON.stringify({ scope: "church_bible", result: "db_error", code: String((error as any)?.code || "") }));
  return fail(o.status, o.code);
};
const newId = (): string => globalThis.crypto.randomUUID();
const sameInstant = (a: unknown, b: unknown) => Date.parse(String(a)) === Date.parse(String(b));
type Row = Record<string, any>;
const filled = (v: unknown): boolean => typeof v === "string" && v.trim() !== "";

export const MAX_SESSIONS = 400;

// ---- programmes (the shared lifecycle) ---------------------------------------------------------------------------------------------------------------------------

export const parseProgram = makeBodyParser({
  texts: {
    title_en: { max: 120, multiline: false, code: "invalid_title" },
    title_fr: { max: 120, multiline: false, code: "invalid_title" },
    description_en: { max: 2000, multiline: true, code: "invalid_description" },
    description_fr: { max: 2000, multiline: true, code: "invalid_description" },
  },
});

const PROGRAM_COLS = "id, status, title_en, title_fr, description_en, description_fr, published_at, created_at, updated_at";
const PROGRAM_LIST_COLS = "id, status, title_en, title_fr, updated_at";
export const programStateOf = (r: Row): "draft" | "published" => (r.status === "published" ? "published" : "draft");
const programShape = (r: Row): Record<string, unknown> => ({ ...r, state: programStateOf(r), has_en: filled(r.title_en), has_fr: filled(r.title_fr) });

export const programSpec: LifecycleSpec = {
  table: "bible_programs",
  logScope: "church_bible",
  cols: PROGRAM_COLS,
  listCols: PROGRAM_LIST_COLS,
  caps: { view: (c) => c.viewBible, manage: (c) => c.manageBible, publish: (c) => c.publishBible },
  parse: parseProgram,
  views: { all: (q) => q, drafts: (q) => q.eq("status", "draft"), published: (q) => q.eq("status", "published") },
  orderBy: [["created_at", false]],
  publishable: (r) => filled(r.title_en) || filled(r.title_fr),
  publishBlockedCode: "needs_title",
  stateOf: programStateOf,
  listItem: (r) => {
    const s = programShape(r);
    return { id: s.id, status: s.status, state: s.state, title_en: s.title_en, title_fr: s.title_fr, has_en: s.has_en, has_fr: s.has_fr, updated_at: s.updated_at };
  },
  detail: programShape,
};
const programs = makeLifecycle(programSpec);

const q = (a: ChurchActor, table: string) => a.supabase.from(table);
const SESSION_COLS = "id, position, title_en, title_fr, scripture_ref_en, scripture_ref_fr, note_en, note_fr, created_at, updated_at";

/** The list of programmes, with how many sessions each has (one extra query for the whole page). */
export async function listPrograms(a: ChurchActor, params: URLSearchParams): Promise<Result> {
  const res = await programs.list(a, params);
  if (res.status !== 200 || !Array.isArray(res.body.items)) return res;
  const items = res.body.items as Row[];
  const counts = new Map<string, number>();
  if (items.length > 0) {
    const { data, error } = await q(a, "bible_program_sessions").select("program_id").eq("profile_id", a.profileId).in("program_id", items.map((i) => i.id)).limit(10000);
    if (error) return fromDb(error);
    for (const r of (data as Row[]) || []) counts.set(r.program_id, (counts.get(r.program_id) ?? 0) + 1);
  }
  return { status: 200, body: { ...res.body, items: items.map((i) => ({ ...i, session_count: counts.get(i.id as string) ?? 0 })) } };
}

/** One programme with its sessions in order and the participant COUNTS (never a name). */
export async function getProgram(a: ChurchActor, id: string): Promise<Result> {
  const res = await programs.get(a, id);
  if (res.status !== 200) return res;
  const { data: sessions, error } = await q(a, "bible_program_sessions").select(SESSION_COLS).eq("profile_id", a.profileId).eq("program_id", id).order("position", { ascending: true }).limit(MAX_SESSIONS + 1);
  if (error) return fromDb(error);
  const { data: stats } = await a.supabase.rpc("bible_program_stats", { p_program_id: id });
  const live = (res.body.item as Row).status === "published";
  const sessionRights = { edit: live ? a.caps.publishBible : a.caps.manageBible };
  return {
    status: 200,
    body: { ...res.body, sessions: (sessions as Row[]) || [], stats: stats ?? null, can: { ...(res.body.can as Row), sessions: sessionRights.edit }, maxSessions: MAX_SESSIONS },
  };
}

export const createProgram = programs.create;
export const updateProgram = programs.update;
export const publishProgram = programs.publish;
export const unpublishProgram = programs.unpublish;
/** Deleting a programme that has participants is refused by the database (they are unpublished, not deleted); the answer is a clear code. */
export const deleteProgram = programs.remove;

// ---- sessions ----------------------------------------------------------------------------------------------------------------------------------------------------

export const parseSession = makeBodyParser({
  texts: {
    title_en: { max: 120, multiline: false, code: "invalid_title" },
    title_fr: { max: 120, multiline: false, code: "invalid_title" },
    scripture_ref_en: { max: 120, multiline: false, code: "invalid_reference" },
    scripture_ref_fr: { max: 120, multiline: false, code: "invalid_reference" },
    note_en: { max: 1000, multiline: true, code: "invalid_note" },
    note_fr: { max: 1000, multiline: true, code: "invalid_note" },
  },
});

export function parseMove(body: unknown): { ok: true; direction: "up" | "down" } | { ok: false; code: string; field?: string } {
  const o = plainObject(body, ["direction"]);
  if (!o.ok) return o;
  if (!has(o.value, "direction") || (o.value.direction !== "up" && o.value.direction !== "down")) return { ok: false, code: "invalid_direction", field: "direction" };
  return { ok: true, direction: o.value.direction };
}

/** The programme this request is about (a programme of THIS church), and what the caller may do to its sessions. */
async function readProgram(a: ChurchActor, programId: string) {
  const { data, error } = await q(a, "bible_programs").select("id, status").eq("id", programId).eq("profile_id", a.profileId).maybeSingle();
  return { program: (data as Row | null) ?? null, error };
}
const mayEditSessions = (a: ChurchActor, program: Row) => (program.status === "published" ? a.caps.publishBible : a.caps.manageBible);

export async function createSession(a: ChurchActor, programId: string, body: unknown): Promise<Result> {
  if (!isUuid(programId)) return fail(404, "not_found");
  if (a.kind === "leader" || !a.caps.manageBible) return fail(403, "forbidden");
  const parsed = parseSession(body, "create");
  if (!parsed.ok) return fail(400, parsed.code, parsed.field);
  if (!filled(parsed.value.title_en) && !filled(parsed.value.title_fr)) return fail(400, "session_needs_title");
  const { program, error } = await readProgram(a, programId);
  if (error) return fromDb(error);
  if (!program) return fail(404, "not_found");
  if (!mayEditSessions(a, program)) return fail(403, "publish_required");
  // appended after the last session; two people adding at once collide on the position, and one of them is told to try again
  const { data: last, error: e2 } = await q(a, "bible_program_sessions").select("position").eq("profile_id", a.profileId).eq("program_id", programId).order("position", { ascending: false }).limit(1);
  if (e2) return fromDb(e2);
  const position = ((last as Row[])?.[0]?.position ?? 0) + 1;
  const id = newId();
  const { error: e3 } = await q(a, "bible_program_sessions").insert({ id, profile_id: a.profileId, program_id: programId, position, ...parsed.value });
  if (e3) return fromDb(e3);
  const { data: row } = await q(a, "bible_program_sessions").select(SESSION_COLS).eq("id", id).eq("profile_id", a.profileId).maybeSingle();
  return ok({ id, session: row ?? null }, 201);
}

export async function updateSession(a: ChurchActor, programId: string, sessionId: string, body: unknown): Promise<Result> {
  if (!isUuid(programId) || !isUuid(sessionId)) return fail(404, "not_found");
  if (a.kind === "leader" || !a.caps.manageBible) return fail(403, "forbidden");
  const parsed = parseSession(body, "update");
  if (!parsed.ok) return fail(400, parsed.code, parsed.field);
  const { program, error } = await readProgram(a, programId);
  if (error) return fromDb(error);
  if (!program) return fail(404, "not_found");
  const cur = await q(a, "bible_program_sessions").select("id, updated_at").eq("id", sessionId).eq("program_id", programId).eq("profile_id", a.profileId).maybeSingle();
  if (cur.error) return fromDb(cur.error);
  if (!cur.data) return fail(404, "not_found");
  if (!mayEditSessions(a, program)) return fail(403, "publish_required");
  const expected = parsed.value.expected_updated_at as string | undefined;
  if (!expected) return fail(400, "invalid_body", "expected_updated_at"); // the reviewed version is mandatory
  if (!sameInstant(expected, (cur.data as Row).updated_at)) return fail(409, "stale");
  const { expected_updated_at: _e, ...content } = parsed.value;
  const { data, error: e2 } = await q(a, "bible_program_sessions").update(content).eq("id", sessionId).eq("program_id", programId).eq("profile_id", a.profileId).eq("updated_at", (cur.data as Row).updated_at).select("id");
  if (e2) return fromDb(e2);
  if (!Array.isArray(data) || data.length === 0) {
    const again = await q(a, "bible_program_sessions").select("id, updated_at").eq("id", sessionId).eq("profile_id", a.profileId).maybeSingle();
    return again.data && !sameInstant((again.data as Row).updated_at, (cur.data as Row).updated_at) ? fail(409, "stale") : fail(403, "forbidden");
  }
  const { data: row } = await q(a, "bible_program_sessions").select(SESSION_COLS).eq("id", sessionId).eq("profile_id", a.profileId).maybeSingle();
  return ok({ session: row ?? null });
}

export async function deleteSession(a: ChurchActor, programId: string, sessionId: string, params: URLSearchParams): Promise<Result> {
  if (!isUuid(programId) || !isUuid(sessionId)) return fail(404, "not_found");
  if (a.kind === "leader" || !a.caps.manageBible) return fail(403, "forbidden");
  const { program, error } = await readProgram(a, programId);
  if (error) return fromDb(error);
  if (!program) return fail(404, "not_found");
  const cur = await q(a, "bible_program_sessions").select("id, updated_at").eq("id", sessionId).eq("program_id", programId).eq("profile_id", a.profileId).maybeSingle();
  if (cur.error) return fromDb(cur.error);
  if (!cur.data) return fail(404, "not_found");
  if (!mayEditSessions(a, program)) return fail(403, "publish_required");
  const parsed = parseDeleteQuery(params);
  if (!parsed.ok) return fail(400, parsed.code, parsed.field);
  if (!sameInstant(parsed.value.expected_updated_at, (cur.data as Row).updated_at)) return fail(409, "stale");
  // a LIVE programme keeps at least one session (it could not be published without one)
  if (program.status === "published") {
    const { count } = await q(a, "bible_program_sessions").select("id", { count: "exact", head: true }).eq("profile_id", a.profileId).eq("program_id", programId);
    if ((count ?? 0) <= 1) return fail(409, "last_session");
  }
  const { data, error: e2 } = await q(a, "bible_program_sessions").delete().eq("id", sessionId).eq("program_id", programId).eq("profile_id", a.profileId).eq("updated_at", (cur.data as Row).updated_at).select("id");
  if (e2) return fromDb(e2);
  if (!Array.isArray(data) || data.length === 0) {
    const again = await q(a, "bible_program_sessions").select("id, updated_at").eq("id", sessionId).eq("profile_id", a.profileId).maybeSingle();
    return !again.data || !sameInstant((again.data as Row).updated_at, (cur.data as Row).updated_at) ? fail(409, "stale") : fail(403, "forbidden");
  }
  return ok({ id: sessionId });
}

/** Swaps a session with its neighbour in ONE database statement, as the caller (row-level security decides). `moved: false` = already first / last. */
export async function moveSession(a: ChurchActor, programId: string, sessionId: string, body: unknown): Promise<Result> {
  if (!isUuid(programId) || !isUuid(sessionId)) return fail(404, "not_found");
  if (a.kind === "leader" || !a.caps.manageBible) return fail(403, "forbidden");
  const parsed = parseMove(body);
  if (!parsed.ok) return fail(400, parsed.code, parsed.field);
  const { program, error } = await readProgram(a, programId);
  if (error) return fromDb(error);
  if (!program) return fail(404, "not_found");
  const cur = await q(a, "bible_program_sessions").select("id").eq("id", sessionId).eq("program_id", programId).eq("profile_id", a.profileId).maybeSingle();
  if (cur.error) return fromDb(cur.error);
  if (!cur.data) return fail(404, "not_found");
  if (!mayEditSessions(a, program)) return fail(403, "publish_required");
  const { data, error: e2 } = await a.supabase.rpc("bible_session_move", { p_session_id: sessionId, p_direction: parsed.direction });
  if (e2) return fromDb(e2);
  return ok({ moved: data === true });
}

