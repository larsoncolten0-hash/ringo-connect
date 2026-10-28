import type { ChurchActor } from "../actor";
import { makeCrud } from "../crud";
import { failure } from "../errors";
import type { Result } from "../handlers";
import { GIVING_AVAILABLE } from "../features/handlers";
import { booleanField, makeBodyParser, type FieldSpec } from "../lifecycle/validation";
import { has, type Checked } from "../validation";
import { FUND_LIMIT, GIVING_KINDS, GOAL_MAX_XAF, GOAL_MIN_XAF, type GivingKind } from "./kinds";

// Churches & Ministries expansion, Phase 7: the DEFINITIONS of a church's giving and care funds. Everything behind /api/church/giving-funds/**.
//
// A fund is a DEFINITION. THIS FILE COLLECTS NO MONEY (gifts live in ./gifts). A fund is a title, a short description, an optional goal and a published flag. There is no amount received, no donor, no payment, no receipt, no refund and no payout here, and
// nothing in this folder imports the Shop ledger or Fapshi. Collecting is a later step that needs five business decisions (docs/church-giving-decisions.md). Until then a fund can only be a draft or closed:
// "open" is refused here (409 giving_unavailable) and again by the database (church_giving_collection_open() answers false). Same rules as every church handler: the church is actor.profileId, the user's own
// session decides through row-level security, a refusal is a short code, the version being changed is mandatory.

export { GIVING_KINDS, FUND_LIMIT, GOAL_MIN_XAF, GOAL_MAX_XAF, type GivingKind } from "./kinds";
export const GIVING_STATUSES_SETTABLE = ["draft", "closed"] as const;
/** "open" (a fund that takes gifts) is settable only once collection is available; until then it is refused here (409 giving_unavailable) and again by the database. */
const settable = (): readonly string[] => (GIVING_AVAILABLE ? [...GIVING_STATUSES_SETTABLE, "open"] : GIVING_STATUSES_SETTABLE);

const isKind = (v: unknown): v is GivingKind => typeof v === "string" && (GIVING_KINDS as readonly string[]).includes(v);
const fail = (status: number, code: string, field?: string): Result => failure(status, code, field);

const kindField: FieldSpec = { required: true, check: (v, field) => (isKind(v) ? { ok: true, value: v } : { ok: false, code: "invalid_kind", field }) };
const titleField = (code: string): FieldSpec => ({
  required: true,
  check: (v, field) => {
    if (typeof v !== "string") return { ok: false, code, field };
    const s = v.replace(/\s+/g, " ").trim();
    return s.length >= 1 && s.length <= 120 && !/[\u0000-\u001f\u007f<>]/.test(s) ? { ok: true, value: s } : { ok: false, code, field };
  },
});
const goalField: FieldSpec = {
  check: (v, field) => {
    if (v === null || v === undefined || v === "") return { ok: true, value: null };
    return typeof v === "number" && Number.isInteger(v) && v >= GOAL_MIN_XAF && v <= GOAL_MAX_XAF ? { ok: true, value: v } : { ok: false, code: "invalid_goal", field };
  },
};
const statusField: FieldSpec = { check: (v, field) => (typeof v === "string" && settable().includes(v) ? { ok: true, value: v } : { ok: false, code: "invalid_status", field }) };

const parseBase = makeBodyParser({
  texts: { description_en: { max: 600, multiline: true, code: "invalid_description" }, description_fr: { max: 600, multiline: true, code: "invalid_description" } },
  fields: { kind: kindField, title_en: titleField("invalid_title"), title_fr: titleField("invalid_title"), goal_xaf: goalField, is_published: booleanField, status: statusField },
});
const parse = (body: unknown, mode: "create" | "update"): Checked<Record<string, unknown>> => {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const o = body as Record<string, unknown>;
    // a fund starts as a draft and the kind is chosen once, at creation
    if (mode === "create" && has(o, "status")) return { ok: false, code: "unexpected_field", field: "status" };
    if (mode === "update" && has(o, "kind")) return { ok: false, code: "unexpected_field", field: "kind" };
  }
  if (mode === "update") {
    // the kind is required by the shared parser on create only; give it a placeholder so an edit may leave it out, then drop it
    const base = parseBase({ kind: "giving", ...(body as object) }, "update");
    if (!base.ok) return base;
    const { kind: _kind, ...rest } = base.value;
    return Object.keys(rest).filter((k) => k !== "expected_updated_at").length === 0 ? { ok: false, code: "empty_update" } : { ok: true, value: rest };
  }
  return parseBase(body, mode);
};

export const FUND_COLS = "id, kind, title_en, title_fr, description_en, description_fr, goal_xaf, status, closed_at, is_published, created_at, updated_at";
const funds = makeCrud({
  table: "church_giving_funds",
  scope: "church_giving",
  cols: FUND_COLS,
  canRead: (a) => a.caps.manageGiving,
  canWrite: (a) => a.caps.manageGiving,
  parse,
  order: [["kind", true], ["created_at", true]],
  limit: FUND_LIMIT,
});

export const listFunds = funds.list;
export const deleteFund = funds.remove;

export async function createFund(a: ChurchActor, body: unknown): Promise<Result> {
  return funds.create(a, body);
}

export async function updateFund(a: ChurchActor, id: string, body: unknown): Promise<Result> {
  // opening a fund means collecting money: while it is not available, answer plainly before touching the database
  if (!GIVING_AVAILABLE && body && typeof body === "object" && !Array.isArray(body) && (body as Record<string, unknown>).status === "open") return fail(409, "giving_unavailable", "status");
  return funds.update(a, id, body);
}
