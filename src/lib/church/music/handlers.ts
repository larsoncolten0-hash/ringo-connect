import type { ChurchActor } from "../actor";
import { classifyDbError, failure } from "../errors";
import type { Result } from "../handlers";
import { isTimestamp, safeHttpsUrl } from "../lifecycle/validation";
import { has, isUuid, optionalText, plainObject } from "../validation";
import { MUSIC_PLATFORMS, MUSIC_PLATFORM_IDS, urlMatchesPlatform } from "./platforms";

// Churches & Ministries Church Music (Phase 8): everything behind /api/church/music/**. Same rules as the other church handlers:
//   * the church is always actor.profileId (server-resolved), never read from a request;
//   * every query goes through the user's own session, so row-level security and the guard trigger are the authority; the checks written here only answer earlier and more clearly;
//   * a write that row-level security filters away raises no error, it touches zero rows: every update / delete asks for the affected rows back and reports a refusal, never a success;
//   * a failure is returned as a short code, never as the database's own message.
// Church Music is a LINK-OUT: "listen on Spotify / YouTube / ...". No audio, no upload, no sale. The address must belong to the platform chosen.

const ok = (body: Record<string, unknown> = {}, status = 200): Result => ({ status, body: { ok: true, ...body } });
const fail = (status: number, code: string, field?: string): Result => failure(status, code, field);
const fromDb = (error: unknown): Result => {
  const o = classifyDbError(error as any);
  if (o.status >= 500) console.error(JSON.stringify({ scope: "church_music", result: "db_error", code: String((error as any)?.code || "") }));
  return fail(o.status, o.code);
};
const newId = (): string => globalThis.crypto.randomUUID();
const sameInstant = (a: unknown, b: unknown) => Date.parse(String(a)) === Date.parse(String(b));

type Row = Record<string, any>;

export const MUSIC_LINK_LIMIT = 20;
export const MUSIC_TITLE_MAX = 80;

export { MUSIC_PLATFORMS, MUSIC_PLATFORM_IDS, urlMatchesPlatform };

export interface MusicInput {
  platform?: string;
  title?: string;
  url?: string;
  is_visible?: boolean;
  sort_order?: number;
  expected_updated_at?: string;
}
type Checked = { ok: true; value: MusicInput } | { ok: false; code: string; field?: string };

export function parseMusicBody(body: unknown, mode: "create" | "update"): Checked {
  const o = plainObject(body, ["platform", "title", "url", "is_visible", "sort_order", ...(mode === "update" ? ["expected_updated_at"] : [])]);
  if (!o.ok) return o;
  const b = o.value;
  const out: MusicInput = {};
  if (has(b, "platform") || mode === "create") {
    if (typeof b.platform !== "string" || !MUSIC_PLATFORM_IDS.includes(b.platform)) return { ok: false, code: "invalid_platform", field: "platform" };
    out.platform = b.platform;
  }
  if (has(b, "title") || mode === "create") {
    const t = optionalText(b.title, "title", MUSIC_TITLE_MAX);
    if (!t.ok || t.value === null) return { ok: false, code: "invalid_title", field: "title" };
    out.title = t.value;
  }
  if (has(b, "url") || mode === "create") {
    const u = safeHttpsUrl(b.url);
    if (!u) return { ok: false, code: "invalid_url", field: "url" };
    out.url = u;
  }
  if (has(b, "is_visible")) {
    if (typeof b.is_visible !== "boolean") return { ok: false, code: "invalid_body", field: "is_visible" };
    out.is_visible = b.is_visible;
  }
  if (has(b, "sort_order")) {
    if (typeof b.sort_order !== "number" || !Number.isInteger(b.sort_order) || b.sort_order < 0 || b.sort_order > 1000) return { ok: false, code: "invalid_sort_order", field: "sort_order" };
    out.sort_order = b.sort_order;
  }
  if (has(b, "expected_updated_at")) {
    if (!isTimestamp(b.expected_updated_at)) return { ok: false, code: "invalid_body", field: "expected_updated_at" };
    out.expected_updated_at = b.expected_updated_at;
  }
  if (mode === "update" && Object.keys(out).filter((k) => k !== "expected_updated_at").length === 0) return { ok: false, code: "empty_update" };
  return { ok: true, value: out };
}

/** An update may change the platform and the address separately: the pair that will be stored must still match. */
const pairProblem = (platform: string, url: string): Result | null => (urlMatchesPlatform(platform, url) ? null : fail(422, "url_platform_mismatch", "url"));

export const MUSIC_COLUMNS = "id, platform, title, url, is_visible, sort_order, created_at, updated_at";
const shape = (r: Row) => ({ id: r.id, platform: r.platform, title: r.title, url: r.url, is_visible: r.is_visible === true, sort_order: r.sort_order, updated_at: r.updated_at });

export async function listMusic(a: ChurchActor, params: URLSearchParams): Promise<Result> {
  if (!a.caps.manageMusic) return fail(403, "forbidden");
  for (const k of Array.from(params.keys())) return fail(400, "unexpected_field", k);
  const { data, error } = await a.supabase.from("ministry_music_links").select(MUSIC_COLUMNS).eq("profile_id", a.profileId).order("sort_order", { ascending: true }).order("created_at", { ascending: true }).limit(MUSIC_LINK_LIMIT + 1);
  if (error) return fromDb(error);
  return ok({ items: ((data as Row[]) || []).map(shape), limit: MUSIC_LINK_LIMIT });
}

export async function createMusic(a: ChurchActor, body: unknown): Promise<Result> {
  if (a.kind === "leader" || !a.caps.manageMusic) return fail(403, "forbidden");
  const parsed = parseMusicBody(body, "create");
  if (!parsed.ok) return fail(400, parsed.code, parsed.field);
  const v = parsed.value;
  const mismatch = pairProblem(v.platform as string, v.url as string);
  if (mismatch) return mismatch;
  const { data, error } = await a.supabase
    .from("ministry_music_links")
    .insert({ id: newId(), profile_id: a.profileId, platform: v.platform, title: v.title, url: v.url, is_visible: v.is_visible ?? true, sort_order: v.sort_order ?? 0 })
    .select(MUSIC_COLUMNS);
  if (error) return fromDb(error);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return fail(403, "forbidden");
  return ok({ item: shape(row as Row) }, 201);
}

async function readOne(a: ChurchActor, id: string) {
  const { data, error } = await a.supabase.from("ministry_music_links").select("id, platform, url, updated_at").eq("id", id).eq("profile_id", a.profileId).maybeSingle();
  return { row: (data as Row | null) ?? null, error };
}

export async function updateMusic(a: ChurchActor, id: string, body: unknown): Promise<Result> {
  if (!isUuid(id)) return fail(404, "not_found");
  if (a.kind === "leader" || !a.caps.manageMusic) return fail(403, "forbidden");
  const parsed = parseMusicBody(body, "update");
  if (!parsed.ok) return fail(400, parsed.code, parsed.field);
  const { expected_updated_at: expected, ...changes } = parsed.value;
  if (!expected) return fail(400, "invalid_body", "expected_updated_at");
  const cur = await readOne(a, id);
  if (cur.error) return fromDb(cur.error);
  if (!cur.row) return fail(404, "not_found");
  if (!sameInstant(expected, cur.row.updated_at)) return fail(409, "stale");
  const mismatch = pairProblem(changes.platform ?? cur.row.platform, changes.url ?? cur.row.url);
  if (mismatch) return mismatch;
  const { data, error } = await a.supabase.from("ministry_music_links").update(changes).eq("id", id).eq("profile_id", a.profileId).eq("updated_at", cur.row.updated_at).select(MUSIC_COLUMNS);
  if (error) return fromDb(error);
  if (!Array.isArray(data) || data.length === 0) {
    const again = await readOne(a, id);
    return again.row && !sameInstant(again.row.updated_at, cur.row.updated_at) ? fail(409, "stale") : fail(403, "forbidden");
  }
  return ok({ item: shape(data[0] as Row) });
}

export async function deleteMusic(a: ChurchActor, id: string, params: URLSearchParams): Promise<Result> {
  if (!isUuid(id)) return fail(404, "not_found");
  if (a.kind === "leader" || !a.caps.manageMusic) return fail(403, "forbidden");
  for (const k of Array.from(params.keys())) if (k !== "expected_updated_at") return fail(400, "unexpected_field", k);
  const expected = params.get("expected_updated_at");
  if (!isTimestamp(expected)) return fail(400, "invalid_body", "expected_updated_at");
  const cur = await readOne(a, id);
  if (cur.error) return fromDb(cur.error);
  if (!cur.row) return fail(404, "not_found");
  if (!sameInstant(expected, cur.row.updated_at)) return fail(409, "stale");
  const { data, error } = await a.supabase.from("ministry_music_links").delete().eq("id", id).eq("profile_id", a.profileId).eq("updated_at", cur.row.updated_at).select("id");
  if (error) return fromDb(error);
  if (!Array.isArray(data) || data.length === 0) {
    const again = await readOne(a, id);
    return !again.row || !sameInstant(again.row.updated_at, cur.row.updated_at) ? fail(409, "stale") : fail(403, "forbidden");
  }
  return ok({ removed: 1 });
}
