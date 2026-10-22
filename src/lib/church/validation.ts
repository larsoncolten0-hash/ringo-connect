// Churches & Ministries People & Groups (Phase 2B): strict input validation for the /api/church/* routes. Pure: no I/O.
//
// Every body is an ALLOWLIST: a field that is not named here (profile_id, user_id, customer_id, source, is_child, created_by, removed_at ...) is refused, never ignored, so a forged
// value can never reach the database by being passed along. The database re-checks everything (constraints, RLS, guard triggers); this layer exists to answer clearly and early.

export const MEMBER_STATUSES = ["pending", "active", "inactive", "removed"] as const;
export const AGE_GROUPS = ["adult", "youth", "child"] as const;
export const LANGUAGES = ["en", "fr"] as const;
export const GROUP_KINDS = ["department", "group"] as const;
export const GROUP_STATUSES = ["active", "archived"] as const;
export const GROUP_ROLES = ["leader", "assistant", "member", "volunteer", "worker"] as const;

export type MemberStatus = (typeof MEMBER_STATUSES)[number];
export type AgeGroup = (typeof AGE_GROUPS)[number];
export type GroupKind = (typeof GROUP_KINDS)[number];
export type GroupStatus = (typeof GROUP_STATUSES)[number];
export type GroupRole = (typeof GROUP_ROLES)[number];

export type Invalid = { ok: false; code: string; field?: string };
export type Valid<T> = { ok: true; value: T };
export type Checked<T> = Valid<T> | Invalid;

const bad = (code: string, field?: string): Invalid => ({ ok: false, code, field });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === "string" && (list as readonly string[]).includes(v);

/** Refuses anything that is not a plain JSON object, and any key outside `allowed`. */
function plainObject(body: unknown, allowed: readonly string[]): Checked<Record<string, unknown>> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return bad("invalid_body");
  for (const k of Object.keys(body)) if (!allowed.includes(k)) return bad("unexpected_field", k);
  return { ok: true, value: body as Record<string, unknown> };
}

// ---- field parsers (each returns the cleaned value, or an Invalid) ------------------------------------------------------------------------------------------------
function text(v: unknown, field: string, min: number, max: number): Checked<string> {
  if (typeof v !== "string") return bad("invalid_" + field, field);
  const s = v.replace(/\s+/g, " ").trim();
  if (s.length < min || s.length > max) return bad("invalid_" + field, field);
  // control characters have no place in a name or a title (the \s above already folded tabs / newlines)
  if (/[\u0000-\u001f\u007f]/.test(s)) return bad("invalid_" + field, field);
  return { ok: true, value: s };
}

function optionalText(v: unknown, field: string, max: number, multiline = false): Checked<string | null> {
  if (v === null || v === undefined) return { ok: true, value: null };
  if (typeof v !== "string") return bad("invalid_" + field, field);
  const s = (multiline ? v.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ") : v.replace(/\s+/g, " ")).trim();
  if (s === "") return { ok: true, value: null };
  if (s.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s)) return bad("invalid_" + field, field);
  return { ok: true, value: s };
}

function phone(v: unknown): Checked<string | null> {
  if (v === null || v === undefined) return { ok: true, value: null };
  if (typeof v !== "string") return bad("invalid_phone", "phone");
  const s = v.trim();
  if (s === "") return { ok: true, value: null };
  const digits = s.replace(/\D/g, "");
  if (s.length > 40 || !/^\+?[0-9][0-9\s().-]*$/.test(s) || digits.length < 6 || digits.length > 15) return bad("invalid_phone", "phone");
  return { ok: true, value: s };
}

function email(v: unknown): Checked<string | null> {
  if (v === null || v === undefined) return { ok: true, value: null };
  if (typeof v !== "string") return bad("invalid_email", "email");
  const s = v.trim().toLowerCase();
  if (s === "") return { ok: true, value: null };
  if (s.length < 3 || s.length > 200 || !/^[^\s@,;()<>"]+@[^\s@,;()<>"]+\.[^\s@,;()<>"]{2,}$/.test(s)) return bad("invalid_email", "email");
  return { ok: true, value: s };
}

/** A real calendar date, YYYY-MM-DD, in a sane range (rejects 2026-02-31, 2026-13-01, "tomorrow", timestamps). null / "" = no date. */
export function parseDate(v: unknown, field: string): Checked<string | null> {
  if (v === null || v === undefined || v === "") return { ok: true, value: null };
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return bad("invalid_date", field);
  const [y, m, d] = v.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (y < 1900 || y > 2100 || dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return bad("invalid_date", field);
  return { ok: true, value: v };
}

function id(v: unknown, field: string): Checked<string> {
  return isUuid(v) ? { ok: true, value: v } : bad("invalid_" + field, field);
}
function optionalId(v: unknown, field: string): Checked<string | null> {
  if (v === null || v === undefined) return { ok: true, value: null };
  return id(v, field);
}

// ---- members -------------------------------------------------------------------------------------------------------------------------------------------------------
export const MEMBER_FIELDS = ["full_name", "phone", "email", "preferred_language", "status", "age_group", "guardian_member_id"] as const;

export interface MemberInput {
  full_name?: string;
  phone?: string | null;
  email?: string | null;
  preferred_language?: "en" | "fr" | null;
  status?: MemberStatus;
  age_group?: AgeGroup;
  guardian_member_id?: string | null;
}

export function parseMember(body: unknown, mode: "create" | "update"): Checked<MemberInput> {
  const o = plainObject(body, MEMBER_FIELDS);
  if (!o.ok) return o;
  const b = o.value;
  const out: MemberInput = {};
  if (mode === "create" && !has(b, "full_name")) return bad("invalid_full_name", "full_name");
  if (has(b, "full_name")) {
    const r = text(b.full_name, "full_name", 1, 120);
    if (!r.ok) return r;
    out.full_name = r.value;
  }
  if (has(b, "phone")) {
    const r = phone(b.phone);
    if (!r.ok) return r;
    out.phone = r.value;
  }
  if (has(b, "email")) {
    const r = email(b.email);
    if (!r.ok) return r;
    out.email = r.value;
  }
  if (has(b, "preferred_language")) {
    if (b.preferred_language !== null && !oneOf(LANGUAGES, b.preferred_language)) return bad("invalid_preferred_language", "preferred_language");
    out.preferred_language = b.preferred_language as "en" | "fr" | null;
  }
  if (has(b, "status")) {
    if (!oneOf(MEMBER_STATUSES, b.status)) return bad("invalid_status", "status");
    out.status = b.status;
  }
  if (has(b, "age_group")) {
    if (!oneOf(AGE_GROUPS, b.age_group)) return bad("invalid_age_group", "age_group");
    out.age_group = b.age_group;
  }
  if (has(b, "guardian_member_id")) {
    const r = optionalId(b.guardian_member_id, "guardian_member_id");
    if (!r.ok) return r;
    out.guardian_member_id = r.value;
  }
  if (mode === "update" && Object.keys(out).length === 0) return bad("empty_update");
  return { ok: true, value: out };
}

// ---- groups --------------------------------------------------------------------------------------------------------------------------------------------------------
export interface GroupInput {
  kind?: GroupKind;
  name?: string;
  description?: string | null;
  status?: GroupStatus;
}

export function parseGroup(body: unknown, mode: "create" | "update"): Checked<GroupInput> {
  // the kind (department | group) is chosen once, at creation
  const o = plainObject(body, mode === "create" ? ["kind", "name", "description", "status"] : ["name", "description", "status"]);
  if (!o.ok) return o;
  const b = o.value;
  const out: GroupInput = {};
  if (mode === "create") {
    if (!oneOf(GROUP_KINDS, b.kind)) return bad("invalid_kind", "kind");
    out.kind = b.kind;
    if (!has(b, "name")) return bad("invalid_name", "name");
  }
  if (has(b, "name")) {
    const r = text(b.name, "name", 1, 120);
    if (!r.ok) return r;
    out.name = r.value;
  }
  if (has(b, "description")) {
    const r = optionalText(b.description, "description", 500, true);
    if (!r.ok) return r;
    out.description = r.value;
  }
  if (has(b, "status")) {
    if (!oneOf(GROUP_STATUSES, b.status)) return bad("invalid_status", "status");
    out.status = b.status;
  }
  if (mode === "update" && Object.keys(out).length === 0) return bad("empty_update");
  return { ok: true, value: out };
}

export interface GroupMemberInput {
  member_id?: string;
  role?: GroupRole;
}

export function parseGroupMember(body: unknown, mode: "create" | "update"): Checked<GroupMemberInput> {
  const o = plainObject(body, mode === "create" ? ["member_id", "role"] : ["role"]);
  if (!o.ok) return o;
  const b = o.value;
  const out: GroupMemberInput = {};
  if (mode === "create") {
    const r = id(b.member_id, "member_id");
    if (!r.ok) return r;
    out.member_id = r.value;
  }
  if (has(b, "role") || mode === "update") {
    if (!oneOf(GROUP_ROLES, b.role)) return bad("invalid_role", "role");
    out.role = b.role;
  } else {
    out.role = "member";
  }
  return { ok: true, value: out };
}

// ---- leadership ----------------------------------------------------------------------------------------------------------------------------------------------------
export interface LeadershipInput {
  member_id?: string;
  title?: string;
  started_on?: string | null;
  ended_on?: string | null;
}

export function parseLeadership(body: unknown, mode: "create" | "update"): Checked<LeadershipInput> {
  // the person is fixed once an appointment exists: end it and create a new one instead
  const o = plainObject(body, mode === "create" ? ["member_id", "title", "started_on", "ended_on"] : ["title", "started_on", "ended_on"]);
  if (!o.ok) return o;
  const b = o.value;
  const out: LeadershipInput = {};
  if (mode === "create") {
    const r = id(b.member_id, "member_id");
    if (!r.ok) return r;
    out.member_id = r.value;
    if (!has(b, "title")) return bad("invalid_title", "title");
  }
  if (has(b, "title")) {
    const r = text(b.title, "title", 1, 80);
    if (!r.ok) return r;
    out.title = r.value;
  }
  for (const f of ["started_on", "ended_on"] as const) {
    if (has(b, f)) {
      const r = parseDate(b[f], f);
      if (!r.ok) return r;
      out[f] = r.value;
    }
  }
  if (out.started_on && out.ended_on && out.ended_on < out.started_on) return bad("invalid_date_range", "ended_on");
  if (mode === "update" && Object.keys(out).length === 0) return bad("empty_update");
  return { ok: true, value: out };
}

// ---- list queries --------------------------------------------------------------------------------------------------------------------------------------------------
export const PAGE_SIZE = 25;
export const MAX_PAGE = 2000;

export interface MemberListQuery {
  page: number;
  q: string | null;
  status: MemberStatus | null;
  age_group: AgeGroup | null;
  group_id: string | null;
}

export function parseMemberListQuery(params: URLSearchParams): Checked<MemberListQuery> {
  for (const k of Array.from(params.keys())) if (!["page", "q", "status", "age_group", "group_id"].includes(k)) return bad("unexpected_field", k);
  const page = params.get("page");
  let n = 1;
  if (page !== null) {
    if (!/^\d{1,5}$/.test(page) || Number(page) < 1 || Number(page) > MAX_PAGE) return bad("invalid_page", "page");
    n = Number(page);
  }
  const q = params.get("q");
  let search: string | null = null;
  if (q !== null && q.trim() !== "") {
    const s = q.replace(/\s+/g, " ").trim();
    if (s.length > 80 || /[\u0000-\u001f\u007f]/.test(s)) return bad("invalid_q", "q");
    search = s;
  }
  const status = params.get("status");
  if (status !== null && status !== "" && !oneOf(MEMBER_STATUSES, status)) return bad("invalid_status", "status");
  const age = params.get("age_group");
  if (age !== null && age !== "" && !oneOf(AGE_GROUPS, age)) return bad("invalid_age_group", "age_group");
  const group = params.get("group_id");
  if (group !== null && group !== "" && !isUuid(group)) return bad("invalid_group_id", "group_id");
  return {
    ok: true,
    value: { page: n, q: search, status: (status || null) as MemberStatus | null, age_group: (age || null) as AgeGroup | null, group_id: group || null },
  };
}

/** Escapes a search term for use inside a PostgREST `ilike` filter: the wildcard characters of LIKE and the characters that structure an `or(...)` filter lose their meaning. */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => "\\" + c).replace(/[,()*"]/g, " ").replace(/\s+/g, " ").trim();
}

export function parseGroupListQuery(params: URLSearchParams): Checked<{ status: GroupStatus | null; kind: GroupKind | null }> {
  for (const k of Array.from(params.keys())) if (!["status", "kind"].includes(k)) return bad("unexpected_field", k);
  const status = params.get("status");
  if (status !== null && status !== "" && !oneOf(GROUP_STATUSES, status)) return bad("invalid_status", "status");
  const kind = params.get("kind");
  if (kind !== null && kind !== "" && !oneOf(GROUP_KINDS, kind)) return bad("invalid_kind", "kind");
  return { ok: true, value: { status: (status || null) as GroupStatus | null, kind: (kind || null) as GroupKind | null } };
}

export function parseLeadershipListQuery(params: URLSearchParams): Checked<{ current: boolean | null; member_id: string | null }> {
  for (const k of Array.from(params.keys())) if (!["current", "member_id"].includes(k)) return bad("unexpected_field", k);
  const current = params.get("current");
  if (current !== null && current !== "" && current !== "true" && current !== "false") return bad("invalid_current", "current");
  const member = params.get("member_id");
  if (member !== null && member !== "" && !isUuid(member)) return bad("invalid_member_id", "member_id");
  return { ok: true, value: { current: current ? current === "true" : null, member_id: member || null } };
}
