import type { ChurchActor } from "../actor";
import { classifyDbError, failure } from "../errors";
import { todayDouala, type Result } from "../handlers";
import type { ChurchCapabilities } from "../permissions";
import { isUuid, type Checked } from "../validation";
import { parseConfirm, parseDeleteQuery } from "../content/validation";

// Churches & Ministries: the shared draft -> publish lifecycle behind the Events, Announcements and Bible-program routes (Phases 4 and 5). It is the Phase 3 Daily Word handler
// (src/lib/church/content/handlers.ts) turned into a factory, so every entity follows EXACTLY the same rules:
//   * the church is always actor.profileId (server-resolved), never read from a request;
//   * every query goes through the user's own session, so the table's row-level security and guard trigger are the authority; the permission checks written here only answer earlier and more
//     clearly, and are never the only protection;
//   * a write that row-level security filters away raises no error, it touches zero rows: every update / delete asks for the affected rows back and reports a refusal, never a success;
//   * a failure is returned as a short code, never as the database's own message;
//   * columns are always listed explicitly (the audit columns are not readable by any API role);
//   * EVERY change to an existing entry (edit, publish, unpublish, delete) must carry the `expected_updated_at` it was based on: missing or invalid -> 400, changed meanwhile -> 409;
//   * checks run in a meaningful order: not-a-uuid / no permission (403) / not found (404, also for another church's entry) / state conflicts (409) / the timestamp (400, 409) / content rules (422).
// Publishing and unpublishing are explicit (a `confirm: true` body) and need the publish permission; creating and editing DRAFTS needs the manage permission (or publish).

type Row = Record<string, any>;

export interface LifecycleSpec {
  /** The table, e.g. "ministry_events". */
  table: string;
  /** Scope word for the server log line. Never contains data. */
  logScope: string;
  /** Columns of ONE entry (no audit columns). */
  cols: string;
  /** Columns of a list row. */
  listCols: string;
  caps: { view: (c: ChurchCapabilities) => boolean; manage: (c: ChurchCapabilities) => boolean; publish: (c: ChurchCapabilities) => boolean };
  /** Validates a create / edit body. The result may carry `expected_updated_at` (edit only). */
  parse: (body: unknown, mode: "create" | "update") => Checked<Record<string, unknown>>;
  /** The list filters offered, by name. Must contain "all". Each receives the query and today's date (Africa/Douala). */
  views: Record<string, (query: any, today: string) => any>;
  orderBy: Array<[column: string, ascending: boolean]>;
  /** May this saved entry be published? */
  publishable: (row: Row) => boolean;
  /** The code returned when it may not. */
  publishBlockedCode: string;
  stateOf: (row: Row, today: string) => string;
  listItem: (row: Row, today: string) => Record<string, unknown>;
  detail: (row: Row, today: string) => Record<string, unknown>;
  /** Shapes a freshly created / changed row for the answer (defaults to detail). */
  answer?: (row: Row, today: string) => Record<string, unknown>;
}

export const LIFECYCLE_PAGE_SIZE = 20;

const ok = (body: Record<string, unknown> = {}, status = 200): Result => ({ status, body: { ok: true, ...body } });
const fail = (status: number, code: string, field?: string): Result => failure(status, code, field);
const invalid = (r: { code: string; field?: string }): Result => fail(400, r.code, r.field);
const newId = (): string => globalThis.crypto.randomUUID();
const sameInstant = (a: unknown, b: unknown) => Date.parse(String(a)) === Date.parse(String(b));

export function parseLifecycleListQuery(params: URLSearchParams, views: readonly string[]): Checked<{ view: string; page: number }> {
  for (const k of Array.from(params.keys())) if (!["view", "page"].includes(k)) return { ok: false, code: "unexpected_field", field: k };
  const view = params.get("view") || "all";
  if (!views.includes(view)) return { ok: false, code: "invalid_view", field: "view" };
  const page = params.get("page");
  let n = 1;
  if (page !== null) {
    if (!/^\d{1,4}$/.test(page) || Number(page) < 1 || Number(page) > 2000) return { ok: false, code: "invalid_page", field: "page" };
    n = Number(page);
  }
  return { ok: true, value: { view, page: n } };
}

export function makeLifecycle(spec: LifecycleSpec) {
  const q = (a: ChurchActor) => a.supabase.from(spec.table);
  const fromDb = (error: unknown): Result => {
    const o = classifyDbError(error as any);
    if (o.status >= 500) console.error(JSON.stringify({ scope: spec.logScope, result: "db_error", code: String((error as any)?.code || "") }));
    return fail(o.status, o.code);
  };
  const shape = spec.answer ?? spec.detail;

  async function readRow(a: ChurchActor, id: string, cols = spec.cols) {
    const { data, error } = await q(a).select(cols).eq("id", id).eq("profile_id", a.profileId).maybeSingle();
    return { row: (data as Row | null) ?? null, error };
  }

  /** What the caller may do with this row. UX hints only; the database decides. */
  const canDo = (a: ChurchActor, row: Row) => {
    const live = row.status === "published";
    const manage = spec.caps.manage(a.caps);
    const publish = spec.caps.publish(a.caps);
    return { edit: live ? publish : manage, delete: live ? publish : manage, publish: !live && publish, unpublish: live && publish };
  };
  const contentOf = (v: Record<string, unknown>): Record<string, unknown> => {
    const { expected_updated_at: _e, ...rest } = v;
    return rest;
  };

  async function list(a: ChurchActor, params: URLSearchParams): Promise<Result> {
    if (!spec.caps.view(a.caps)) return fail(403, "forbidden");
    const parsed = parseLifecycleListQuery(params, Object.keys(spec.views));
    if (!parsed.ok) return invalid(parsed);
    const { view, page } = parsed.value;
    const today = todayDouala();
    const from = (page - 1) * LIFECYCLE_PAGE_SIZE;
    let query = q(a).select(spec.listCols, { count: "exact" }).eq("profile_id", a.profileId);
    query = spec.views[view](query, today);
    for (const [col, asc] of spec.orderBy) query = query.order(col, { ascending: asc });
    const { data, error, count } = await query.order("id", { ascending: true }).range(from, from + LIFECYCLE_PAGE_SIZE - 1);
    if (error) return fromDb(error);
    const rows = (data as Row[]) || [];
    const total = typeof count === "number" ? count : rows.length;
    return ok({ today, items: rows.map((r) => spec.listItem(r, today)), page, pageSize: LIFECYCLE_PAGE_SIZE, total, hasMore: from + rows.length < total });
  }

  async function get(a: ChurchActor, id: string): Promise<Result> {
    if (!isUuid(id)) return fail(404, "not_found");
    if (!spec.caps.view(a.caps)) return fail(403, "forbidden");
    const { row, error } = await readRow(a, id);
    if (error) return fromDb(error);
    if (!row) return fail(404, "not_found");
    const today = todayDouala();
    return ok({ item: spec.detail(row, today), can: canDo(a, row), today });
  }

  async function create(a: ChurchActor, body: unknown): Promise<Result> {
    if (a.kind === "leader" || !spec.caps.manage(a.caps)) return fail(403, "forbidden");
    const parsed = spec.parse(body, "create");
    if (!parsed.ok) return invalid(parsed);
    const id = newId();
    // always a DRAFT: the status is not a field a client can send, and the policy refuses a non-publisher a published row anyway
    const { error } = await q(a).insert({ id, profile_id: a.profileId, status: "draft", ...contentOf(parsed.value) });
    if (error) return fromDb(error);
    const { row } = await readRow(a, id);
    return ok({ id, item: row ? shape(row, todayDouala()) : null }, 201);
  }

  async function update(a: ChurchActor, id: string, body: unknown): Promise<Result> {
    if (!isUuid(id)) return fail(404, "not_found");
    if (a.kind === "leader" || !spec.caps.manage(a.caps)) return fail(403, "forbidden");
    const parsed = spec.parse(body, "update");
    if (!parsed.ok) return invalid(parsed);
    const cur = await readRow(a, id);
    if (cur.error) return fromDb(cur.error);
    if (!cur.row) return fail(404, "not_found");
    // a LIVE entry is public the moment it is saved: only the publish permission may change it
    if (cur.row.status === "published" && !spec.caps.publish(a.caps)) return fail(403, "publish_required");
    const expected = parsed.value.expected_updated_at as string | undefined;
    if (!expected) return invalid({ code: "invalid_body", field: "expected_updated_at" }); // the reviewed version is mandatory
    if (!sameInstant(expected, cur.row.updated_at)) return fail(409, "stale");
    // the write only lands if nobody saved in between
    const { data, error } = await q(a).update(contentOf(parsed.value)).eq("id", id).eq("profile_id", a.profileId).eq("updated_at", cur.row.updated_at).select("id");
    if (error) return fromDb(error);
    if (!Array.isArray(data) || data.length === 0) {
      const again = await readRow(a, id, "id, updated_at");
      return again.row && !sameInstant(again.row.updated_at, cur.row.updated_at) ? fail(409, "stale") : fail(403, "forbidden");
    }
    const { row } = await readRow(a, id);
    return ok({ item: row ? shape(row, todayDouala()) : null });
  }

  async function remove(a: ChurchActor, id: string, params: URLSearchParams): Promise<Result> {
    if (!isUuid(id)) return fail(404, "not_found");
    if (a.kind === "leader" || !spec.caps.manage(a.caps)) return fail(403, "forbidden");
    const cur = await readRow(a, id, "id, status, updated_at");
    if (cur.error) return fromDb(cur.error);
    if (!cur.row) return fail(404, "not_found");
    if (cur.row.status === "published" && !spec.caps.publish(a.caps)) return fail(403, "publish_required");
    // a DELETE has no body: the version that was reviewed travels in the query (?expected_updated_at=...), mandatory like for every other change
    const parsed = parseDeleteQuery(params);
    if (!parsed.ok) return invalid(parsed);
    if (!sameInstant(parsed.value.expected_updated_at, cur.row.updated_at)) return fail(409, "stale");
    const { data, error } = await q(a).delete().eq("id", id).eq("profile_id", a.profileId).eq("updated_at", cur.row.updated_at).select("id");
    if (error) return fromDb(error);
    if (!Array.isArray(data) || data.length === 0) {
      const again = await readRow(a, id, "id, updated_at");
      return !again.row || !sameInstant(again.row.updated_at, cur.row.updated_at) ? fail(409, "stale") : fail(403, "forbidden");
    }
    return ok({ id });
  }

  async function publish(a: ChurchActor, id: string, body: unknown): Promise<Result> {
    if (!isUuid(id)) return fail(404, "not_found");
    if (a.kind === "leader" || !spec.caps.publish(a.caps)) return fail(403, "forbidden");
    const parsed = parseConfirm(body);
    if (!parsed.ok) return invalid(parsed);
    const cur = await readRow(a, id);
    if (cur.error) return fromDb(cur.error);
    if (!cur.row) return fail(404, "not_found");
    if (cur.row.status === "published") return fail(409, "already_published");
    if (!parsed.value.expected_updated_at) return invalid({ code: "invalid_body", field: "expected_updated_at" });
    if (!sameInstant(parsed.value.expected_updated_at, cur.row.updated_at)) return fail(409, "stale");
    if (!spec.publishable(cur.row)) return fail(422, spec.publishBlockedCode);
    const { data, error } = await q(a).update({ status: "published" }).eq("id", id).eq("profile_id", a.profileId).eq("status", "draft").eq("updated_at", cur.row.updated_at).select("id");
    if (error) return fromDb(error);
    if (!Array.isArray(data) || data.length === 0) return fail(409, "stale");
    const { row } = await readRow(a, id);
    return ok({ item: row ? shape(row, todayDouala()) : null });
  }

  async function unpublish(a: ChurchActor, id: string, body: unknown): Promise<Result> {
    if (!isUuid(id)) return fail(404, "not_found");
    if (a.kind === "leader" || !spec.caps.publish(a.caps)) return fail(403, "forbidden");
    const parsed = parseConfirm(body);
    if (!parsed.ok) return invalid(parsed);
    const cur = await readRow(a, id, "id, status, updated_at");
    if (cur.error) return fromDb(cur.error);
    if (!cur.row) return fail(404, "not_found");
    if (cur.row.status !== "published") return fail(409, "not_published");
    if (!parsed.value.expected_updated_at) return invalid({ code: "invalid_body", field: "expected_updated_at" });
    if (!sameInstant(parsed.value.expected_updated_at, cur.row.updated_at)) return fail(409, "stale");
    const { data, error } = await q(a).update({ status: "draft" }).eq("id", id).eq("profile_id", a.profileId).eq("status", "published").eq("updated_at", cur.row.updated_at).select("id");
    if (error) return fromDb(error);
    if (!Array.isArray(data) || data.length === 0) return fail(409, "stale");
    const { row } = await readRow(a, id);
    return ok({ item: row ? spec.detail(row, todayDouala()) : null });
  }

  return { list, get, create, update, remove, publish, unpublish };
}
