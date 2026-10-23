import { has, optionalText, parseDate, plainObject, type Checked } from "../validation";

// Churches & Ministries Content Studio (Phase 3): strict input validation for the Daily Word routes. Pure: no I/O.
//
// A body is an ALLOWLIST: status, profile_id, created_by, published_at and every other column are refused, never ignored. Publishing and unpublishing are their own endpoints (with an explicit
// confirmation), so a plain create / edit can never change the status. Text is plain text only (it is rendered as text, never as markup). Empty text is stored as null.

export const WORD_TEXT_FIELDS = [
  "title_en", "title_fr", "scripture_ref_en", "scripture_ref_fr", "scripture_text_en", "scripture_text_fr", "body_en", "body_fr", "prayer_en", "prayer_fr",
] as const;
export type WordTextField = (typeof WORD_TEXT_FIELDS)[number];

const LIMITS: Record<string, { max: number; multiline: boolean; code: string }> = {
  title: { max: 120, multiline: false, code: "invalid_word_title" },
  scripture_ref: { max: 120, multiline: false, code: "invalid_word_reference" },
  scripture_text: { max: 1000, multiline: true, code: "invalid_word_scripture" },
  body: { max: 4000, multiline: true, code: "invalid_word_body" },
  prayer: { max: 1000, multiline: true, code: "invalid_word_prayer" },
};

export interface WordInput extends Partial<Record<WordTextField, string | null>> {
  publish_on?: string;
  /** The updated_at the editor last saw (edit only): the write is refused if the entry changed since. */
  expected_updated_at?: string;
}

export function parseWord(body: unknown, mode: "create" | "update"): Checked<WordInput> {
  const o = plainObject(body, [...WORD_TEXT_FIELDS, "publish_on", ...(mode === "update" ? ["expected_updated_at"] : [])]);
  if (!o.ok) return o;
  const b = o.value;
  const out: WordInput = {};
  if (mode === "create" || has(b, "publish_on")) {
    if (b.publish_on === null || b.publish_on === undefined || b.publish_on === "") return { ok: false, code: "invalid_date", field: "publish_on" };
    const d = parseDate(b.publish_on, "publish_on");
    if (!d.ok) return d;
    out.publish_on = d.value as string;
  }
  for (const f of WORD_TEXT_FIELDS) {
    if (!has(b, f)) continue;
    const kind = f.replace(/_(en|fr)$/, "");
    const lim = LIMITS[kind];
    const r = optionalText(b[f], f, lim.max, lim.multiline);
    if (!r.ok) return { ok: false, code: lim.code, field: f };
    out[f] = r.value;
  }
  if (has(b, "expected_updated_at")) {
    const v = b.expected_updated_at;
    if (typeof v !== "string" || v.length > 40 || Number.isNaN(Date.parse(v))) return { ok: false, code: "invalid_body", field: "expected_updated_at" };
    out.expected_updated_at = v;
  }
  if (mode === "update" && Object.keys(out).filter((k) => k !== "expected_updated_at").length === 0) return { ok: false, code: "empty_update" };
  return { ok: true, value: out };
}

/** The body of publish / unpublish: an explicit confirmation, and optionally the updated_at that was reviewed. */
export function parseConfirm(body: unknown): Checked<{ expected_updated_at?: string }> {
  const o = plainObject(body, ["confirm", "expected_updated_at"]);
  if (!o.ok) return o;
  if (o.value.confirm !== true) return { ok: false, code: "confirmation_required", field: "confirm" };
  if (has(o.value, "expected_updated_at")) {
    const v = o.value.expected_updated_at;
    if (typeof v !== "string" || v.length > 40 || Number.isNaN(Date.parse(v))) return { ok: false, code: "invalid_body", field: "expected_updated_at" };
    return { ok: true, value: { expected_updated_at: v } };
  }
  return { ok: true, value: {} };
}

/** The query of a DELETE (it has no body): the updated_at that was reviewed is mandatory, nothing else is allowed. */
export function parseDeleteQuery(params: URLSearchParams): Checked<{ expected_updated_at: string }> {
  for (const k of Array.from(params.keys())) if (k !== "expected_updated_at") return { ok: false, code: "unexpected_field", field: k };
  const all = params.getAll("expected_updated_at");
  const v = all[0];
  if (all.length !== 1 || !v || v.length > 40 || Number.isNaN(Date.parse(v))) return { ok: false, code: "invalid_body", field: "expected_updated_at" };
  return { ok: true, value: { expected_updated_at: v } };
}

export const WORD_VIEWS = ["all", "drafts", "scheduled", "published"] as const;
export type WordView = (typeof WORD_VIEWS)[number];
export const WORD_PAGE_SIZE = 20;

export function parseWordListQuery(params: URLSearchParams): Checked<{ view: WordView; page: number }> {
  for (const k of Array.from(params.keys())) if (!["view", "page"].includes(k)) return { ok: false, code: "unexpected_field", field: k };
  const view = params.get("view") || "all";
  if (!(WORD_VIEWS as readonly string[]).includes(view)) return { ok: false, code: "invalid_view", field: "view" };
  const page = params.get("page");
  let n = 1;
  if (page !== null) {
    if (!/^\d{1,4}$/.test(page) || Number(page) < 1 || Number(page) > 2000) return { ok: false, code: "invalid_page", field: "page" };
    n = Number(page);
  }
  return { ok: true, value: { view: view as WordView, page: n } };
}

/** A language is complete (can be published) when it has both a title and a body. */
export const isComplete = (title: unknown, body: unknown): boolean => typeof title === "string" && title.trim() !== "" && typeof body === "string" && body.trim() !== "";
