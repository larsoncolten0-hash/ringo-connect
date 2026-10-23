import { classifyDbError, failure } from "../errors";
import type { Result } from "../handlers";
import { has, isUuid, plainObject } from "../validation";

// Churches & Ministries "My Bible Journey" (Phase 5), the PARTICIPANT side: a visitor (ringo_customers) joins a church's published Bible programme, ticks the sessions they have done and leaves when they
// want. Everything behind /api/customer/bible/**.
//
// WHY THE SERVICE ROLE, AND WHY IT IS SAFE HERE: a visitor has no Supabase Auth session (their identity is the separate My Ringo cookie), and the two private tables (bible_enrollments,
// bible_session_progress) have no policy and no privilege for any API role by design. So these handlers receive a database client (the service role, created ONLY by the route after the visitor's cookie
// was verified) and a customerId (taken ONLY from that cookie, never from a request). Every statement below:
//   * is filtered by `customer_id` = that visitor (an enrolment) or by an enrolment id that was just read for that visitor (a tick), so one visitor can never read or change another's;
//   * names the programme through a PUBLISHED programme of a PUBLISHED church page of the Churches & Ministries category, checked here and again by the database triggers;
//   * lists its columns explicitly and returns nothing about anyone else.
// Staff never reach these routes: they have no visitor cookie, and a staff session does not open them.

const fail = (status: number, code: string, field?: string): Result => failure(status, code, field);
const ok = (body: Record<string, unknown> = {}, status = 200): Result => ({ status, body: { ok: true, ...body } });
const newId = (): string => globalThis.crypto.randomUUID();
type Row = Record<string, any>;

export type JourneyDb = { from(table: string): any };
export interface JourneyCtx {
  /** The signed-in visitor, from their session cookie. */
  customerId: string;
  /** The service-role client. */
  db: JourneyDb;
}

/** A visitor follows at most this many programmes at once (a guard against a runaway client; far above any real use). */
export const MAX_ENROLLMENTS = 50;

const fromDb = (error: unknown): Result => {
  const o = classifyDbError(error as any);
  if (o.status >= 500) console.error(JSON.stringify({ scope: "church_journey", result: "db_error", code: String((error as any)?.code || "") }));
  return fail(o.status, o.code);
};

const isChurch = (p: Row): boolean => p.category === "church_ministries" || (Array.isArray(p.categories) && p.categories.includes("church_ministries"));

const PROGRAM_COLS = "id, profile_id, title_en, title_fr, description_en, description_fr";
const SESSION_COLS = "id, position, title_en, title_fr, scripture_ref_en, scripture_ref_fr, note_en, note_fr";

/** The programme, only if a visitor may follow it right now: published, of a published church page (not a demo) of the Churches & Ministries category. Otherwise null (the caller answers 404). */
async function availableProgram(ctx: JourneyCtx, programId: string): Promise<{ program: Row; church: Row } | null | { error: Result }> {
  const { data: program, error } = await ctx.db.from("bible_programs").select(PROGRAM_COLS).eq("id", programId).eq("status", "published").maybeSingle();
  if (error) return { error: fromDb(error) };
  if (!program) return null;
  const { data: church, error: e2 } = await ctx.db.from("profiles").select("id, username, name, published, is_demo, category, categories").eq("id", (program as Row).profile_id).maybeSingle();
  if (e2) return { error: fromDb(e2) };
  const c = church as Row | null;
  if (!c || c.published === false || c.is_demo === true || !isChurch(c)) return null;
  return { program: program as Row, church: { username: c.username, name: c.name } };
}
const isError = (x: unknown): x is { error: Result } => !!x && typeof x === "object" && "error" in (x as object);

async function myEnrollment(ctx: JourneyCtx, programId: string) {
  const { data, error } = await ctx.db.from("bible_enrollments").select("id, joined_at").eq("customer_id", ctx.customerId).eq("program_id", programId).maybeSingle();
  return { enrollment: (data as Row | null) ?? null, error };
}

/** Every programme this visitor follows that is still published, with how far along they are. */
export async function listJourneys(ctx: JourneyCtx): Promise<Result> {
  const { data: enrollments, error } = await ctx.db.from("bible_enrollments").select("id, program_id, joined_at").eq("customer_id", ctx.customerId).order("joined_at", { ascending: false }).limit(MAX_ENROLLMENTS);
  if (error) return fromDb(error);
  const rows = (enrollments as Row[]) || [];
  const out: Row[] = [];
  for (const e of rows) {
    const found = await availableProgram(ctx, e.program_id);
    if (isError(found)) return found.error;
    if (!found) continue; // unpublished or gone: hidden, but the progress is kept
    const [total, done] = await Promise.all([
      ctx.db.from("bible_program_sessions").select("id", { count: "exact", head: true }).eq("program_id", e.program_id),
      ctx.db.from("bible_session_progress").select("id", { count: "exact", head: true }).eq("enrollment_id", e.id),
    ]);
    if (total.error) return fromDb(total.error);
    if (done.error) return fromDb(done.error);
    out.push({
      program: { id: found.program.id, title_en: found.program.title_en, title_fr: found.program.title_fr },
      church: found.church,
      joined_at: e.joined_at,
      total: total.count ?? 0,
      done: done.count ?? 0,
    });
  }
  return ok({ journeys: out });
}

/** One programme as this visitor sees it: its content and sessions, whether they joined, and which sessions they have done. */
export async function getJourney(ctx: JourneyCtx, programId: string): Promise<Result> {
  if (!isUuid(programId)) return fail(404, "not_found");
  const found = await availableProgram(ctx, programId);
  if (isError(found)) return found.error;
  if (!found) return fail(404, "not_found");
  const { data: sessions, error } = await ctx.db.from("bible_program_sessions").select(SESSION_COLS).eq("program_id", programId).order("position", { ascending: true }).limit(500);
  if (error) return fromDb(error);
  const mine = await myEnrollment(ctx, programId);
  if (mine.error) return fromDb(mine.error);
  let completed: string[] = [];
  if (mine.enrollment) {
    const { data: ticks, error: e2 } = await ctx.db.from("bible_session_progress").select("session_id").eq("enrollment_id", mine.enrollment.id).limit(1000);
    if (e2) return fromDb(e2);
    completed = ((ticks as Row[]) || []).map((t) => t.session_id);
  }
  const list = (sessions as Row[]) || [];
  const { profile_id: _p, ...program } = found.program;
  return ok({
    program,
    church: found.church,
    sessions: list,
    enrollment: mine.enrollment ? { joined_at: mine.enrollment.joined_at } : null,
    completed,
    total: list.length,
    done: completed.filter((id) => list.some((s) => s.id === id)).length,
  });
}

export async function joinProgram(ctx: JourneyCtx, programId: string): Promise<Result> {
  if (!isUuid(programId)) return fail(404, "not_found");
  const found = await availableProgram(ctx, programId);
  if (isError(found)) return found.error;
  if (!found) return fail(404, "not_found");
  const mine = await myEnrollment(ctx, programId);
  if (mine.error) return fromDb(mine.error);
  if (mine.enrollment) return ok({ joined: true, already: true });
  const { count, error } = await ctx.db.from("bible_enrollments").select("id", { count: "exact", head: true }).eq("customer_id", ctx.customerId);
  if (error) return fromDb(error);
  if ((count ?? 0) >= MAX_ENROLLMENTS) return fail(409, "too_many_programs");
  const { error: e2 } = await ctx.db.from("bible_enrollments").insert({ id: newId(), profile_id: found.program.profile_id, program_id: programId, customer_id: ctx.customerId });
  // two taps at once: the unique key turns the second into "already joined"
  if (e2 && (e2 as Row).code !== "23505") return fromDb(e2);
  return ok({ joined: true, already: !!e2 }, e2 ? 200 : 201);
}

export function parseProgress(body: unknown): { ok: true; sessionId: string; done: boolean } | { ok: false; code: string; field?: string } {
  const o = plainObject(body, ["session_id", "done"]);
  if (!o.ok) return o;
  if (!isUuid(o.value.session_id)) return { ok: false, code: "invalid_session_id", field: "session_id" };
  if (!has(o.value, "done") || typeof o.value.done !== "boolean") return { ok: false, code: "invalid_body", field: "done" };
  return { ok: true, sessionId: o.value.session_id as string, done: o.value.done };
}

export async function setProgress(ctx: JourneyCtx, programId: string, body: unknown): Promise<Result> {
  if (!isUuid(programId)) return fail(404, "not_found");
  const parsed = parseProgress(body);
  if (!parsed.ok) return fail(400, parsed.code, parsed.field);
  const found = await availableProgram(ctx, programId);
  if (isError(found)) return found.error;
  if (!found) return fail(404, "not_found");
  const mine = await myEnrollment(ctx, programId);
  if (mine.error) return fromDb(mine.error);
  if (!mine.enrollment) return fail(409, "not_enrolled");
  // the session must be one of THIS programme
  const { data: session, error } = await ctx.db.from("bible_program_sessions").select("id").eq("id", parsed.sessionId).eq("program_id", programId).maybeSingle();
  if (error) return fromDb(error);
  if (!session) return fail(404, "not_found");
  if (parsed.done) {
    const { error: e2 } = await ctx.db.from("bible_session_progress").insert({ id: newId(), enrollment_id: mine.enrollment.id, program_id: programId, session_id: parsed.sessionId });
    if (e2 && (e2 as Row).code !== "23505") return fromDb(e2); // already ticked: fine
  } else {
    const { error: e2 } = await ctx.db.from("bible_session_progress").delete().eq("enrollment_id", mine.enrollment.id).eq("session_id", parsed.sessionId);
    if (e2) return fromDb(e2);
  }
  const done = await ctx.db.from("bible_session_progress").select("id", { count: "exact", head: true }).eq("enrollment_id", mine.enrollment.id);
  if (done.error) return fromDb(done.error);
  return ok({ session_id: parsed.sessionId, done: parsed.done, count: done.count ?? 0 });
}

/** Leaving ends the enrolment and erases the visitor's ticks with it. Idempotent. */
export async function leaveProgram(ctx: JourneyCtx, programId: string): Promise<Result> {
  if (!isUuid(programId)) return fail(404, "not_found");
  const { error } = await ctx.db.from("bible_enrollments").delete().eq("customer_id", ctx.customerId).eq("program_id", programId);
  if (error) return fromDb(error);
  return ok({ left: true });
}
