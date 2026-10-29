import { formatPrice } from "@/lib/currency";
import { loadProfileAudience, loadConsentItems, type AudienceMember, type ConsentDb } from "@/lib/customer/consent";
import { getActiveConnection } from "@/lib/loyalty/customers";
import { isUuid, parseIdempotencyKey } from "@/lib/loyalty/validate";
import { countSegments, isSegment, loadSegments, segmentOf, SEGMENTS, type Segment } from "./segments";

// Promotions and offers (Phase 3): a business's discounts, optionally aimed at one customer segment, announced ONLY to the customers whose EFFECTIVE marketing consent allows that channel,
// and applied at the till by staff. This is not a POS and not a messaging platform: staff type the bill amount, the discount is computed and recorded; the announcement goes through the
// existing My Ringo push / bell and the existing marketing e-mail template, with the existing unsubscribe link.
//
// CONSENT. Who may be told about an offer is decided by decideConsent (lib/customer/consent.ts) - the same rule that governs everything else. Nothing here infers consent from a purchase, a
// church membership, a connection, giving, attendance or a default preference. A customer who has not agreed is neither sent the offer nor shown it in My Ringo. Using a code is NOT marketing and does
// not need consent; a code only works for an actively connected customer inside the offer's audience.
//
// PRIVACY. The business sees COUNTS (how many would receive it) and never a list of names, ids, e-mails or phone numbers. Staff identify a customer at the till through the connection id loyalty
// already uses; no customer id leaves the server.

export type Db = ConsentDb & { from(table: string): any };
export interface PromoCtx {
  admin: Db;
  userId: string;
  profile: { id: string; name: string | null; username: string; category?: string | null; categories?: string[] | null; currency: string | null };
}
export type Result = { status: number; body: Record<string, unknown> };
const ok = (body: Record<string, unknown> = {}, status = 200): Result => ({ status, body: { ok: true, ...body } });
const fail = (status: number, error: string, field?: string): Result => ({ status, body: { ok: false, error, ...(field ? { field } : {}) } });

export const PROMO_LIMITS = { title: 80, description: 400, maxActive: 20 } as const;
export const PROMO_KINDS = ["percent", "amount"] as const;
export const PROMO_AUDIENCES = ["all", ...SEGMENTS] as const;
export type PromoAudience = (typeof PROMO_AUDIENCES)[number];

export interface PromoRow {
  id: string;
  title: string;
  description: string | null;
  kind: "percent" | "amount";
  value: number;
  currency: string | null;
  code: string;
  audience: PromoAudience;
  starts_at: string | null;
  ends_at: string | null;
  max_redemptions: number | null;
  per_customer_limit: number;
  status: "draft" | "active" | "ended";
  sent_at: string | null;
  created_at: string;
  updated_at: string;
}
const COLUMNS = "id, title, description, kind, value, currency, code, audience, starts_at, ends_at, max_redemptions, per_customer_limit, status, sent_at, created_at, updated_at";

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function generateCode(random: (n: number) => number = (n) => Math.floor(Math.random() * n)): string {
  let out = "";
  for (let i = 0; i < 6; i++) out += CODE_ALPHABET[random(CODE_ALPHABET.length)];
  return out;
}

/** The discount for a bill (whole numbers: XAF has no decimals). Mirrors promotion_redeem in the database. */
export function discountFor(p: { kind: string; value: number }, amount: number): number {
  if (!Number.isInteger(amount) || amount < 1) return 0;
  return p.kind === "percent" ? Math.floor((amount * p.value) / 100) : Math.min(p.value, amount);
}

export function isLive(p: Pick<PromoRow, "status" | "starts_at" | "ends_at">, nowMs: number = Date.now()): boolean {
  if (p.status !== "active") return false;
  if (p.starts_at && Date.parse(p.starts_at) > nowMs) return false;
  if (p.ends_at && Date.parse(p.ends_at) <= nowMs) return false;
  return true;
}

export interface PromoInput {
  title?: string;
  description?: string | null;
  kind?: "percent" | "amount";
  value?: number;
  code?: string;
  audience?: PromoAudience;
  starts_at?: string | null;
  ends_at?: string | null;
  max_redemptions?: number | null;
  per_customer_limit?: number;
  status?: "active" | "ended";
}
type Parsed = { ok: true; value: PromoInput } | { ok: false; error: string; field?: string };

const isoOrNull = (v: unknown): string | null | undefined => {
  if (v === null) return null;
  if (typeof v !== "string" || v.length > 40) return undefined;
  const t = Date.parse(v);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
};

export function parsePromotionBody(body: unknown, mode: "create" | "update"): Parsed {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "invalid_body" };
  const b = body as Record<string, unknown>;
  const allowed = ["title", "description", "kind", "value", "code", "audience", "starts_at", "ends_at", "max_redemptions", "per_customer_limit", ...(mode === "update" ? ["status"] : [])];
  for (const k of Object.keys(b)) if (!allowed.includes(k)) return { ok: false, error: "unexpected_field", field: k };
  const out: PromoInput = {};
  if (b.title !== undefined || mode === "create") {
    const t = typeof b.title === "string" ? b.title.trim() : "";
    if (t.length < 1 || t.length > PROMO_LIMITS.title) return { ok: false, error: "invalid_title", field: "title" };
    out.title = t;
  }
  if (b.description !== undefined) {
    if (b.description === null || b.description === "") out.description = null;
    else if (typeof b.description === "string" && b.description.trim().length <= PROMO_LIMITS.description) out.description = b.description.trim();
    else return { ok: false, error: "invalid_description", field: "description" };
  }
  if (b.kind !== undefined || mode === "create") {
    if (b.kind !== "percent" && b.kind !== "amount") return { ok: false, error: "invalid_kind", field: "kind" };
    out.kind = b.kind;
  }
  if (b.value !== undefined || mode === "create") {
    if (typeof b.value !== "number" || !Number.isInteger(b.value) || b.value < 1) return { ok: false, error: "invalid_value", field: "value" };
    if ((out.kind ?? b.kind) === "percent" && b.value > 100) return { ok: false, error: "invalid_value", field: "value" };
    if (b.value > 100_000_000) return { ok: false, error: "invalid_value", field: "value" };
    out.value = b.value;
  }
  if (b.code !== undefined && b.code !== "") {
    const c = typeof b.code === "string" ? b.code.trim().toUpperCase() : "";
    if (!/^[A-Z0-9]{4,16}$/.test(c)) return { ok: false, error: "invalid_code", field: "code" };
    out.code = c;
  }
  if (b.audience !== undefined) {
    if (b.audience !== "all" && !isSegment(b.audience)) return { ok: false, error: "invalid_audience", field: "audience" };
    out.audience = b.audience as PromoAudience;
  }
  for (const f of ["starts_at", "ends_at"] as const) {
    if (b[f] === undefined) continue;
    const v = isoOrNull(b[f]);
    if (v === undefined) return { ok: false, error: "invalid_date", field: f };
    out[f] = v;
  }
  if (out.starts_at && out.ends_at && Date.parse(out.ends_at) <= Date.parse(out.starts_at)) return { ok: false, error: "invalid_window", field: "ends_at" };
  if (b.max_redemptions !== undefined) {
    if (b.max_redemptions === null) out.max_redemptions = null;
    else if (typeof b.max_redemptions === "number" && Number.isInteger(b.max_redemptions) && b.max_redemptions >= 1 && b.max_redemptions <= 1_000_000) out.max_redemptions = b.max_redemptions;
    else return { ok: false, error: "invalid_limit", field: "max_redemptions" };
  }
  if (b.per_customer_limit !== undefined) {
    if (typeof b.per_customer_limit !== "number" || !Number.isInteger(b.per_customer_limit) || b.per_customer_limit < 1 || b.per_customer_limit > 10) return { ok: false, error: "invalid_limit", field: "per_customer_limit" };
    out.per_customer_limit = b.per_customer_limit;
  }
  if (b.status !== undefined) {
    if (b.status !== "active" && b.status !== "ended") return { ok: false, error: "invalid_status", field: "status" };
    out.status = b.status;
  }
  if (mode === "update" && Object.keys(out).length === 0) return { ok: false, error: "empty_update" };
  return { ok: true, value: out };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The business's side
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

const dbFail = (error: any): Result => {
  const code = String(error?.code || "");
  if (code === "23505") return fail(409, "code_taken", "code");
  if (code === "23514" || code === "22P02") return fail(400, "invalid_body");
  console.error(JSON.stringify({ scope: "promotions", result: "db_error", code }));
  return fail(500, "server_error");
};

export async function getSegmentsSummary(ctx: PromoCtx): Promise<Result> {
  const s = await loadSegments(ctx.admin, ctx.profile.id);
  if (!s.ok) return fail(503, "unavailable");
  return ok({ counts: countSegments(s.map) });
}

export async function listPromotions(ctx: PromoCtx): Promise<Result> {
  const { data, error } = await ctx.admin.from("promotions").select(COLUMNS).eq("profile_id", ctx.profile.id).order("created_at", { ascending: false }).limit(100);
  if (error) return dbFail(error);
  const rows = (data || []) as PromoRow[];
  const counts = new Map<string, number>();
  if (rows.length > 0) {
    const { data: reds } = await ctx.admin.from("promotion_redemptions").select("promotion_id").eq("profile_id", ctx.profile.id).in("promotion_id", rows.map((r) => r.id)).limit(20000);
    for (const r of (reds || []) as Array<{ promotion_id: string }>) counts.set(r.promotion_id, (counts.get(r.promotion_id) || 0) + 1);
  }
  return ok({ items: rows.map((r) => ({ ...r, redemptions: counts.get(r.id) || 0, live: isLive(r) })), currency: ctx.profile.currency || "XAF" });
}

export async function createPromotion(ctx: PromoCtx, body: unknown): Promise<Result> {
  const parsed = parsePromotionBody(body, "create");
  if (!parsed.ok) return fail(400, parsed.error, parsed.field);
  const v = parsed.value;
  const { count } = await ctx.admin.from("promotions").select("id", { count: "exact", head: true }).eq("profile_id", ctx.profile.id).neq("status", "ended");
  if ((count ?? 0) >= PROMO_LIMITS.maxActive) return fail(422, "promotion_limit");
  const row = {
    profile_id: ctx.profile.id,
    title: v.title,
    description: v.description ?? null,
    kind: v.kind,
    value: v.value,
    // the currency is the business's own, never taken from the request
    currency: v.kind === "amount" ? ctx.profile.currency || "XAF" : null,
    code: v.code ?? generateCode(),
    audience: v.audience ?? "all",
    starts_at: v.starts_at ?? null,
    ends_at: v.ends_at ?? null,
    max_redemptions: v.max_redemptions ?? null,
    per_customer_limit: v.per_customer_limit ?? 1,
    created_by: ctx.userId,
  };
  const { data, error } = await ctx.admin.from("promotions").insert(row).select(COLUMNS);
  if (error) return dbFail(error);
  return ok({ item: Array.isArray(data) ? data[0] : data }, 201);
}

export async function updatePromotion(ctx: PromoCtx, id: string, body: unknown): Promise<Result> {
  if (!isUuid(id)) return fail(404, "not_found");
  const parsed = parsePromotionBody(body, "update");
  if (!parsed.ok) return fail(400, parsed.error, parsed.field);
  const v = parsed.value;
  const { data: cur } = await ctx.admin.from("promotions").select(COLUMNS).eq("id", id).eq("profile_id", ctx.profile.id).maybeSingle();
  if (!cur) return fail(404, "not_found");
  const row = cur as PromoRow;
  if (row.status === "ended") return fail(409, "promotion_ended");
  const patch: Record<string, unknown> = { ...v, updated_at: new Date().toISOString() };
  if (row.status === "active") {
    // an offer that is live keeps its terms: only its end, its cap, its description and its status can change
    const allowed = ["ends_at", "max_redemptions", "description", "status", "updated_at"];
    for (const k of Object.keys(patch)) if (!allowed.includes(k)) return fail(409, "promotion_locked", k);
  }
  if (v.kind === "amount") patch.currency = ctx.profile.currency || "XAF";
  if (v.kind === "percent") patch.currency = null;
  if (v.value !== undefined && (v.kind ?? row.kind) === "percent" && v.value > 100) return fail(400, "invalid_value", "value");
  const { data, error } = await ctx.admin.from("promotions").update(patch).eq("id", id).eq("profile_id", ctx.profile.id).select(COLUMNS);
  if (error) return dbFail(error);
  if (!Array.isArray(data) || data.length === 0) return fail(404, "not_found");
  return ok({ item: data[0] });
}

/** A draft that was never used can be deleted; anything else is ended and kept (what was sent and redeemed stays on record). */
export async function deletePromotion(ctx: PromoCtx, id: string): Promise<Result> {
  if (!isUuid(id)) return fail(404, "not_found");
  const { data: cur } = await ctx.admin.from("promotions").select("id, status, sent_at").eq("id", id).eq("profile_id", ctx.profile.id).maybeSingle();
  if (!cur) return fail(404, "not_found");
  if ((cur as any).status === "draft" && !(cur as any).sent_at) {
    const { error } = await ctx.admin.from("promotions").delete().eq("id", id).eq("profile_id", ctx.profile.id);
    return error ? dbFail(error) : ok({ deleted: true });
  }
  const { error } = await ctx.admin.from("promotions").update({ status: "ended", updated_at: new Date().toISOString() }).eq("id", id).eq("profile_id", ctx.profile.id);
  return error ? dbFail(error) : ok({ ended: true });
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The audience and the announcement
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

export interface Audience {
  inSegment: number;
  email: AudienceMember[];
  push: AudienceMember[];
}

export async function resolveAudience(admin: Db, profileId: string, audience: PromoAudience): Promise<{ ok: true; audience: Audience } | { ok: false }> {
  const segs = await loadSegments(admin, profileId);
  if (!segs.ok) return { ok: false };
  const ids = [...segs.map.entries()].filter(([, s]) => audience === "all" || s === audience).map(([id]) => id);
  const members = await loadProfileAudience(admin, profileId, ids);
  const list = [...members.values()];
  return { ok: true, audience: { inSegment: ids.length, email: list.filter((m) => m.email_decision.effective && !!m.manageToken && !!m.email), push: list.filter((m) => m.push_decision.effective) } };
}

/** How many people WOULD receive it - counts only, never who. */
export async function previewPromotion(ctx: PromoCtx, id: string): Promise<Result> {
  if (!isUuid(id)) return fail(404, "not_found");
  const { data } = await ctx.admin.from("promotions").select(COLUMNS).eq("id", id).eq("profile_id", ctx.profile.id).maybeSingle();
  if (!data) return fail(404, "not_found");
  const a = await resolveAudience(ctx.admin, ctx.profile.id, (data as PromoRow).audience);
  if (!a.ok) return fail(503, "unavailable");
  return ok({ in_segment: a.audience.inSegment, email: a.audience.email.length, push: a.audience.push.length, already_sent: !!(data as PromoRow).sent_at });
}

export interface Senders {
  sendEmail: (input: { to: string; subject: string; html: string; replyTo?: string | null }) => Promise<{ ok: boolean }>;
  notifyCustomer: (customerId: string, payload: { category: string; title: string; body: string; url: string }, options: { profileId: string }) => Promise<boolean>;
  renderEmail(input: { creatorName: string; title: string; message: string; ctaUrl: string; ctaLabel: string; manageUrl: string; unsubscribeUrl: string }): string;
  siteUrl: string;
}

const L = {
  en: { code: "Code", off: (v: string) => `${v} off`, view: "View offer", until: (d: string) => `until ${d}` },
  fr: { code: "Code", off: (v: string) => `${v} de réduction`, view: "Voir l'offre", until: (d: string) => `jusqu'au ${d}` },
} as const;

export function offerText(p: Pick<PromoRow, "kind" | "value" | "currency" | "code" | "description" | "ends_at">, lang: "en" | "fr"): string {
  const t = L[lang];
  const amount = p.kind === "percent" ? `${p.value}%` : formatPrice(p.value, p.currency || "XAF", lang);
  const parts = [t.off(amount), `${t.code}: ${p.code}`];
  if (p.ends_at) parts.push(t.until(new Date(p.ends_at).toLocaleDateString(lang === "fr" ? "fr-FR" : "en-GB", { day: "numeric", month: "short", year: "numeric" })));
  return (p.description ? `${p.description}\n` : "") + parts.join(" · ");
}

/**
 * Announces an offer ONCE, to the customers whose effective consent allows the channel: e-mail only where the e-mail decision is "on" (and an unsubscribe link exists), push (My Ringo bell and
 * device) only where the push decision is "on". Nobody else is contacted. The send is claimed atomically (sent_at), so it cannot run twice, and each delivery is recorded.
 */
export async function sendPromotion(ctx: PromoCtx, id: string, body: unknown, senders: Senders): Promise<Result> {
  if (!isUuid(id)) return fail(404, "not_found");
  const { data } = await ctx.admin.from("promotions").select(COLUMNS).eq("id", id).eq("profile_id", ctx.profile.id).maybeSingle();
  if (!data) return fail(404, "not_found");
  if (!body || typeof body !== "object" || (body as any).confirm !== true) return fail(400, "confirmation_required", "confirm");
  const p = data as PromoRow;
  if (p.status !== "active" || !isLive(p)) return fail(409, "promotion_not_live");
  if (p.sent_at) return fail(409, "already_sent");

  const a = await resolveAudience(ctx.admin, ctx.profile.id, p.audience);
  if (!a.ok) return fail(503, "unavailable");

  // claim: only one request can ever pass this point for an offer
  const { data: claimed, error } = await ctx.admin.from("promotions").update({ sent_at: new Date().toISOString() }).eq("id", id).eq("profile_id", ctx.profile.id).is("sent_at", null).select("id");
  if (error) return dbFail(error);
  if (!Array.isArray(claimed) || claimed.length === 0) return fail(409, "already_sent");

  const creatorName = ctx.profile.name || ctx.profile.username;
  const pageUrl = `${senders.siteUrl}/${ctx.profile.username}`;
  let emailSent = 0;
  let pushSent = 0;
  const record = async (customerId: string, channel: "email" | "push", basis: string) => {
    const { error: e } = await ctx.admin.from("promotion_deliveries").insert({ promotion_id: id, profile_id: ctx.profile.id, customer_id: customerId, channel, basis });
    if (e && String(e.code) !== "23505") console.error(JSON.stringify({ scope: "promotions", result: "delivery_record_failed" }));
  };

  for (const m of a.audience.email) {
    const msg = offerText(p, m.language);
    const manageUrl = `${senders.siteUrl}/community/manage/${m.manageToken}`;
    const html = senders.renderEmail({ creatorName, title: p.title, message: msg, ctaUrl: pageUrl, ctaLabel: L[m.language].view, manageUrl, unsubscribeUrl: manageUrl });
    const r = await senders.sendEmail({ to: m.email, subject: p.title, html });
    if (r.ok) {
      emailSent++;
      await record(m.customerId, "email", m.email_decision.basis === "ledger" ? "ledger" : "legacy");
    }
  }
  for (const m of a.audience.push) {
    const delivered = await senders.notifyCustomer(m.customerId, { category: "promotion_offer", title: p.title, body: offerText(p, m.language).slice(0, 160), url: pageUrl }, { profileId: ctx.profile.id });
    if (delivered) {
      pushSent++;
      await record(m.customerId, "push", m.push_decision.basis === "ledger" ? "ledger" : "legacy");
    }
  }
  return ok({ email_sent: emailSent, push_sent: pushSent, email_eligible: a.audience.email.length, push_eligible: a.audience.push.length });
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// At the till
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

const OUTCOME_STATUS: Record<string, number> = {
  redeemed: 200, already_recorded: 200, invalid_request: 400, invalid_amount: 400, not_found: 404, not_active: 409, not_started: 409, expired: 409, not_connected: 409, not_eligible: 409, limit_reached: 409, customer_limit_reached: 409,
};

/** { connection_id, promotion_id, amount, key }: the customer is identified the way loyalty does (a connection of THIS business), the amount is the bill. */
export async function redeemPromotion(ctx: PromoCtx, body: unknown): Promise<Result> {
  const b = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  if (!b) return fail(400, "invalid_body");
  for (const k of Object.keys(b)) if (!["connection_id", "promotion_id", "amount", "key"].includes(k)) return fail(400, "unexpected_field", k);
  const key = parseIdempotencyKey(b.key);
  if (!isUuid(b.connection_id) || !isUuid(b.promotion_id) || !key) return fail(400, "invalid_body");
  if (typeof b.amount !== "number" || !Number.isInteger(b.amount) || b.amount < 1 || b.amount > 1_000_000_000) return fail(400, "invalid_amount", "amount");
  const conn = await getActiveConnection(ctx.profile.id, b.connection_id, ctx.admin as any);
  if (!conn) return fail(409, "not_connected");
  const { data, error } = await ctx.admin.rpc("promotion_redeem", { p_profile: ctx.profile.id, p_promotion: b.promotion_id, p_customer: conn.customerId, p_staff: ctx.userId, p_amount: b.amount, p_key: key });
  if (error) return dbFail(error);
  const row = Array.isArray(data) ? data[0] : data;
  const outcome = String(row?.out_outcome || "invalid_request");
  const status = OUTCOME_STATUS[outcome] ?? 400;
  return { status, body: { ok: status === 200, outcome, discount: row?.out_discount ?? null, redemption_id: row?.out_redemption_id ?? null } };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The customer's side: offers shown in My Ringo
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

export interface CustomerOffer {
  profile_id: string;
  profile_name: string;
  promotion: Pick<PromoRow, "id" | "title" | "description" | "kind" | "value" | "currency" | "code" | "ends_at">;
}

/**
 * The live offers a signed-in customer may see. An offer is shown only for a profile where the customer's EFFECTIVE marketing consent is on for at least one channel, only when its audience
 * matches the customer's segment there, and only while it can still be used by them. A customer who has not agreed sees nothing here (a code can still be used by someone who was given it).
 */
export async function offersForCustomer(db: Db, customer: { id: string; emailConfirmed: boolean }): Promise<CustomerOffer[]> {
  const { items } = await loadConsentItems(db, customer);
  const consenting = items.filter((i) => i.email.effective || i.push.effective);
  const out: CustomerOffer[] = [];
  for (const item of consenting) {
    const segment = await segmentOf(db, item.profile_id, customer.id);
    if (!segment) continue;
    const { data } = await db.from("promotions").select("id, title, description, kind, value, currency, code, audience, starts_at, ends_at, max_redemptions, per_customer_limit, status").eq("profile_id", item.profile_id).eq("status", "active").limit(50);
    for (const p of (data || []) as PromoRow[]) {
      if (!isLive(p) || (p.audience !== "all" && p.audience !== segment)) continue;
      const { data: reds } = await db.from("promotion_redemptions").select("customer_id").eq("promotion_id", p.id).limit(1000000);
      const all = (reds || []) as Array<{ customer_id: string }>;
      if (p.max_redemptions !== null && all.length >= p.max_redemptions) continue;
      if (all.filter((r) => r.customer_id === customer.id).length >= p.per_customer_limit) continue;
      out.push({ profile_id: item.profile_id, profile_name: item.profile_name, promotion: { id: p.id, title: p.title, description: p.description, kind: p.kind, value: p.value, currency: p.currency, code: p.code, ends_at: p.ends_at } });
    }
  }
  return out;
}

export type { Segment };
