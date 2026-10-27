import type { ChurchActor } from "./actor";
import { classifyDbError, failure } from "./errors";
import type { Result } from "./handlers";
import { isTimestamp } from "./lifecycle/validation";
import { isUuid, type Checked } from "./validation";

// The shared shape of the simple "list / add / edit / remove" church screens (public groups' photos, pastors, ...): one table, one church, an optimistic-concurrency check on every change.
// The rules are the same as the other church handlers (see music/handlers.ts):
//   * the church is always actor.profileId (server-resolved), never read from a request;
//   * every query goes through the user's own session, so row-level security and the guard triggers are the authority; the checks here only answer earlier and more clearly;
//   * a write that row-level security filters away raises no error, it touches zero rows: every update / delete asks for the affected rows back and reports a refusal, never a success;
//   * a failure is returned as a short code, never as the database's own message;
//   * the version being changed is mandatory (400 if missing, 409 if it changed meanwhile).

type Row = Record<string, any>;

export interface CrudSpec {
  table: string;
  /** Log scope: a short name, never data. */
  scope: string;
  /** Columns returned for one row (must include id and updated_at). */
  cols: string;
  canRead: (a: ChurchActor) => boolean;
  canWrite: (a: ChurchActor) => boolean;
  /** Validates a body. On update the result may carry expected_updated_at. */
  parse: (body: unknown, mode: "create" | "update") => Checked<Record<string, unknown>>;
  shape?: (r: Row) => Record<string, unknown>;
  order: Array<[string, boolean]>;
  limit: number;
}

const ok = (body: Record<string, unknown> = {}, status = 200): Result => ({ status, body: { ok: true, ...body } });
const fail = (status: number, code: string, field?: string): Result => failure(status, code, field);
const sameInstant = (a: unknown, b: unknown) => Date.parse(String(a)) === Date.parse(String(b));
const newId = (): string => globalThis.crypto.randomUUID();

export function makeCrud(spec: CrudSpec) {
  const shape = spec.shape ?? ((r: Row) => r);
  const fromDb = (error: unknown): Result => {
    const o = classifyDbError(error as any);
    if (o.status >= 500) console.error(JSON.stringify({ scope: spec.scope, result: "db_error", code: String((error as any)?.code || "") }));
    return fail(o.status, o.code);
  };
  const scoped = (a: ChurchActor, q: any, extra: Record<string, string>) => {
    let out = q.eq("profile_id", a.profileId);
    for (const [k, v] of Object.entries(extra)) out = out.eq(k, v);
    return out;
  };
  const readOne = async (a: ChurchActor, id: string, extra: Record<string, string>) => {
    const { data, error } = await scoped(a, a.supabase.from(spec.table).select(spec.cols).eq("id", id), extra).maybeSingle();
    return { row: (data as Row | null) ?? null, error };
  };

  async function list(a: ChurchActor, params: URLSearchParams, extra: Record<string, string> = {}): Promise<Result> {
    if (!spec.canRead(a)) return fail(403, "forbidden");
    for (const k of Array.from(params.keys())) return fail(400, "unexpected_field", k);
    let q = scoped(a, a.supabase.from(spec.table).select(spec.cols), extra);
    for (const [col, asc] of spec.order) q = q.order(col, { ascending: asc });
    const { data, error } = await q.limit(spec.limit + 1);
    if (error) return fromDb(error);
    return ok({ items: ((data as Row[]) || []).slice(0, spec.limit).map(shape), limit: spec.limit });
  }

  async function create(a: ChurchActor, body: unknown, extra: Record<string, string> = {}): Promise<Result> {
    if (a.kind === "leader" || !spec.canWrite(a)) return fail(403, "forbidden");
    const parsed = spec.parse(body, "create");
    if (!parsed.ok) return fail(400, parsed.code, parsed.field);
    const { data, error } = await a.supabase.from(spec.table).insert({ id: newId(), profile_id: a.profileId, ...extra, ...parsed.value }).select(spec.cols);
    if (error) return fromDb(error);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return fail(403, "forbidden");
    return ok({ item: shape(row as Row) }, 201);
  }

  async function update(a: ChurchActor, id: string, body: unknown, extra: Record<string, string> = {}): Promise<Result> {
    if (!isUuid(id)) return fail(404, "not_found");
    if (a.kind === "leader" || !spec.canWrite(a)) return fail(403, "forbidden");
    const parsed = spec.parse(body, "update");
    if (!parsed.ok) return fail(400, parsed.code, parsed.field);
    const { expected_updated_at: expected, ...changes } = parsed.value as Row;
    if (!isTimestamp(expected)) return fail(400, "invalid_body", "expected_updated_at");
    const cur = await readOne(a, id, extra);
    if (cur.error) return fromDb(cur.error);
    if (!cur.row) return fail(404, "not_found");
    if (!sameInstant(expected, cur.row.updated_at)) return fail(409, "stale");
    const { data, error } = await scoped(a, a.supabase.from(spec.table).update(changes).eq("id", id), extra).eq("updated_at", cur.row.updated_at).select(spec.cols);
    if (error) return fromDb(error);
    if (!Array.isArray(data) || data.length === 0) {
      const again = await readOne(a, id, extra);
      return again.row && !sameInstant(again.row.updated_at, cur.row.updated_at) ? fail(409, "stale") : fail(403, "forbidden");
    }
    return ok({ item: shape(data[0] as Row) });
  }

  async function remove(a: ChurchActor, id: string, params: URLSearchParams, extra: Record<string, string> = {}): Promise<Result> {
    if (!isUuid(id)) return fail(404, "not_found");
    if (a.kind === "leader" || !spec.canWrite(a)) return fail(403, "forbidden");
    for (const k of Array.from(params.keys())) if (k !== "expected_updated_at") return fail(400, "unexpected_field", k);
    const expected = params.get("expected_updated_at");
    if (!isTimestamp(expected)) return fail(400, "invalid_body", "expected_updated_at");
    const cur = await readOne(a, id, extra);
    if (cur.error) return fromDb(cur.error);
    if (!cur.row) return fail(404, "not_found");
    if (!sameInstant(expected, cur.row.updated_at)) return fail(409, "stale");
    const { data, error } = await scoped(a, a.supabase.from(spec.table).delete().eq("id", id), extra).eq("updated_at", cur.row.updated_at).select("id");
    if (error) return fromDb(error);
    if (!Array.isArray(data) || data.length === 0) {
      const again = await readOne(a, id, extra);
      return !again.row || !sameInstant(again.row.updated_at, cur.row.updated_at) ? fail(409, "stale") : fail(403, "forbidden");
    }
    return ok({ removed: 1 });
  }

  return { list, create, update, remove };
}
