import { has, optionalText, parseDate, plainObject, type Checked } from "../validation";

// Strict input validation shared by the Events, Announcements and Bible-program routes. Pure: no I/O.
//
// A body is an ALLOWLIST: status, profile_id, created_by, published_at and every other column are refused, never ignored. Publishing and unpublishing are their own endpoints (with an explicit
// confirmation), so a plain create / edit can never change the status. Text is plain text only (it is rendered as text, never as markup). Empty text is stored as null.

export interface TextSpec {
  max: number;
  multiline: boolean;
  /** The short code returned for a too-long or malformed value (the UI has a sentence for it in both languages). */
  code: string;
}
export interface FieldSpec {
  check: (v: unknown, field: string) => Checked<unknown>;
  /** A create must carry it (and an edit that carries it may not blank it). */
  required?: boolean;
}

/** `expected_updated_at`: the version the editor was looking at. A real timestamp, short. */
export const isTimestamp = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 40 && !Number.isNaN(Date.parse(v));

export function makeBodyParser(opts: { texts: Record<string, TextSpec>; fields?: Record<string, FieldSpec> }) {
  const fields = opts.fields ?? {};
  return function parse(body: unknown, mode: "create" | "update"): Checked<Record<string, unknown>> {
    const o = plainObject(body, [...Object.keys(opts.texts), ...Object.keys(fields), ...(mode === "update" ? ["expected_updated_at"] : [])]);
    if (!o.ok) return o;
    const b = o.value;
    const out: Record<string, unknown> = {};
    for (const [name, spec] of Object.entries(fields)) {
      if (!has(b, name)) {
        if (mode === "create" && spec.required) return { ok: false, code: "invalid_" + name, field: name };
        continue;
      }
      const r = spec.check(b[name], name);
      if (!r.ok) return r;
      if (spec.required && (r.value === null || r.value === undefined)) return { ok: false, code: "invalid_" + name, field: name };
      out[name] = r.value;
    }
    for (const [name, spec] of Object.entries(opts.texts)) {
      if (!has(b, name)) continue;
      const r = optionalText(b[name], name, spec.max, spec.multiline);
      if (!r.ok) return { ok: false, code: spec.code, field: name };
      out[name] = r.value;
    }
    if (has(b, "expected_updated_at")) {
      if (!isTimestamp(b.expected_updated_at)) return { ok: false, code: "invalid_body", field: "expected_updated_at" };
      out.expected_updated_at = b.expected_updated_at;
    }
    if (mode === "update" && Object.keys(out).filter((k) => k !== "expected_updated_at").length === 0) return { ok: false, code: "empty_update" };
    return { ok: true, value: out };
  };
}

// ---- field checkers ---------------------------------------------------------------------------------------------------------------------------------------------

/** A real calendar date (YYYY-MM-DD), never empty. */
export const dateField: FieldSpec = {
  required: true,
  check: (v, field) => (v === null || v === undefined || v === "" ? { ok: false, code: "invalid_date", field } : parseDate(v, field)),
};

/** A date or nothing (null / "" clears it). */
export const optionalDateField: FieldSpec = { check: (v, field) => parseDate(v, field) };

/** A 24-hour time HH:MM, or nothing. */
export const timeField: FieldSpec = {
  check: (v, field) => {
    if (v === null || v === undefined || v === "") return { ok: true, value: null };
    if (typeof v !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) return { ok: false, code: "invalid_time", field };
    return { ok: true, value: v };
  },
};

export const booleanField: FieldSpec = {
  check: (v, field) => (typeof v === "boolean" ? { ok: true, value: v } : { ok: false, code: "invalid_body", field }),
};

/**
 * A link a visitor may be sent to: https only, a real host (a dot, no localhost, no raw IP), no credentials, no spaces or control characters, at most 500 characters. Returns the trimmed text
 * unchanged on success so what is stored is what the church typed. The database enforces the same shape (ministry_events_online_url_check).
 */
export function safeHttpsUrl(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (s.length < 12 || s.length > 500 || /[\s\u0000-\u001f\u007f]/.test(s)) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  if (!host.includes(".") || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[")) return null; // no raw IP address
  if (!/^[a-z0-9.-]+$/.test(host)) return null; // new URL() has already turned an international name into its xn-- form
  if (!/^https:\/\/[^\s/@?#]+\.[^\s/@?#]+([/?#]\S*)?$/.test(s)) return null; // the exact shape the database check accepts
  return s;
}

export const httpsUrlField: FieldSpec = {
  check: (v, field) => {
    if (v === null || v === undefined || (typeof v === "string" && v.trim() === "")) return { ok: true, value: null };
    const s = safeHttpsUrl(v);
    return s ? { ok: true, value: s } : { ok: false, code: "invalid_" + field, field };
  },
};
