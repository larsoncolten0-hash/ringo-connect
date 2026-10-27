import { classifyDbError, failure } from "../errors";
import type { Result } from "../handlers";
import { has, isUuid, plainObject } from "../validation";
import { PUSH_TOPICS, isPushTopic, type PushTopic } from "./topics";

// Churches & Ministries expansion, Phase 5B, the VISITOR side: the topics a connected visitor chose to hear about from a church, and whether this person has any device registered. Everything behind
// /api/customer/church-push.
//
// WHY THE SERVICE ROLE, AND WHY IT IS SAFE HERE: a visitor has no Supabase Auth session (their identity is the separate My Ringo cookie) and the preference tables have no policy and no privilege for any API
// role. The route creates the service-role client ONLY after the visitor's cookie was verified and hands it over with the visitor's id (never taken from a request). Every statement is filtered by
// `customer_id` = that visitor. The church never sees these choices. Choosing nothing is the default; an empty list removes the row.

const fail = (status: number, code: string, field?: string): Result => failure(status, code, field);
const ok = (body: Record<string, unknown> = {}, status = 200): Result => ({ status, body: { ok: true, ...body } });
type Row = Record<string, any>;

export type PrefsDb = { from(table: string): any };
export interface PrefsCtx {
  customerId: string;
  db: PrefsDb;
}

const fromDb = (error: unknown): Result => {
  const message = String((error as any)?.message || "");
  if (/church_push_not_connected/.test(message)) return fail(403, "church_push_not_connected");
  const o = classifyDbError(error as any);
  if (o.status >= 500) console.error(JSON.stringify({ scope: "church_push_prefs", result: "db_error", code: String((error as any)?.code || "") }));
  return fail(o.status, o.code);
};
const isChurchRow = (c: Row | null): boolean => !!c && (c.category === "church_ministries" || (Array.isArray(c.categories) && c.categories.includes("church_ministries")));

async function church(ctx: PrefsCtx, profileId: string): Promise<{ row: Row } | { error: Result }> {
  if (!isUuid(profileId)) return { error: fail(404, "church_unavailable") };
  const { data, error } = await ctx.db.from("profiles").select("id, published, is_demo, category, categories").eq("id", profileId).maybeSingle();
  if (error) return { error: fromDb(error) };
  const c = data as Row | null;
  if (!c || c.published === false || c.is_demo === true || !isChurchRow(c)) return { error: fail(404, "church_unavailable") };
  return { row: c };
}
const isError = (x: unknown): x is { error: Result } => !!x && typeof x === "object" && "error" in (x as object);

/** The topics offered for this church: the Bible reading only when the church offers the plan. */
async function availableTopics(ctx: PrefsCtx, profileId: string): Promise<PushTopic[]> {
  const { data } = await ctx.db.from("church_features").select("bible_year").eq("profile_id", profileId).maybeSingle();
  const bible = (data as Row | null)?.bible_year === true;
  return PUSH_TOPICS.filter((t) => t !== "bible_day" || bible);
}

export async function getPrefs(ctx: PrefsCtx, profileId: string): Promise<Result> {
  const c = await church(ctx, profileId);
  if (isError(c)) return c.error;
  const [conn, prefs, devices, available] = await Promise.all([
    ctx.db.from("customer_connections").select("id").eq("customer_id", ctx.customerId).eq("profile_id", profileId).eq("status", "active").maybeSingle(),
    ctx.db.from("church_push_prefs").select("topics").eq("customer_id", ctx.customerId).eq("profile_id", profileId).maybeSingle(),
    ctx.db.from("customer_push_subscriptions").select("id", { count: "exact", head: true }).eq("customer_id", ctx.customerId),
    availableTopics(ctx, profileId),
  ]);
  if (conn.error) return fromDb(conn.error);
  if (prefs.error) return fromDb(prefs.error);
  const topics = Array.isArray((prefs.data as Row | null)?.topics) ? ((prefs.data as Row).topics as unknown[]).filter(isPushTopic) : [];
  return ok({ connected: !!conn.data, topics, available, devices: typeof devices.count === "number" ? devices.count : 0 });
}

/** PUT { profile_id, topics: string[] }: the visitor's choice. An empty list means none (the row is removed). Needs an active connection. */
export async function setPrefs(ctx: PrefsCtx, body: unknown): Promise<Result> {
  const o = plainObject(body, ["profile_id", "topics"]);
  if (!o.ok) return fail(400, o.code, o.field);
  const b = o.value;
  if (!has(b, "profile_id") || !isUuid(b.profile_id)) return fail(404, "church_unavailable");
  if (!Array.isArray(b.topics) || b.topics.length > PUSH_TOPICS.length || !b.topics.every(isPushTopic)) return fail(400, "invalid_topics", "topics");
  const c = await church(ctx, b.profile_id);
  if (isError(c)) return c.error;
  const topics = Array.from(new Set(b.topics as PushTopic[]));
  const allowed = await availableTopics(ctx, b.profile_id);
  if (!topics.every((t) => allowed.includes(t))) return fail(400, "invalid_topics", "topics");
  if (topics.length === 0) {
    const { error } = await ctx.db.from("church_push_prefs").delete().eq("customer_id", ctx.customerId).eq("profile_id", b.profile_id);
    if (error) return fromDb(error);
    return ok({ topics: [] });
  }
  // insert the first time, update afterwards (a second tap racing the first lands on the primary key and falls back to the update)
  const ins = await ctx.db.from("church_push_prefs").insert({ customer_id: ctx.customerId, profile_id: b.profile_id, topics });
  if (ins.error) {
    if (String((ins.error as any).code) !== "23505") return fromDb(ins.error);
    const upd = await ctx.db.from("church_push_prefs").update({ topics }).eq("customer_id", ctx.customerId).eq("profile_id", b.profile_id);
    if (upd.error) return fromDb(upd.error);
  }
  return ok({ topics });
}

/** DELETE ?profile_id=: turn every notification from this church off. */
export async function stopAll(ctx: PrefsCtx, profileId: string): Promise<Result> {
  if (!isUuid(profileId)) return fail(404, "church_unavailable");
  const { error } = await ctx.db.from("church_push_prefs").delete().eq("customer_id", ctx.customerId).eq("profile_id", profileId);
  if (error) return fromDb(error);
  return ok({ topics: [] });
}
