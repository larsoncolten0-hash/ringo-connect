import type { ChurchActor } from "../actor";
import { classifyDbError, failure } from "../errors";
import type { Result } from "../handlers";
import { makeLifecycle, type LifecycleSpec } from "../lifecycle/engine";
import { booleanField, imageUrlField, makeBodyParser } from "../lifecycle/validation";
import { has, isUuid, plainObject } from "../validation";

// Churches & Ministries Care & Support (Phase 9): the CASE and CONSENT data layer behind /api/church/care/**. There is NO money here: no amount, no contribution, no payment, no payout. Collecting
// money for a case is a later phase that needs decisions that are not made yet.
//
// A case follows the shared draft -> publish lifecycle (src/lib/church/lifecycle/engine.ts), so it gets the same rules as events: the church is the server-resolved actor's, every change carries the
// reviewed `expected_updated_at`, a write that row-level security filters away is reported as a refusal and a failure is a short code.
// On top of that, the privacy rules of Care (all enforced by the DATABASE; the checks here only answer earlier and more clearly):
//   * a case is a private DRAFT until it is published; publishing needs a recorded, granted consent (code needs_consent);
//   * recording a WITHDRAWN consent unpublishes the case at once;
//   * consent is only ever added, never edited or deleted;
//   * the person a case is for is a separate staff-only link; a child can never be linked (link the guardian);
//   * nothing of this reaches reports, Ringo AI, the public page's columns or the audit columns.

type Row = Record<string, any>;
const ok = (body: Record<string, unknown> = {}, status = 200): Result => ({ status, body: { ok: true, ...body } });
const fail = (status: number, code: string, field?: string): Result => failure(status, code, field);
const fromDb = (error: unknown): Result => {
  const o = classifyDbError(error as any);
  if (o.status >= 500) console.error(JSON.stringify({ scope: "church_care", result: "db_error", code: String((error as any)?.code || "") }));
  return fail(o.status, o.code);
};
const filled = (v: unknown): boolean => typeof v === "string" && v.trim() !== "";

export const CARE_CATEGORIES = ["medical", "education", "bereavement", "housing", "food", "other"] as const;
export const CONSENT_KINDS = ["granted", "withdrawn"] as const;
export const CONSENT_GIVEN_BY = ["beneficiary", "guardian"] as const;
export const CONSENT_METHODS = ["written", "verbal_witnessed"] as const;
export const CONSENT_HISTORY_LIMIT = 50;

const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === "string" && (list as readonly string[]).includes(v);

// ---- the case lifecycle -------------------------------------------------------------------------------------------------------------------------------------------

export const parseCase = makeBodyParser({
  texts: {
    title_en: { max: 120, multiline: false, code: "invalid_title" },
    title_fr: { max: 120, multiline: false, code: "invalid_title" },
    summary_en: { max: 2000, multiline: true, code: "invalid_summary" },
    summary_fr: { max: 2000, multiline: true, code: "invalid_summary" },
  },
  fields: {
    category: { check: (v, field) => (oneOf(CARE_CATEGORIES, v) ? { ok: true, value: v } : { ok: false, code: "invalid_category", field }) },
    // an optional picture, held to the same consent standard as the case: it can only be stored together with image_consent = true (the database refuses it otherwise)
    image_url: imageUrlField,
    image_consent: booleanField,
  },
});

const complete = (title: unknown, summary: unknown): boolean => filled(title) && filled(summary);
// the list needs no picture; one entry carries the picture and its confirmation (and falls back to the list's columns on a database that has not got them yet)
const CASE_LIST_COLS = "id, status, category, title_en, title_fr, summary_en, summary_fr, consent_state, published_at, created_at, updated_at";
const CASE_COLS = "id, status, category, title_en, title_fr, summary_en, summary_fr, image_url, image_consent, consent_state, published_at, created_at, updated_at";

const caseShape = (r: Row): Record<string, unknown> => ({
  ...r,
  state: r.status === "published" ? "published" : "draft",
  has_en: complete(r.title_en, r.summary_en),
  has_fr: complete(r.title_fr, r.summary_fr),
});

export const caseSpec: LifecycleSpec = {
  table: "ministry_care_cases",
  logScope: "church_care",
  cols: CASE_COLS,
  fallbackCols: CASE_LIST_COLS,
  listCols: CASE_LIST_COLS,
  caps: { view: (c) => c.viewCare, manage: (c) => c.manageCare, publish: (c) => c.publishCare },
  parse: parseCase,
  views: {
    all: (query) => query,
    drafts: (query) => query.eq("status", "draft"),
    published: (query) => query.eq("status", "published"),
  },
  orderBy: [["created_at", false]],
  // the text must be readable in one language; the CONSENT is checked by the database (care_consent_required -> needs_consent), which stays the authority
  publishable: (r) => complete(r.title_en, r.summary_en) || complete(r.title_fr, r.summary_fr),
  publishBlockedCode: "needs_title_and_summary",
  stateOf: (r) => (r.status === "published" ? "published" : "draft"),
  listItem: (r) => {
    const s = caseShape(r);
    return { id: s.id, status: s.status, state: s.state, category: s.category, title_en: s.title_en, title_fr: s.title_fr, consent_state: s.consent_state, has_en: s.has_en, has_fr: s.has_fr, updated_at: s.updated_at };
  },
  detail: (r) => caseShape(r),
};
export const cases = makeLifecycle(caseSpec);

// ---- consent ------------------------------------------------------------------------------------------------------------------------------------------------------

export function parseConsentBody(body: unknown): { ok: true; kind: (typeof CONSENT_KINDS)[number]; given_by: (typeof CONSENT_GIVEN_BY)[number]; method: (typeof CONSENT_METHODS)[number] } | { ok: false; code: string; field?: string } {
  const o = plainObject(body, ["kind", "given_by", "method"]);
  if (!o.ok) return o;
  const b = o.value;
  if (!has(b, "kind") || !oneOf(CONSENT_KINDS, b.kind)) return { ok: false, code: "invalid_consent_kind", field: "kind" };
  if (!has(b, "given_by") || !oneOf(CONSENT_GIVEN_BY, b.given_by)) return { ok: false, code: "invalid_consent_given_by", field: "given_by" };
  if (!has(b, "method") || !oneOf(CONSENT_METHODS, b.method)) return { ok: false, code: "invalid_consent_method", field: "method" };
  return { ok: true, kind: b.kind, given_by: b.given_by, method: b.method };
}

async function readCase(a: ChurchActor, id: string) {
  const { data, error } = await a.supabase.from("ministry_care_cases").select("id, status, consent_state, updated_at").eq("id", id).eq("profile_id", a.profileId).maybeSingle();
  return { row: (data as Row | null) ?? null, error };
}

export async function listConsent(a: ChurchActor, caseId: string): Promise<Result> {
  if (!isUuid(caseId)) return fail(404, "not_found");
  if (a.kind === "leader" || !a.caps.viewCare) return fail(403, "forbidden");
  const cur = await readCase(a, caseId);
  if (cur.error) return fromDb(cur.error);
  if (!cur.row) return fail(404, "not_found");
  const { data, error } = await a.supabase
    .from("ministry_care_consents")
    .select("id, kind, given_by, method, created_at")
    .eq("case_id", caseId)
    .eq("profile_id", a.profileId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })
    .limit(CONSENT_HISTORY_LIMIT);
  if (error) return fromDb(error);
  return ok({ consent_state: cur.row.consent_state, status: cur.row.status, items: (data as Row[]) || [] });
}

export async function recordConsent(a: ChurchActor, caseId: string, body: unknown): Promise<Result> {
  if (!isUuid(caseId)) return fail(404, "not_found");
  if (a.kind === "leader" || !a.caps.manageCare) return fail(403, "forbidden");
  const parsed = parseConsentBody(body);
  if (!parsed.ok) return fail(400, parsed.code, parsed.field);
  const cur = await readCase(a, caseId);
  if (cur.error) return fromDb(cur.error);
  if (!cur.row) return fail(404, "not_found");
  // recording what is already the current state would only add noise to a legal-looking record
  if (cur.row.consent_state === parsed.kind) return fail(409, "consent_unchanged");
  if (parsed.kind === "withdrawn" && cur.row.consent_state !== "granted") return fail(409, "consent_unchanged");
  const { error } = await a.supabase.from("ministry_care_consents").insert({ id: globalThis.crypto.randomUUID(), profile_id: a.profileId, case_id: caseId, kind: parsed.kind, given_by: parsed.given_by, method: parsed.method });
  if (error) return fromDb(error);
  const after = await readCase(a, caseId);
  return ok({ consent_state: after.row?.consent_state ?? null, status: after.row?.status ?? null, updated_at: after.row?.updated_at ?? null }, 201);
}

// ---- the private beneficiary link ----------------------------------------------------------------------------------------------------------------------------------

export function parseBeneficiaryBody(body: unknown): { ok: true; member_id: string } | { ok: false; code: string; field?: string } {
  const o = plainObject(body, ["member_id"]);
  if (!o.ok) return o;
  if (!isUuid(o.value.member_id)) return { ok: false, code: "invalid_member_id", field: "member_id" };
  return { ok: true, member_id: o.value.member_id };
}

export async function getBeneficiary(a: ChurchActor, caseId: string): Promise<Result> {
  if (!isUuid(caseId)) return fail(404, "not_found");
  if (a.kind === "leader" || !a.caps.viewCare) return fail(403, "forbidden");
  const cur = await readCase(a, caseId);
  if (cur.error) return fromDb(cur.error);
  if (!cur.row) return fail(404, "not_found");
  const { data, error } = await a.supabase.from("ministry_care_beneficiaries").select("member_id").eq("case_id", caseId).eq("profile_id", a.profileId).maybeSingle();
  if (error) return fromDb(error);
  if (!data) return ok({ beneficiary: null });
  // the name comes through the caller's OWN roster permission: without People view it stays hidden
  let name: string | null = null;
  if (a.caps.viewMembers) {
    const m = await a.supabase.from("church_members").select("full_name").eq("id", (data as Row).member_id).eq("profile_id", a.profileId).maybeSingle();
    if (!m.error && m.data) name = (m.data as Row).full_name ?? null;
  }
  return ok({ beneficiary: { member_id: (data as Row).member_id, name } });
}

export async function setBeneficiary(a: ChurchActor, caseId: string, body: unknown): Promise<Result> {
  if (!isUuid(caseId)) return fail(404, "not_found");
  if (a.kind === "leader" || !a.caps.manageCare) return fail(403, "forbidden");
  const parsed = parseBeneficiaryBody(body);
  if (!parsed.ok) return fail(400, parsed.code, parsed.field);
  const cur = await readCase(a, caseId);
  if (cur.error) return fromDb(cur.error);
  if (!cur.row) return fail(404, "not_found");
  const existing = await a.supabase.from("ministry_care_beneficiaries").select("member_id").eq("case_id", caseId).eq("profile_id", a.profileId).maybeSingle();
  if (existing.error) return fromDb(existing.error);
  if (existing.data) {
    const { data, error } = await a.supabase.from("ministry_care_beneficiaries").update({ member_id: parsed.member_id }).eq("case_id", caseId).eq("profile_id", a.profileId).select("case_id");
    if (error) return fromDb(error);
    if (!Array.isArray(data) || data.length === 0) return fail(403, "forbidden");
  } else {
    const { error } = await a.supabase.from("ministry_care_beneficiaries").insert({ case_id: caseId, profile_id: a.profileId, member_id: parsed.member_id });
    if (error) return fromDb(error);
  }
  return ok({ beneficiary: { member_id: parsed.member_id } });
}

export async function clearBeneficiary(a: ChurchActor, caseId: string): Promise<Result> {
  if (!isUuid(caseId)) return fail(404, "not_found");
  if (a.kind === "leader" || !a.caps.manageCare) return fail(403, "forbidden");
  const cur = await readCase(a, caseId);
  if (cur.error) return fromDb(cur.error);
  if (!cur.row) return fail(404, "not_found");
  const { data, error } = await a.supabase.from("ministry_care_beneficiaries").delete().eq("case_id", caseId).eq("profile_id", a.profileId).select("case_id");
  if (error) return fromDb(error);
  if (!Array.isArray(data) || data.length === 0) return fail(404, "not_found");
  return ok({ beneficiary: null });
}
