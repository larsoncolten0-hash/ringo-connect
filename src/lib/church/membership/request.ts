import { classifyDbError, failure } from "../errors";
import type { Result } from "../handlers";
import { has, isUuid, plainObject } from "../validation";

// Churches & Ministries expansion, Phase 4, the VISITOR side: a person who is connected to a church asks to become a member, and sees where their request stands. Everything behind
// /api/customer/church-membership.
//
// WHY THE SERVICE ROLE, AND WHY IT IS SAFE HERE: a visitor has no Supabase Auth session (their identity is the separate My Ringo cookie), and the roster has no policy for them by design. The
// route creates the service-role client ONLY after the visitor's cookie was verified and hands it over with the visitor's id (never taken from a request). Every statement below:
//   * is filtered by `customer_id` = that visitor, so one visitor can never read or change another's;
//   * writes nothing directly: the request is made by the database function church_request_membership, which alone decides (adult or youth, a published church page, a connected visitor, limits);
//   * returns a status word and nothing else: no name, no contact detail, no roster row.
// An explicit consent is required in the body, because the roster of a church is information about religious affiliation.

const fail = (status: number, code: string, field?: string): Result => failure(status, code, field);
const ok = (body: Record<string, unknown> = {}, status = 200): Result => ({ status, body: { ok: true, ...body } });

export type MembershipDb = { from(table: string): any; rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: any; error: any }> };
export interface MembershipCtx {
  /** The signed-in visitor, from their session cookie. */
  customerId: string;
  /** The service-role client. */
  db: MembershipDb;
}

/** What the database function says when it refuses, as a short code (the message itself is never returned). */
const REQUEST_CODES: Array<[RegExp, number, string]> = [
  [/church_request_age_group/, 400, "invalid_age_group"],
  [/church_request_not_connected/, 403, "church_request_not_connected"],
  [/church_request_cooldown/, 429, "church_request_cooldown"],
  [/church_request_limit/, 429, "church_request_limit"],
  [/church_request_unavailable/, 404, "church_request_unavailable"],
];
const fromDb = (error: unknown): Result => {
  const message = String((error as any)?.message || "");
  for (const [re, status, code] of REQUEST_CODES) if (re.test(message)) return fail(status, code);
  const o = classifyDbError(error as any);
  if (o.status >= 500) console.error(JSON.stringify({ scope: "church_membership_request", result: "db_error", code: String((error as any)?.code || "") }));
  return fail(o.status, o.code);
};

/** Where this visitor stands with this church: connected or not, and the status of their membership row (none / pending / active / inactive). */
export async function myMembership(ctx: MembershipCtx, profileId: string): Promise<Result> {
  if (!isUuid(profileId)) return fail(404, "church_request_unavailable");
  const { data: church, error: e1 } = await ctx.db.from("profiles").select("id, published, is_demo, category, categories").eq("id", profileId).maybeSingle();
  if (e1) return fromDb(e1);
  const c = church as Record<string, any> | null;
  const isChurch = !!c && (c.category === "church_ministries" || (Array.isArray(c.categories) && c.categories.includes("church_ministries")));
  if (!c || c.published === false || c.is_demo === true || !isChurch) return fail(404, "church_request_unavailable");
  const [conn, member] = await Promise.all([
    ctx.db.from("customer_connections").select("id").eq("customer_id", ctx.customerId).eq("profile_id", profileId).eq("status", "active").maybeSingle(),
    ctx.db.from("church_members").select("status").eq("customer_id", ctx.customerId).eq("profile_id", profileId).neq("status", "removed").maybeSingle(),
  ]);
  if (conn.error) return fromDb(conn.error);
  if (member.error) return fromDb(member.error);
  return ok({ connected: !!conn.data, status: (member.data as Record<string, any> | null)?.status ?? "none" });
}

/** POST { profile_id, age_group: "adult" | "youth", consent: true }. */
export async function requestMembership(ctx: MembershipCtx, body: unknown): Promise<Result> {
  const o = plainObject(body, ["profile_id", "age_group", "consent"]);
  if (!o.ok) return fail(400, o.code, o.field);
  const b = o.value;
  if (!has(b, "profile_id") || !isUuid(b.profile_id)) return fail(400, "church_request_unavailable", "profile_id");
  if (b.age_group !== "adult" && b.age_group !== "youth") return fail(400, "invalid_age_group", "age_group");
  if (b.consent !== true) return fail(400, "consent_required", "consent");
  const { data, error } = await ctx.db.rpc("church_request_membership", { p_customer_id: ctx.customerId, p_profile_id: b.profile_id, p_age_group: b.age_group });
  if (error) return fromDb(error);
  const status = typeof data?.status === "string" ? data.status : "pending";
  return ok({ status, created: data?.created === true }, data?.created === true ? 201 : 200);
}
