import type { ChurchActor } from "../actor";
import { classifyDbError, failure } from "../errors";
import { todayDouala } from "../handlers";
import { isUuid } from "../validation";
import { WORD_PAGE_SIZE, isComplete, parseConfirm, parseDeleteQuery, parseWord, parseWordListQuery, type WordInput } from "./validation";

// Churches & Ministries Content Studio (Phase 3): every operation behind /api/church/content/**. Same rules as the People & Groups handlers (src/lib/church/handlers.ts):
//   * the church is always actor.profileId (server-resolved), never read from a request;
//   * every query goes through the user's own session, so the daily_words row-level security and guard trigger are the authority; the permission checks written here only answer earlier and
//     more clearly, and are never the only protection;
//   * a write that row-level security filters away raises no error, it touches zero rows: every update / delete asks for the affected rows back and reports a refusal, never a success;
//   * a failure is returned as a short code, never as the database's own message;
//   * columns are always listed explicitly (the audit columns are not readable by any API role).
// Every edit, publish and unpublish must carry the `expected_updated_at` it was based on (missing or invalid: 400; changed meanwhile: 409).
// Publishing and unpublishing are explicit (a `confirm: true` body) and need church.content.publish; creating and editing drafts needs church.content.manage (or publish).

export interface Result {
  status: number;
  body: Record<string, unknown>;
}
const ok = (body: Record<string, unknown> = {}, status = 200): Result => ({ status, body: { ok: true, ...body } });
const fail = (status: number, code: string, field?: string): Result => failure(status, code, field);
const invalid = (r: { code: string; field?: string }): Result => fail(400, r.code, r.field);
const fromDb = (error: unknown): Result => {
  const o = classifyDbError(error as any);
  if (o.status >= 500) console.error(JSON.stringify({ scope: "church_content", result: "db_error", code: String((error as any)?.code || "") }));
  return fail(o.status, o.code);
};
const newId = (): string => globalThis.crypto.randomUUID();
const q = (a: ChurchActor) => a.supabase.from("daily_words");

const CONTENT_COLS = "title_en, title_fr, scripture_ref_en, scripture_ref_fr, scripture_text_en, scripture_text_fr, body_en, body_fr, prayer_en, prayer_fr";
const WORD_COLS = `id, publish_on, status, ${CONTENT_COLS}, published_at, created_at, updated_at`;
const LIST_COLS = "id, publish_on, status, title_en, title_fr, body_en, body_fr, published_at, updated_at";

type Row = Record<string, any>;
const stateOf = (r: Row, today: string): "draft" | "scheduled" | "published" => (r.status !== "published" ? "draft" : r.publish_on > today ? "scheduled" : "published");
const sameInstant = (a: unknown, b: unknown) => Date.parse(String(a)) === Date.parse(String(b));

async function readWord(a: ChurchActor, id: string, cols = WORD_COLS) {
  const { data, error } = await q(a).select(cols).eq("id", id).eq("profile_id", a.profileId).maybeSingle();
  return { row: (data as Row | null) ?? null, error };
}

/** What the caller may do with this row. UX hints only; the database decides. */
const canDo = (a: ChurchActor, row: Row) => {
  const live = row.status === "published";
  return {
    edit: live ? a.caps.publishContent : a.caps.manageContent,
    delete: live ? a.caps.publishContent : a.caps.manageContent,
    publish: !live && a.caps.publishContent,
    unpublish: live && a.caps.publishContent,
  };
};

export async function listWords(a: ChurchActor, params: URLSearchParams): Promise<Result> {
  if (!a.caps.viewContent) return fail(403, "forbidden");
  const parsed = parseWordListQuery(params);
  if (!parsed.ok) return invalid(parsed);
  const { view, page } = parsed.value;
  const today = todayDouala();
  const from = (page - 1) * WORD_PAGE_SIZE;
  let query = q(a).select(LIST_COLS, { count: "exact" }).eq("profile_id", a.profileId);
  if (view === "drafts") query = query.eq("status", "draft");
  if (view === "scheduled") query = query.eq("status", "published").gt("publish_on", today);
  if (view === "published") query = query.eq("status", "published").lte("publish_on", today);
  const { data, error, count } = await query.order("publish_on", { ascending: false }).order("id", { ascending: true }).range(from, from + WORD_PAGE_SIZE - 1);
  if (error) return fromDb(error);
  const rows = (data as Row[]) || [];
  const total = typeof count === "number" ? count : rows.length;
  return ok({
    today,
    words: rows.map((r) => ({
      id: r.id,
      publish_on: r.publish_on,
      status: r.status,
      state: stateOf(r, today),
      title_en: r.title_en,
      title_fr: r.title_fr,
      has_en: isComplete(r.title_en, r.body_en),
      has_fr: isComplete(r.title_fr, r.body_fr),
      updated_at: r.updated_at,
    })),
    page,
    pageSize: WORD_PAGE_SIZE,
    total,
    hasMore: from + rows.length < total,
  });
}

export async function getWord(a: ChurchActor, id: string): Promise<Result> {
  if (!isUuid(id)) return fail(404, "not_found");
  if (!a.caps.viewContent) return fail(403, "forbidden");
  const { row, error } = await readWord(a, id);
  if (error) return fromDb(error);
  if (!row) return fail(404, "not_found");
  const today = todayDouala();
  return ok({ word: { ...row, state: stateOf(row, today), has_en: isComplete(row.title_en, row.body_en), has_fr: isComplete(row.title_fr, row.body_fr) }, can: canDo(a, row), today });
}

const contentOf = (v: WordInput): Record<string, unknown> => {
  const { expected_updated_at: _e, ...rest } = v;
  return rest;
};

export async function createWord(a: ChurchActor, body: unknown): Promise<Result> {
  if (a.kind === "leader" || !a.caps.manageContent) return fail(403, "forbidden");
  const parsed = parseWord(body, "create");
  if (!parsed.ok) return invalid(parsed);
  const id = newId();
  // always a DRAFT: the status is not a field a client can send, and the policy refuses a non-publisher a published row anyway
  const { error } = await q(a).insert({ id, profile_id: a.profileId, status: "draft", ...contentOf(parsed.value) });
  if (error) return fromDb(error);
  const { row } = await readWord(a, id);
  return ok({ id, word: row ? { ...row, state: "draft" } : null }, 201);
}

export async function updateWord(a: ChurchActor, id: string, body: unknown): Promise<Result> {
  if (!isUuid(id)) return fail(404, "not_found");
  if (a.kind === "leader" || !a.caps.manageContent) return fail(403, "forbidden");
  const parsed = parseWord(body, "update");
  if (!parsed.ok) return invalid(parsed);
  const cur = await readWord(a, id);
  if (cur.error) return fromDb(cur.error);
  if (!cur.row) return fail(404, "not_found");
  // a LIVE entry is public the moment it is saved: only the publish permission may change it
  if (cur.row.status === "published" && !a.caps.publishContent) return fail(403, "publish_required");
  // an edit must say which version it is based on: without it the write would silently overwrite someone else's save
  if (!parsed.value.expected_updated_at) return invalid({ code: "invalid_body", field: "expected_updated_at" });
  if (!sameInstant(parsed.value.expected_updated_at, cur.row.updated_at)) return fail(409, "stale");
  // the write only lands if nobody saved in between
  const { data, error } = await q(a).update(contentOf(parsed.value)).eq("id", id).eq("profile_id", a.profileId).eq("updated_at", cur.row.updated_at).select("id");
  if (error) return fromDb(error);
  if (!Array.isArray(data) || data.length === 0) {
    const again = await readWord(a, id, "id, updated_at");
    return again.row && !sameInstant(again.row.updated_at, cur.row.updated_at) ? fail(409, "stale") : fail(403, "forbidden");
  }
  const { row } = await readWord(a, id);
  return ok({ word: row ? { ...row, state: stateOf(row, todayDouala()) } : null });
}

export async function deleteWord(a: ChurchActor, id: string, params: URLSearchParams): Promise<Result> {
  if (!isUuid(id)) return fail(404, "not_found");
  if (a.kind === "leader" || !a.caps.manageContent) return fail(403, "forbidden");
  const cur = await readWord(a, id, "id, status, updated_at");
  if (cur.error) return fromDb(cur.error);
  if (!cur.row) return fail(404, "not_found");
  if (cur.row.status === "published" && !a.caps.publishContent) return fail(403, "publish_required");
  // a DELETE has no body: the version that was reviewed travels in the query (?expected_updated_at=...), mandatory like for every other change
  const parsed = parseDeleteQuery(params);
  if (!parsed.ok) return invalid(parsed);
  if (!sameInstant(parsed.value.expected_updated_at, cur.row.updated_at)) return fail(409, "stale");
  const { data, error } = await q(a).delete().eq("id", id).eq("profile_id", a.profileId).eq("updated_at", cur.row.updated_at).select("id");
  if (error) return fromDb(error);
  if (!Array.isArray(data) || data.length === 0) {
    const again = await readWord(a, id, "id, updated_at");
    return !again.row || !sameInstant(again.row.updated_at, cur.row.updated_at) ? fail(409, "stale") : fail(403, "forbidden");
  }
  return ok({ id });
}

export async function publishWord(a: ChurchActor, id: string, body: unknown): Promise<Result> {
  if (!isUuid(id)) return fail(404, "not_found");
  if (a.kind === "leader" || !a.caps.publishContent) return fail(403, "forbidden");
  const parsed = parseConfirm(body);
  if (!parsed.ok) return invalid(parsed);
  const cur = await readWord(a, id);
  if (cur.error) return fromDb(cur.error);
  if (!cur.row) return fail(404, "not_found");
  if (cur.row.status === "published") return fail(409, "already_published");
  if (!parsed.value.expected_updated_at) return invalid({ code: "invalid_body", field: "expected_updated_at" }); // the reviewed version is mandatory
  if (!sameInstant(parsed.value.expected_updated_at, cur.row.updated_at)) return fail(409, "stale");
  // readable in at least one language: a title AND a body (the database requires the same)
  if (!isComplete(cur.row.title_en, cur.row.body_en) && !isComplete(cur.row.title_fr, cur.row.body_fr)) return fail(422, "needs_title_and_body");
  const { data, error } = await q(a).update({ status: "published" }).eq("id", id).eq("profile_id", a.profileId).eq("status", "draft").eq("updated_at", cur.row.updated_at).select("id");
  if (error) return fromDb(error); // includes date_taken: another entry is already published for this date
  if (!Array.isArray(data) || data.length === 0) return fail(409, "stale");
  const { row } = await readWord(a, id);
  return ok({ word: row ? { ...row, state: stateOf(row, todayDouala()) } : null });
}

export async function unpublishWord(a: ChurchActor, id: string, body: unknown): Promise<Result> {
  if (!isUuid(id)) return fail(404, "not_found");
  if (a.kind === "leader" || !a.caps.publishContent) return fail(403, "forbidden");
  const parsed = parseConfirm(body);
  if (!parsed.ok) return invalid(parsed);
  const cur = await readWord(a, id, "id, status, updated_at");
  if (cur.error) return fromDb(cur.error);
  if (!cur.row) return fail(404, "not_found");
  if (cur.row.status !== "published") return fail(409, "not_published");
  if (!parsed.value.expected_updated_at) return invalid({ code: "invalid_body", field: "expected_updated_at" }); // the reviewed version is mandatory
  if (!sameInstant(parsed.value.expected_updated_at, cur.row.updated_at)) return fail(409, "stale");
  const { data, error } = await q(a).update({ status: "draft" }).eq("id", id).eq("profile_id", a.profileId).eq("status", "published").eq("updated_at", cur.row.updated_at).select("id");
  if (error) return fromDb(error);
  if (!Array.isArray(data) || data.length === 0) return fail(409, "stale");
  const { row } = await readWord(a, id);
  return ok({ word: row ? { ...row, state: "draft" } : null });
}
