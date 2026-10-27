import { classifyDbError, failure } from "../errors";
import { todayDouala, type Result } from "../handlers";
import { has, isUuid, plainObject } from "../validation";
import { PLAN_DAYS, dayOnDate, readingForDay, referenceOf, streakEndingAt } from "./plan";

// Churches & Ministries expansion, Phase 5A, the READER side of "The Bible in one year": a visitor connected to a church starts the plan, sees today's reading, ticks the days they read and may leave. Everything
// behind /api/customer/church-bible-year.
//
// WHY THE SERVICE ROLE, AND WHY IT IS SAFE HERE: a visitor has no Supabase Auth session (their identity is the separate My Ringo cookie), and the two reader tables have no policy and no privilege for any API
// role by design. The route creates the service-role client ONLY after the visitor's cookie was verified and hands it over with the visitor's id (never taken from a request). Every statement below is filtered
// by `customer_id` = that visitor (an enrolment) or by an enrolment id that was just read for that visitor (a tick). The start date is chosen by the database (Cameroon's calendar day), never by the client.
// Church staff never see a reader: nothing here is reachable from a staff session, and the answers hold the plan and the visitor's own ticks only.

const fail = (status: number, code: string, field?: string): Result => failure(status, code, field);
const ok = (body: Record<string, unknown> = {}, status = 200): Result => ({ status, body: { ok: true, ...body } });
type Row = Record<string, any>;

export type BibleYearDb = { from(table: string): any };
export interface BibleYearCtx {
  /** The signed-in visitor, from their session cookie. */
  customerId: string;
  /** The service-role client. */
  db: BibleYearDb;
}

const CODES: Array<[RegExp, number, string]> = [
  [/bible_year_limit/, 429, "bible_year_limit"],
  [/bible_year_future_day/, 409, "future_day"],
  [/bible_year_closed/, 409, "plan_closed"],
];
const fromDb = (error: unknown): Result => {
  const message = String((error as any)?.message || "");
  for (const [re, status, code] of CODES) if (re.test(message)) return fail(status, code);
  const o = classifyDbError(error as any);
  if (o.status >= 500) console.error(JSON.stringify({ scope: "church_bible_year", result: "db_error", code: String((error as any)?.code || "") }));
  return fail(o.status, o.code);
};

const isChurchRow = (c: Row | null): boolean => !!c && (c.category === "church_ministries" || (Array.isArray(c.categories) && c.categories.includes("church_ministries")));

/** The church, only if it offers the plan right now: a published, non-demo Churches & Ministries page whose owner switched "Bible in one year" on. */
async function offering(ctx: BibleYearCtx, profileId: string): Promise<{ church: Row } | { error: Result }> {
  if (!isUuid(profileId)) return { error: fail(404, "plan_unavailable") };
  const { data: church, error } = await ctx.db.from("profiles").select("id, username, published, is_demo, category, categories").eq("id", profileId).maybeSingle();
  if (error) return { error: fromDb(error) };
  const c = church as Row | null;
  if (!c || c.published === false || c.is_demo === true || !isChurchRow(c)) return { error: fail(404, "plan_unavailable") };
  const { data: features, error: e2 } = await ctx.db.from("church_features").select("bible_year").eq("profile_id", profileId).maybeSingle();
  if (e2) return { error: fromDb(e2) };
  if ((features as Row | null)?.bible_year !== true) return { error: fail(404, "plan_unavailable") };
  return { church: c };
}
const isError = (x: unknown): x is { error: Result } => !!x && typeof x === "object" && "error" in (x as object);

async function connected(ctx: BibleYearCtx, profileId: string): Promise<{ yes: boolean; error?: Result }> {
  const { data, error } = await ctx.db.from("customer_connections").select("id").eq("customer_id", ctx.customerId).eq("profile_id", profileId).eq("status", "active").maybeSingle();
  return error ? { yes: false, error: fromDb(error) } : { yes: !!data };
}
async function openEnrollment(ctx: BibleYearCtx, profileId: string) {
  const { data, error } = await ctx.db.from("bible_year_enrollments").select("id, start_date, created_at").eq("customer_id", ctx.customerId).eq("profile_id", profileId).is("ended_at", null).maybeSingle();
  return { row: (data as Row | null) ?? null, error };
}

/** The reader's whole picture: whether they are connected, whether they follow the plan, their day, today's reading in both languages, the days they ticked and their streak. */
export async function myPlan(ctx: BibleYearCtx, profileId: string, now: number = Date.now()): Promise<Result> {
  const off = await offering(ctx, profileId);
  if (isError(off)) return off.error;
  const conn = await connected(ctx, profileId);
  if (conn.error) return conn.error;
  const en = await openEnrollment(ctx, profileId);
  if (en.error) return fromDb(en.error);
  if (!en.row) return ok({ connected: conn.yes, enrolled: false, total: PLAN_DAYS });
  const today = todayDouala(now);
  const start = String(en.row.start_date).slice(0, 10);
  const pos = dayOnDate(start, today);
  const { data: ticks, error } = await ctx.db.from("bible_year_progress").select("day").eq("enrollment_id", en.row.id).order("day", { ascending: true }).limit(PLAN_DAYS);
  if (error) return fromDb(error);
  const done = ((ticks as Row[]) || []).map((t) => Number(t.day)).filter((d) => Number.isInteger(d) && d >= 1 && d <= PLAN_DAYS);
  const reading = readingForDay(pos.day);
  return ok({
    connected: conn.yes,
    enrolled: true,
    total: PLAN_DAYS,
    start_date: start,
    day: pos.day,
    finished: pos.finished,
    today: reading ? { day: reading.day, en: referenceOf(reading, "en"), fr: referenceOf(reading, "fr"), chapters: reading.chapters } : null,
    done,
    streak: streakEndingAt(new Set(done), pos.day),
  });
}

/** POST { profile_id }: opt in. Needs a connection to the church. Starting twice is harmless (the open plan is returned). */
export async function startPlan(ctx: BibleYearCtx, body: unknown, now: number = Date.now()): Promise<Result> {
  const o = plainObject(body, ["profile_id"]);
  if (!o.ok) return fail(400, o.code, o.field);
  if (!has(o.value, "profile_id") || !isUuid(o.value.profile_id)) return fail(404, "plan_unavailable");
  const profileId = o.value.profile_id;
  const off = await offering(ctx, profileId);
  if (isError(off)) return off.error;
  const conn = await connected(ctx, profileId);
  if (conn.error) return conn.error;
  if (!conn.yes) return fail(403, "not_connected");
  const en = await openEnrollment(ctx, profileId);
  if (en.error) return fromDb(en.error);
  if (!en.row) {
    const { error } = await ctx.db.from("bible_year_enrollments").insert({ customer_id: ctx.customerId, profile_id: profileId });
    if (error && String((error as any).code) !== "23505") return fromDb(error);
  }
  const res = await myPlan(ctx, profileId, now);
  return res.status === 200 ? { status: en.row ? 200 : 201, body: res.body } : res;
}

/** PATCH { profile_id, day, done }: tick or untick one day. */
export async function tickDay(ctx: BibleYearCtx, body: unknown, now: number = Date.now()): Promise<Result> {
  const o = plainObject(body, ["profile_id", "day", "done"]);
  if (!o.ok) return fail(400, o.code, o.field);
  const b = o.value;
  if (!has(b, "profile_id") || !isUuid(b.profile_id)) return fail(404, "plan_unavailable");
  if (typeof b.day !== "number" || !Number.isInteger(b.day) || b.day < 1 || b.day > PLAN_DAYS) return fail(400, "invalid_day", "day");
  if (typeof b.done !== "boolean") return fail(400, "invalid_body", "done");
  const off = await offering(ctx, b.profile_id);
  if (isError(off)) return off.error;
  const en = await openEnrollment(ctx, b.profile_id);
  if (en.error) return fromDb(en.error);
  if (!en.row) return fail(404, "not_following");
  if (b.done) {
    const { error } = await ctx.db.from("bible_year_progress").insert({ enrollment_id: en.row.id, day: b.day });
    if (error && String((error as any).code) !== "23505") return fromDb(error);
  } else {
    const { error } = await ctx.db.from("bible_year_progress").delete().eq("enrollment_id", en.row.id).eq("day", b.day);
    if (error) return fromDb(error);
  }
  return myPlan(ctx, b.profile_id, now);
}

/** DELETE ?profile_id=: leave the plan (the ticks are kept with the closed plan; starting again begins a new plan from day 1). */
export async function leavePlan(ctx: BibleYearCtx, profileId: string): Promise<Result> {
  if (!isUuid(profileId)) return fail(404, "plan_unavailable");
  const en = await openEnrollment(ctx, profileId);
  if (en.error) return fromDb(en.error);
  if (!en.row) return ok({ enrolled: false });
  const { error } = await ctx.db.from("bible_year_enrollments").update({ ended_at: new Date().toISOString() }).eq("id", en.row.id).eq("customer_id", ctx.customerId);
  if (error) return fromDb(error);
  return ok({ enrolled: false });
}
