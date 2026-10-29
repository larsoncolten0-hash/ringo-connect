import { isUuid } from "@/lib/loyalty/validate";
import type { ConsentDb } from "@/lib/customer/consent";

// Reviews and ratings (Phase 3): a connected customer who really interacted with a business (a loyalty record the business made, or a booking / order they linked to it) can rate it from 1 to 5
// and say a few words. The business can hide a review and reply once; it cannot write, edit or delete one. Reviews are NOT offered for Churches & Ministries.
//
// Reuses the existing structures: the reviewer is the My Ringo customer (cookie session), the subject is the profile, the proof of interaction is loyalty_activities / customer_order_links.
// Reviews are not marketing and need no marketing consent. The public sees a first name and a last initial, never an e-mail, phone or id.

export type Db = ConsentDb & { from(table: string): any };
export type Result = { status: number; body: Record<string, unknown> };
const ok = (body: Record<string, unknown> = {}, status = 200): Result => ({ status, body: { ok: true, ...body } });
const fail = (status: number, error: string, field?: string): Result => ({ status, body: { ok: false, error, ...(field ? { field } : {}) } });

export const REVIEW_LIMITS = { body: 1000, reply: 500 } as const;
export const REVIEW_PAGE = 50;

/** Reviews are offered for every category except Churches & Ministries. */
export function reviewsAvailable(profile: { category?: string | null; categories?: string[] | null }): boolean {
  return profile.category !== "church_ministries" && !(profile.categories || []).includes("church_ministries");
}

/** "Amina Kone" -> "Amina K."; one word stays as it is; nothing else is ever shown. */
export function publicName(name: string | null | undefined): string {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  const first = parts[0].slice(0, 24);
  return parts.length > 1 ? `${first} ${Array.from(parts[parts.length - 1])[0].toUpperCase()}.` : first;
}

export function summarize(ratings: readonly number[]): { count: number; average: number | null } {
  if (ratings.length === 0) return { count: 0, average: null };
  return { count: ratings.length, average: Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The customer's side (the customer id comes from the verified My Ringo cookie only)
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

/** Every active connection with whether a review is offered, whether this customer can write one, and their own review if they did. */
export async function myReviewables(db: Db, customerId: string): Promise<Result> {
  const { data: conns } = await db.from("customer_connections").select("profile_id").eq("customer_id", customerId).eq("status", "active").limit(100);
  const ids = ((conns || []) as Array<{ profile_id: string }>).map((c) => c.profile_id);
  if (ids.length === 0) return ok({ items: [] });
  const { data: profiles } = await db.from("profiles").select("id, name, username, category, categories, published").in("id", ids);
  const { data: mine } = await db.from("profile_reviews").select("profile_id, rating, body, status, owner_reply").eq("customer_id", customerId).in("profile_id", ids);
  const reviewBy = new Map<string, any>(((mine || []) as any[]).map((r) => [r.profile_id, r]));
  const items: Array<Record<string, unknown>> = [];
  for (const p of (profiles || []) as any[]) {
    if (p.published !== true || !reviewsAvailable(p)) continue;
    const { data: has } = await db.rpc("customer_has_interaction", { p_customer: customerId, p_profile: p.id });
    const r = reviewBy.get(p.id);
    items.push({
      profile_id: p.id,
      profile_name: p.name || p.username,
      username: p.username,
      can_review: has === true,
      review: r ? { rating: r.rating, body: r.body, status: r.status, owner_reply: r.owner_reply } : null,
    });
  }
  return ok({ items });
}

const OUTCOME: Record<string, [number, string]> = {
  saved: [200, "saved"], invalid_request: [400, "invalid_body"], not_available: [404, "not_available"], not_connected: [409, "not_connected"], no_interaction: [409, "no_interaction"],
};

/** PUT { profile_id, rating, body? } - creates or edits the customer's own review. */
export async function saveMyReview(db: Db, customerId: string, body: unknown): Promise<Result> {
  const b = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  if (!b) return fail(400, "invalid_body");
  for (const k of Object.keys(b)) if (!["profile_id", "rating", "body"].includes(k)) return fail(400, "unexpected_field", k);
  if (!isUuid(b.profile_id)) return fail(400, "invalid_body", "profile_id");
  if (typeof b.rating !== "number" || !Number.isInteger(b.rating) || b.rating < 1 || b.rating > 5) return fail(400, "invalid_rating", "rating");
  if (b.body !== undefined && b.body !== null && (typeof b.body !== "string" || b.body.length > REVIEW_LIMITS.body)) return fail(400, "invalid_body", "body");
  const { data, error } = await db.rpc("review_save", { p_customer: customerId, p_profile: b.profile_id, p_rating: b.rating, p_body: (b.body as string | null | undefined) ?? null });
  if (error) {
    console.error(JSON.stringify({ scope: "reviews", result: "db_error", code: String(error?.code || "") }));
    return fail(500, "server_error");
  }
  const row = Array.isArray(data) ? data[0] : data;
  const [status, code] = OUTCOME[String(row?.out_outcome)] ?? [400, "invalid_body"];
  return status === 200 ? ok({ outcome: code }) : fail(status, code);
}

/** DELETE ?profile_id= - the customer removes their own review. */
export async function deleteMyReview(db: Db, customerId: string, profileId: string): Promise<Result> {
  if (!isUuid(profileId)) return fail(400, "invalid_body", "profile_id");
  const { error } = await db.from("profile_reviews").delete().eq("customer_id", customerId).eq("profile_id", profileId);
  return error ? fail(500, "server_error") : ok({ deleted: true });
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The business's side
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

export interface ReviewCtx {
  admin: Db;
  profile: { id: string; category?: string | null; categories?: string[] | null };
}

export async function listReviewsForOwner(ctx: ReviewCtx): Promise<Result> {
  if (!reviewsAvailable(ctx.profile)) return fail(404, "not_available");
  const { data, error } = await ctx.admin.from("profile_reviews").select("id, customer_id, rating, body, status, owner_reply, owner_replied_at, created_at, updated_at").eq("profile_id", ctx.profile.id).order("created_at", { ascending: false }).limit(200);
  if (error) return fail(500, "server_error");
  const rows = (data || []) as any[];
  const ids = [...new Set(rows.map((r) => r.customer_id))];
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const { data: cs } = await ctx.admin.from("ringo_customers").select("id, name").in("id", ids);
    for (const c of (cs || []) as any[]) names.set(c.id, publicName(c.name));
  }
  const published = rows.filter((r) => r.status === "published").map((r) => r.rating as number);
  return ok({
    summary: summarize(published),
    // the customer id is NOT returned: the owner moderates by review id and sees the same first name + initial as the public
    items: rows.map((r) => ({ id: r.id, reviewer: names.get(r.customer_id) || "", rating: r.rating, body: r.body, status: r.status, owner_reply: r.owner_reply, owner_replied_at: r.owner_replied_at, created_at: r.created_at })),
  });
}

/** PATCH { status?: "published" | "hidden", reply?: string | null } - hide, restore, or answer. The owner can never change the rating or the words. */
export async function moderateReview(ctx: ReviewCtx, id: string, body: unknown): Promise<Result> {
  if (!reviewsAvailable(ctx.profile)) return fail(404, "not_available");
  if (!isUuid(id)) return fail(404, "not_found");
  const b = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  if (!b) return fail(400, "invalid_body");
  for (const k of Object.keys(b)) if (!["status", "reply"].includes(k)) return fail(400, "unexpected_field", k);
  const patch: Record<string, unknown> = {};
  if (b.status !== undefined) {
    if (b.status !== "published" && b.status !== "hidden") return fail(400, "invalid_status", "status");
    patch.status = b.status;
  }
  if (b.reply !== undefined) {
    if (b.reply === null || b.reply === "") {
      patch.owner_reply = null;
      patch.owner_replied_at = null;
    } else if (typeof b.reply === "string" && b.reply.trim().length >= 1 && b.reply.trim().length <= REVIEW_LIMITS.reply) {
      patch.owner_reply = b.reply.trim();
      patch.owner_replied_at = new Date().toISOString();
    } else return fail(400, "invalid_reply", "reply");
  }
  if (Object.keys(patch).length === 0) return fail(400, "empty_update");
  const { data, error } = await ctx.admin.from("profile_reviews").update(patch).eq("id", id).eq("profile_id", ctx.profile.id).select("id, status, owner_reply");
  if (error) return fail(500, "server_error");
  if (!Array.isArray(data) || data.length === 0) return fail(404, "not_found");
  return ok({ item: data[0] });
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The public page
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

export interface PublicReview {
  reviewer: string;
  rating: number;
  body: string | null;
  owner_reply: string | null;
  created_at: string;
}

/** Published reviews of a published, non-church profile: a first name and initial, the stars, the words, the owner's reply. Nothing else. */
export async function publicReviews(db: Db, profile: { id: string; category?: string | null; categories?: string[] | null }): Promise<{ count: number; average: number | null; items: PublicReview[] }> {
  if (!reviewsAvailable(profile)) return { count: 0, average: null, items: [] };
  const { data } = await db.from("profile_reviews").select("customer_id, rating, body, owner_reply, created_at").eq("profile_id", profile.id).eq("status", "published").order("created_at", { ascending: false }).limit(1000);
  const rows = (data || []) as any[];
  const ids = [...new Set(rows.slice(0, REVIEW_PAGE).map((r) => r.customer_id))];
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const { data: cs } = await db.from("ringo_customers").select("id, name").in("id", ids);
    for (const c of (cs || []) as any[]) names.set(c.id, publicName(c.name));
  }
  const s = summarize(rows.map((r) => r.rating as number));
  return { ...s, items: rows.slice(0, REVIEW_PAGE).map((r) => ({ reviewer: names.get(r.customer_id) || "", rating: r.rating, body: r.body ?? null, owner_reply: r.owner_reply ?? null, created_at: r.created_at })) };
}
