import type { ChurchActor } from "../actor";
import { classifyDbError, failure } from "../errors";
import type { Result } from "../handlers";
import { isTimestamp, makeBodyParser } from "../lifecycle/validation";
import { escapeLike, isUuid, PAGE_SIZE } from "../validation";

// Churches & Ministries expansion, Phase 6: counselling requests, the STAFF side. Everything behind /api/church/counselling/**.
//
// A counselling request holds the most private words a church receives. So:
//   * only a person holding church.counselling.view (read) or church.counselling.manage (decide, note, delete) reaches it; the church owner holds both; nobody else, a platform admin included;
//   * every query goes through the user's own session, so row-level security decides what exists for them; the checks below only answer earlier and more clearly;
//   * the reason, the name and the contact details are returned only by the DETAIL read of one request (a list shows the name, the date and the status, never the reason);
//   * a change is the decision (approved / declined / pending) and a private note, nothing else; the version being changed is mandatory;
//   * a failure is a short code; nothing is logged but a code (never the reason, a name or a number).

const ok = (body: Record<string, unknown> = {}, status = 200): Result => ({ status, body: { ok: true, ...body } });
const fail = (status: number, code: string, field?: string): Result => failure(status, code, field);
const sameInstant = (a: unknown, b: unknown) => Date.parse(String(a)) === Date.parse(String(b));
type Row = Record<string, any>;

export const COUNSELLING_STATUSES = ["pending", "approved", "declined"] as const;
export type CounsellingStatus = (typeof COUNSELLING_STATUSES)[number];
const isStatus = (v: unknown): v is CounsellingStatus => typeof v === "string" && (COUNSELLING_STATUSES as readonly string[]).includes(v);

const LIST_COLS = "id, full_name, lang, status, decided_at, created_at, updated_at";
const DETAIL_COLS = "id, full_name, phone, email, reason, lang, status, decision_note, decided_at, created_at, updated_at";

const fromDb = (error: unknown): Result => {
  const o = classifyDbError(error as any);
  if (o.status >= 500) console.error(JSON.stringify({ scope: "church_counselling", result: "db_error", code: String((error as any)?.code || "") }));
  return fail(o.status, o.code);
};
const canRead = (a: ChurchActor) => a.kind !== "leader" && a.caps.viewCounselling;
const canDecide = (a: ChurchActor) => a.kind !== "leader" && a.caps.manageCounselling;

/** GET ?status=&page=&q= : the requests of the church, newest first. The reason is NOT in a list. */
export async function listCounselling(a: ChurchActor, params: URLSearchParams): Promise<Result> {
  if (!canRead(a)) return fail(403, "forbidden");
  for (const k of Array.from(params.keys())) if (!["status", "page", "q"].includes(k)) return fail(400, "unexpected_field", k);
  const status = params.get("status");
  if (status !== null && status !== "" && !isStatus(status)) return fail(400, "invalid_status", "status");
  const page = params.get("page");
  if (page !== null && (!/^\d{1,5}$/.test(page) || Number(page) < 1)) return fail(400, "invalid_page", "page");
  const n = page ? Number(page) : 1;
  const q = params.get("q");
  if (q !== null && (q.length > 80 || /[\u0000-\u001f\u007f]/.test(q))) return fail(400, "invalid_q", "q");
  const from = (n - 1) * PAGE_SIZE;
  let query = a.supabase.from("church_counselling_requests").select(LIST_COLS, { count: "exact" }).eq("profile_id", a.profileId);
  if (status) query = query.eq("status", status);
  if (q && q.trim()) {
    const term = escapeLike(q.replace(/\s+/g, " ").trim());
    if (term) query = query.ilike("full_name", `%${term}%`);
  }
  const { data, error, count } = await query.order("created_at", { ascending: false }).order("id", { ascending: true }).range(from, from + PAGE_SIZE - 1);
  if (error) return fromDb(error);
  const items = ((data as Row[]) || []).map((r) => ({ id: r.id, full_name: r.full_name, lang: r.lang, status: r.status, decided_at: r.decided_at, created_at: r.created_at, updated_at: r.updated_at }));
  const total = typeof count === "number" ? count : items.length;
  return ok({ items, page: n, pageSize: PAGE_SIZE, total, hasMore: from + items.length < total });
}

/** GET one request, with the reason and the contact details, and its history. */
export async function getCounselling(a: ChurchActor, id: string): Promise<Result> {
  if (!isUuid(id)) return fail(404, "not_found");
  if (!canRead(a)) return fail(403, "forbidden");
  const { data, error } = await a.supabase.from("church_counselling_requests").select(DETAIL_COLS).eq("id", id).eq("profile_id", a.profileId).maybeSingle();
  if (error) return fromDb(error);
  if (!data) return fail(404, "not_found");
  const h = await a.supabase.from("church_counselling_history").select("id, from_status, to_status, created_at").eq("request_id", id).eq("profile_id", a.profileId).order("created_at", { ascending: true }).limit(100);
  if (h.error) return fromDb(h.error);
  return ok({ item: data, history: (h.data as Row[]) || [], can_decide: canDecide(a) });
}

const parse = makeBodyParser({
  texts: { decision_note: { max: 500, multiline: true, code: "invalid_note" } },
  fields: { status: { check: (v, field) => (isStatus(v) ? { ok: true, value: v } : { ok: false, code: "invalid_status", field }) } },
});

/** PATCH { status?, decision_note?, expected_updated_at }: decide, and/or write the private note. */
export async function updateCounselling(a: ChurchActor, id: string, body: unknown): Promise<Result> {
  if (!isUuid(id)) return fail(404, "not_found");
  if (!canDecide(a)) return fail(403, "forbidden");
  const parsed = parse(body, "update");
  if (!parsed.ok) return fail(400, parsed.code, parsed.field);
  const { expected_updated_at: expected, ...changes } = parsed.value as Row;
  if (!isTimestamp(expected)) return fail(400, "invalid_body", "expected_updated_at");
  const cur = await a.supabase.from("church_counselling_requests").select("id, updated_at").eq("id", id).eq("profile_id", a.profileId).maybeSingle();
  if (cur.error) return fromDb(cur.error);
  if (!cur.data) return fail(404, "not_found");
  if (!sameInstant(expected, (cur.data as Row).updated_at)) return fail(409, "stale");
  const { data, error } = await a.supabase.from("church_counselling_requests").update(changes).eq("id", id).eq("profile_id", a.profileId).eq("updated_at", (cur.data as Row).updated_at).select(DETAIL_COLS);
  if (error) return fromDb(error);
  if (!Array.isArray(data) || data.length === 0) {
    const again = await a.supabase.from("church_counselling_requests").select("updated_at").eq("id", id).eq("profile_id", a.profileId).maybeSingle();
    return again.data && !sameInstant((again.data as Row).updated_at, (cur.data as Row).updated_at) ? fail(409, "stale") : fail(403, "forbidden");
  }
  return ok({ item: data[0] });
}

/** DELETE ?expected_updated_at= : remove a request (and its history). */
export async function deleteCounselling(a: ChurchActor, id: string, params: URLSearchParams): Promise<Result> {
  if (!isUuid(id)) return fail(404, "not_found");
  if (!canDecide(a)) return fail(403, "forbidden");
  for (const k of Array.from(params.keys())) if (k !== "expected_updated_at") return fail(400, "unexpected_field", k);
  const expected = params.get("expected_updated_at");
  if (!isTimestamp(expected)) return fail(400, "invalid_body", "expected_updated_at");
  const cur = await a.supabase.from("church_counselling_requests").select("id, updated_at").eq("id", id).eq("profile_id", a.profileId).maybeSingle();
  if (cur.error) return fromDb(cur.error);
  if (!cur.data) return fail(404, "not_found");
  if (!sameInstant(expected, (cur.data as Row).updated_at)) return fail(409, "stale");
  const { data, error } = await a.supabase.from("church_counselling_requests").delete().eq("id", id).eq("profile_id", a.profileId).eq("updated_at", (cur.data as Row).updated_at).select("id");
  if (error) return fromDb(error);
  if (!Array.isArray(data) || data.length === 0) return fail(409, "stale");
  return ok({ removed: 1 });
}

/** GET the number of requests waiting (for the home grid); a count, never a name. */
export async function countPending(a: ChurchActor): Promise<Result> {
  if (!canRead(a)) return fail(403, "forbidden");
  const { count, error } = await a.supabase.from("church_counselling_requests").select("id", { count: "exact", head: true }).eq("profile_id", a.profileId).eq("status", "pending");
  if (error) return fromDb(error);
  return ok({ pending: typeof count === "number" ? count : 0 });
}
