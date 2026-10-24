import type { ChurchActor } from "../actor";
import { classifyDbError, failure } from "../errors";
import { todayDouala, type Result } from "../handlers";
import { addDays, doualaDayStartUtc, isRealDay } from "../reports/period";
import { has, isUuid, optionalText, plainObject } from "../validation";
import { isTimestamp } from "../lifecycle/validation";

// Churches & Ministries Testimonies: the STAFF side, behind /api/church/testimonies/**. The submissions themselves arrive through the public route (src/app/api/public/church-testimony), never here.
//   * the church is always actor.profileId (server-resolved); every query goes through the user's own session, so row-level security and the guard triggers are the authority. The checks written here
//     only answer earlier and more clearly;
//   * the submitter's own words, phone and consent are NEVER written here. Staff can: review, correct the public text (a separate field, logged), write a private note, publish, unpublish, and RECORD a
//     withdrawal of consent. Nobody can grant or restore consent: the database refuses it;
//   * every change carries the `expected_updated_at` it was based on (400 missing / 409 changed meanwhile), and a write that row-level security filters away is reported as a refusal;
//   * a failure is a short code, never the database's message (it can quote a person's words).
// Permissions: view (read), manage (review, correct, note, withdraw, unpublish), publish (publish; also everything manage can do).

type Row = Record<string, any>;
const ok = (body: Record<string, unknown> = {}, status = 200): Result => ({ status, body: { ok: true, ...body } });
const fail = (status: number, code: string, field?: string): Result => failure(status, code, field);
const fromDb = (error: unknown): Result => {
  const o = classifyDbError(error as any);
  if (o.status >= 500) console.error(JSON.stringify({ scope: "church_testimonies", result: "db_error", code: String((error as any)?.code || "") }));
  return fail(o.status, o.code);
};
const sameInstant = (a: unknown, b: unknown) => Date.parse(String(a)) === Date.parse(String(b));

export const TESTIMONIES_PAGE_SIZE = 20;
export const REVIEW_STATUSES = ["submitted", "under_review", "approved", "rejected"] as const;
export const REVIEW_TARGETS = ["under_review", "approved", "rejected"] as const;
export const PUBLICATION_STATUSES = ["unpublished", "published"] as const;
export const PUBLIC_BODY_MIN = 10;
export const PUBLIC_BODY_MAX = 3000;
export const NOTE_MAX = 500;
export const HISTORY_LIMIT = 100;

const LIST_COLS = "id, full_name, phone, group_label, lang, publish_consent, name_consent, review_status, publication_status, created_at, updated_at, published_at";
const DETAIL_COLS = `${LIST_COLS}, body, public_body, moderation_note, consent_at, consent_withdrawn_at, reviewed_at, edited_at`;
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === "string" && (list as readonly string[]).includes(v);

const staffOnly = (a: ChurchActor) => a.kind !== "leader";
/** UX hints only: the database decides. */
const canDo = (a: ChurchActor, row: Row) => ({
  review: a.caps.manageTestimonies,
  edit: a.caps.manageTestimonies,
  publish: a.caps.publishTestimonies && row.review_status === "approved" && row.publish_consent === true && row.publication_status !== "published",
  unpublish: a.caps.manageTestimonies && row.publication_status === "published",
  withdraw: a.caps.manageTestimonies && row.publish_consent === true,
});
const shape = (r: Row) => ({ ...r, publicly_visible: r.publication_status === "published" && r.review_status === "approved" && r.publish_consent === true });

export function parseListQuery(params: URLSearchParams): { ok: true; status: string; publication: string; q: string; from: string | null; to: string | null; page: number } | { ok: false; code: string; field?: string } {
  for (const k of Array.from(params.keys())) if (!["status", "publication", "q", "from", "to", "page"].includes(k)) return { ok: false, code: "unexpected_field", field: k };
  for (const k of ["status", "publication", "q", "from", "to", "page"]) if (params.getAll(k).length > 1) return { ok: false, code: "unexpected_field", field: k };
  const status = params.get("status") ?? "all";
  if (status !== "all" && !oneOf(REVIEW_STATUSES, status)) return { ok: false, code: "invalid_filter", field: "status" };
  const publication = params.get("publication") ?? "all";
  if (publication !== "all" && !oneOf(PUBLICATION_STATUSES, publication)) return { ok: false, code: "invalid_filter", field: "publication" };
  const q = (params.get("q") ?? "").replace(/[%_\\,()]/g, " ").replace(/\s+/g, " ").trim();
  if (q.length > 80) return { ok: false, code: "invalid_filter", field: "q" };
  const from = params.get("from"), to = params.get("to");
  if (from !== null && !isRealDay(from)) return { ok: false, code: "invalid_report_date", field: "from" };
  if (to !== null && !isRealDay(to)) return { ok: false, code: "invalid_report_date", field: "to" };
  if (from !== null && to !== null && to < from) return { ok: false, code: "invalid_range", field: "to" };
  const page = params.get("page");
  if (page !== null && (!/^\d{1,4}$/.test(page) || Number(page) < 1 || Number(page) > 2000)) return { ok: false, code: "invalid_page", field: "page" };
  return { ok: true, status, publication, q, from, to, page: page === null ? 1 : Number(page) };
}

export async function listTestimonies(a: ChurchActor, params: URLSearchParams): Promise<Result> {
  if (!staffOnly(a) || !a.caps.viewTestimonies) return fail(403, "forbidden");
  const p = parseListQuery(params);
  if (!p.ok) return fail(400, p.code, p.field);
  const from = (p.page - 1) * TESTIMONIES_PAGE_SIZE;
  let q = a.supabase.from("ministry_testimonies").select(LIST_COLS, { count: "exact" }).eq("profile_id", a.profileId);
  if (p.status !== "all") q = q.eq("review_status", p.status);
  if (p.publication !== "all") q = q.eq("publication_status", p.publication);
  if (p.q) q = q.ilike("full_name", `%${p.q}%`);
  if (p.from) q = q.gte("created_at", doualaDayStartUtc(p.from));
  if (p.to) q = q.lt("created_at", doualaDayStartUtc(addDays(p.to, 1)));
  const { data, error, count } = await q.order("created_at", { ascending: false }).order("id", { ascending: true }).range(from, from + TESTIMONIES_PAGE_SIZE - 1);
  if (error) return fromDb(error);
  const rows = ((data as Row[]) || []).map(shape);
  const total = typeof count === "number" ? count : rows.length;
  return ok({ today: todayDouala(), items: rows, page: p.page, pageSize: TESTIMONIES_PAGE_SIZE, total, hasMore: from + rows.length < total });
}

async function readRow(a: ChurchActor, id: string, cols = DETAIL_COLS) {
  const { data, error } = await a.supabase.from("ministry_testimonies").select(cols).eq("id", id).eq("profile_id", a.profileId).maybeSingle();
  return { row: (data as Row | null) ?? null, error };
}

export async function getTestimony(a: ChurchActor, id: string): Promise<Result> {
  if (!isUuid(id)) return fail(404, "not_found");
  if (!staffOnly(a) || !a.caps.viewTestimonies) return fail(403, "forbidden");
  const { row, error } = await readRow(a, id);
  if (error) return fromDb(error);
  if (!row) return fail(404, "not_found");
  const h = await a.supabase.from("ministry_testimony_history").select("id, action, from_value, to_value, created_at").eq("testimony_id", id).eq("profile_id", a.profileId).order("created_at", { ascending: false }).order("id", { ascending: true }).limit(HISTORY_LIMIT);
  if (h.error) return fromDb(h.error);
  return ok({ item: shape(row), history: (h.data as Row[]) || [], can: canDo(a, row) });
}

// ---- shared steps of every change -----------------------------------------------------------------------------------------------------------------------------------

function expectedOf(body: Record<string, unknown>): { ok: true; value: string } | { ok: false; code: string; field: string } {
  if (!has(body, "expected_updated_at") || !isTimestamp(body.expected_updated_at)) return { ok: false, code: "invalid_body", field: "expected_updated_at" };
  return { ok: true, value: body.expected_updated_at as string };
}

/** Applies `patch` to the row the caller reviewed (and only if nobody changed it since), then returns the fresh row. */
async function applyChange(a: ChurchActor, id: string, cur: Row, patch: Record<string, unknown>): Promise<Result> {
  const { data, error } = await a.supabase.from("ministry_testimonies").update(patch).eq("id", id).eq("profile_id", a.profileId).eq("updated_at", cur.updated_at).select("id");
  if (error) return fromDb(error);
  if (!Array.isArray(data) || data.length === 0) {
    const again = await readRow(a, id, "id, updated_at");
    return again.row && !sameInstant(again.row.updated_at, cur.updated_at) ? fail(409, "stale") : fail(403, "forbidden");
  }
  const { row } = await readRow(a, id);
  return ok({ item: row ? shape(row) : null, can: row ? canDo(a, row) : null });
}

export async function reviewTestimony(a: ChurchActor, id: string, body: unknown): Promise<Result> {
  if (!isUuid(id)) return fail(404, "not_found");
  if (!staffOnly(a) || !a.caps.manageTestimonies) return fail(403, "forbidden");
  const o = plainObject(body, ["status", "expected_updated_at"]);
  if (!o.ok) return fail(400, o.code, o.field);
  if (!oneOf(REVIEW_TARGETS, o.value.status)) return fail(400, "invalid_status", "status");
  const exp = expectedOf(o.value);
  if (!exp.ok) return fail(400, exp.code, exp.field);
  const cur = await readRow(a, id);
  if (cur.error) return fromDb(cur.error);
  if (!cur.row) return fail(404, "not_found");
  if (cur.row.review_status === o.value.status) return fail(409, "status_unchanged");
  if (!sameInstant(exp.value, cur.row.updated_at)) return fail(409, "stale");
  // leaving "approved" or rejecting takes a live testimony down in the same statement (the database does it)
  return applyChange(a, id, cur.row, { review_status: o.value.status });
}

export function parseEditBody(body: unknown): { ok: true; patch: Record<string, string | null>; expected: string } | { ok: false; code: string; field?: string } {
  const o = plainObject(body, ["public_body", "moderation_note", "expected_updated_at"]);
  if (!o.ok) return o;
  const exp = expectedOf(o.value);
  if (!exp.ok) return exp;
  const patch: Record<string, string | null> = {};
  if (has(o.value, "public_body")) {
    if (o.value.public_body === null) patch.public_body = null; // go back to the submitter's own words
    else {
      const t = optionalText(o.value.public_body, "public_body", PUBLIC_BODY_MAX, true);
      if (!t.ok || t.value === null || t.value.length < PUBLIC_BODY_MIN) return { ok: false, code: "invalid_public_body", field: "public_body" };
      patch.public_body = t.value;
    }
  }
  if (has(o.value, "moderation_note")) {
    const n = optionalText(o.value.moderation_note, "moderation_note", NOTE_MAX, true);
    if (!n.ok) return { ok: false, code: "invalid_note", field: "moderation_note" };
    patch.moderation_note = n.value;
  }
  if (Object.keys(patch).length === 0) return { ok: false, code: "empty_update" };
  return { ok: true, patch, expected: exp.value };
}

export async function editTestimony(a: ChurchActor, id: string, body: unknown): Promise<Result> {
  if (!isUuid(id)) return fail(404, "not_found");
  if (!staffOnly(a) || !a.caps.manageTestimonies) return fail(403, "forbidden");
  const p = parseEditBody(body);
  if (!p.ok) return fail(400, p.code, p.field);
  const cur = await readRow(a, id);
  if (cur.error) return fromDb(cur.error);
  if (!cur.row) return fail(404, "not_found");
  if (!sameInstant(p.expected, cur.row.updated_at)) return fail(409, "stale");
  // a no-op "correction" would only add noise to the history
  const same = Object.entries(p.patch).every(([k, v]) => (cur.row as Row)[k] === v);
  if (same) return fail(409, "nothing_changed");
  return applyChange(a, id, cur.row, p.patch);
}

function confirmBody(body: unknown, extra: string[] = []) {
  const o = plainObject(body, ["confirm", "expected_updated_at", ...extra]);
  if (!o.ok) return o;
  if (o.value.confirm !== true) return { ok: false as const, code: "confirmation_required", field: "confirm" };
  const exp = expectedOf(o.value);
  if (!exp.ok) return exp;
  return { ok: true as const, value: o.value, expected: exp.value };
}

export async function publishTestimony(a: ChurchActor, id: string, body: unknown): Promise<Result> {
  if (!isUuid(id)) return fail(404, "not_found");
  if (!staffOnly(a) || !a.caps.publishTestimonies) return fail(403, "forbidden");
  const c = confirmBody(body);
  if (!c.ok) return fail(400, c.code, c.field);
  const cur = await readRow(a, id);
  if (cur.error) return fromDb(cur.error);
  if (!cur.row) return fail(404, "not_found");
  if (cur.row.publication_status === "published") return fail(409, "already_published");
  // approval and the submitter's consent are separate: both are needed, and neither can be supplied by staff
  if (cur.row.publish_consent !== true) return fail(409, "no_publish_consent");
  if (cur.row.review_status !== "approved") return fail(409, "not_approved");
  if (!sameInstant(c.expected, cur.row.updated_at)) return fail(409, "stale");
  return applyChange(a, id, cur.row, { publication_status: "published" });
}

export async function unpublishTestimony(a: ChurchActor, id: string, body: unknown): Promise<Result> {
  if (!isUuid(id)) return fail(404, "not_found");
  if (!staffOnly(a) || !a.caps.manageTestimonies) return fail(403, "forbidden");
  const c = confirmBody(body);
  if (!c.ok) return fail(400, c.code, c.field);
  const cur = await readRow(a, id);
  if (cur.error) return fromDb(cur.error);
  if (!cur.row) return fail(404, "not_found");
  if (cur.row.publication_status !== "published") return fail(409, "not_published");
  if (!sameInstant(c.expected, cur.row.updated_at)) return fail(409, "stale");
  return applyChange(a, id, cur.row, { publication_status: "unpublished" });
}

/** Records that the SUBMITTER withdrew a consent (on their request). "publication" also unpublishes and removes the name; "name" keeps the testimony but without the name. It can never be undone by staff. */
export async function withdrawConsent(a: ChurchActor, id: string, body: unknown): Promise<Result> {
  if (!isUuid(id)) return fail(404, "not_found");
  if (!staffOnly(a) || !a.caps.manageTestimonies) return fail(403, "forbidden");
  const c = confirmBody(body, ["scope"]);
  if (!c.ok) return fail(400, c.code, c.field);
  const scope = (c.value as Record<string, unknown>).scope;
  if (scope !== "publication" && scope !== "name") return fail(400, "invalid_scope", "scope");
  const cur = await readRow(a, id);
  if (cur.error) return fromDb(cur.error);
  if (!cur.row) return fail(404, "not_found");
  if (scope === "publication" && cur.row.publish_consent !== true) return fail(409, "consent_not_held");
  if (scope === "name" && cur.row.name_consent !== true) return fail(409, "consent_not_held");
  if (!sameInstant(c.expected, cur.row.updated_at)) return fail(409, "stale");
  return applyChange(a, id, cur.row, scope === "publication" ? { publish_consent: false } : { name_consent: false });
}
