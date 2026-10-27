import type { ChurchActor } from "../actor";
import { makeCrud } from "../crud";
import { classifyDbError, failure } from "../errors";
import type { Result } from "../handlers";
import { booleanField, imageUrlField, isTimestamp, makeBodyParser, type FieldSpec } from "../lifecycle/validation";
import { has, isUuid, plainObject, type Checked } from "../validation";
import { GROUP_PHOTO_LIMIT, PASTOR_LIMIT, PUBLIC_GROUP_KINDS, isPublicGroupKind } from "./kinds";

// Churches & Ministries expansion, Phase 3: the PUBLIC groups of a church (Men, Women, Youths, Children), their photos, and the Pastors page. Everything behind /api/church/public-groups/**,
// /api/church/pastors/** and /api/church/about. Same rules as every church handler: the church is actor.profileId, the user's own session decides through row-level security, a refusal is a short
// code, the version being changed is mandatory.
//
// A public group is a PRESENTATION: a leader's name and photo, a short description, photos. It lists no member and shows no count. The children group has an adult leader and photos WITHOUT captions
// (the database refuses a caption there), so a child is never named in public.

export { PUBLIC_GROUP_KINDS, GROUP_PHOTO_LIMIT, PASTOR_LIMIT, isPublicGroupKind, type PublicGroupKind } from "./kinds";

type Row = Record<string, any>;
const ok = (body: Record<string, unknown> = {}, status = 200): Result => ({ status, body: { ok: true, ...body } });
const fail = (status: number, code: string, field?: string): Result => failure(status, code, field);
const fromDb = (error: unknown): Result => {
  const o = classifyDbError(error as any);
  if (o.status >= 500) console.error(JSON.stringify({ scope: "church_pubgroups", result: "db_error", code: String((error as any)?.code || "") }));
  return fail(o.status, o.code);
};
const sameInstant = (a: unknown, b: unknown) => Date.parse(String(a)) === Date.parse(String(b));

const kindField: FieldSpec = { required: true, check: (v, field) => (isPublicGroupKind(v) ? { ok: true, value: v } : { ok: false, code: "invalid_kind", field }) };
const nameField = (max: number, code: string): FieldSpec => ({
  required: true,
  check: (v, field) => {
    if (typeof v !== "string") return { ok: false, code, field };
    const s = v.replace(/\s+/g, " ").trim();
    return s.length >= 1 && s.length <= max && !/[\u0000-\u001f\u007f]/.test(s) ? { ok: true, value: s } : { ok: false, code, field };
  },
}) ;
const optionalNameField = (max: number, code: string): FieldSpec => ({
  check: (v, field) => (v === null || v === undefined || (typeof v === "string" && v.trim() === "") ? { ok: true, value: null } : nameField(max, code).check(v, field)),
});
const uuidOrNull: FieldSpec = { check: (v, field) => (v === null || v === undefined || v === "" ? { ok: true, value: null } : isUuid(v) ? { ok: true, value: v } : { ok: false, code: "invalid_body", field }) };
const sortField: FieldSpec = { check: (v, field) => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 1000 ? { ok: true, value: v } : { ok: false, code: "invalid_sort_order", field }) };

// ---- public groups ----------------------------------------------------------------------------------------------------------------------------------------------
const parseGroupBase = makeBodyParser({
  texts: { description_en: { max: 600, multiline: true, code: "invalid_description" }, description_fr: { max: 600, multiline: true, code: "invalid_description" } },
  fields: { kind: kindField, leader_name: optionalNameField(80, "invalid_leader_name"), leader_photo_url: imageUrlField, roster_group_id: uuidOrNull, is_published: booleanField },
});
const parseGroup = (body: unknown, mode: "create" | "update"): Checked<Record<string, unknown>> => {
  // the kind is chosen once, at creation
  if (mode === "update" && body && typeof body === "object" && has(body as object, "kind")) return { ok: false, code: "unexpected_field", field: "kind" };
  if (mode === "update") {
    const base = parseGroupBase({ kind: "men", ...(body as object) }, "update");
    if (!base.ok) return base;
    const { kind: _kind, ...rest } = base.value;
    return Object.keys(rest).filter((k) => k !== "expected_updated_at").length === 0 ? { ok: false, code: "empty_update" } : { ok: true, value: rest };
  }
  return parseGroupBase(body, mode);
};

export const GROUP_COLS = "id, kind, leader_name, leader_photo_url, description_en, description_fr, roster_group_id, is_published, created_at, updated_at";
const groups = makeCrud({
  table: "church_public_groups",
  scope: "church_pubgroups",
  cols: GROUP_COLS,
  // people who write announcements also read the list (to pick an audience); only group managers write
  canRead: (a) => a.caps.viewGroups || a.caps.manageEvents,
  canWrite: (a) => a.caps.manageGroups,
  parse: parseGroup,
  order: [["kind", true]],
  limit: PUBLIC_GROUP_KINDS.length,
});
export const listPublicGroups = groups.list;
export const createPublicGroup = groups.create;
export const updatePublicGroup = groups.update;
export const deletePublicGroup = groups.remove;

// ---- group photos -----------------------------------------------------------------------------------------------------------------------------------------------
const parsePhoto = makeBodyParser({
  texts: { caption_en: { max: 160, multiline: false, code: "invalid_caption" }, caption_fr: { max: 160, multiline: false, code: "invalid_caption" } },
  fields: { image_url: { required: true, check: (v, f) => (v === null || v === undefined || v === "" ? { ok: false, code: "invalid_image_url", field: f } : imageUrlField.check(v, f)) }, sort_order: sortField },
});
export const PHOTO_COLS = "id, public_group_id, image_url, caption_en, caption_fr, sort_order, created_at, updated_at";
const photos = makeCrud({
  table: "church_group_photos",
  scope: "church_pubgroups_photos",
  cols: PHOTO_COLS,
  canRead: (a) => a.caps.viewGroups,
  canWrite: (a) => a.caps.manageGroups,
  parse: parsePhoto,
  order: [["sort_order", true], ["created_at", true]],
  limit: GROUP_PHOTO_LIMIT,
});
const ownGroup = (groupId: string) => (isUuid(groupId) ? { public_group_id: groupId } : null);
export const listGroupPhotos = (a: ChurchActor, groupId: string, params: URLSearchParams) => { const e = ownGroup(groupId); return e ? photos.list(a, params, e) : Promise.resolve(fail(404, "not_found")); };
export const createGroupPhoto = (a: ChurchActor, groupId: string, body: unknown) => { const e = ownGroup(groupId); return e ? photos.create(a, body, e) : Promise.resolve(fail(404, "not_found")); };
export const updateGroupPhoto = (a: ChurchActor, groupId: string, id: string, body: unknown) => { const e = ownGroup(groupId); return e ? photos.update(a, id, body, e) : Promise.resolve(fail(404, "not_found")); };
export const deleteGroupPhoto = (a: ChurchActor, groupId: string, id: string, params: URLSearchParams) => { const e = ownGroup(groupId); return e ? photos.remove(a, id, params, e) : Promise.resolve(fail(404, "not_found")); };

// ---- pastors ----------------------------------------------------------------------------------------------------------------------------------------------------
const parsePastor = makeBodyParser({
  texts: {
    word_en: { max: 300, multiline: true, code: "invalid_word" }, word_fr: { max: 300, multiline: true, code: "invalid_word" },
    bio_en: { max: 3000, multiline: true, code: "invalid_biography" }, bio_fr: { max: 3000, multiline: true, code: "invalid_biography" },
  },
  fields: { name: nameField(80, "invalid_name"), photo_url: imageUrlField, sort_order: sortField, is_published: booleanField },
});
export const PASTOR_COLS = "id, name, photo_url, word_en, word_fr, bio_en, bio_fr, sort_order, is_published, created_at, updated_at";
const pastors = makeCrud({
  table: "church_pastors",
  scope: "church_pastors",
  cols: PASTOR_COLS,
  canRead: (a) => a.caps.managePastors,
  canWrite: (a) => a.caps.managePastors,
  parse: parsePastor,
  order: [["sort_order", true], ["created_at", true]],
  limit: PASTOR_LIMIT,
});
export const listPastors = pastors.list;
export const createPastor = pastors.create;
export const updatePastor = pastors.update;
export const deletePastor = pastors.remove;

// ---- about: the church's vision and mission (one row per church) -----------------------------------------------------------------------------------------------
const parseAbout = makeBodyParser({
  texts: {
    vision_en: { max: 1500, multiline: true, code: "invalid_vision" }, vision_fr: { max: 1500, multiline: true, code: "invalid_vision" },
    mission_en: { max: 1500, multiline: true, code: "invalid_mission" }, mission_fr: { max: 1500, multiline: true, code: "invalid_mission" },
  },
  fields: { is_published: booleanField },
});
export const ABOUT_COLS = "vision_en, vision_fr, mission_en, mission_fr, is_published, updated_at";
const EMPTY_ABOUT = { vision_en: null, vision_fr: null, mission_en: null, mission_fr: null, is_published: false, updated_at: null };

export async function getAbout(a: ChurchActor, params: URLSearchParams): Promise<Result> {
  if (!a.caps.managePastors) return fail(403, "forbidden");
  for (const k of Array.from(params.keys())) return fail(400, "unexpected_field", k);
  const { data, error } = await a.supabase.from("church_about").select(ABOUT_COLS).eq("profile_id", a.profileId).maybeSingle();
  if (error) return fromDb(error);
  return ok({ item: (data as Row | null) ?? EMPTY_ABOUT });
}

/** PUT: creates the row the first time, edits it afterwards (the version being changed is then mandatory). */
export async function saveAbout(a: ChurchActor, body: unknown): Promise<Result> {
  if (a.kind === "leader" || !a.caps.managePastors) return fail(403, "forbidden");
  const parsed = parseAbout(body, "update");
  if (!parsed.ok) return fail(400, parsed.code, parsed.field);
  const { expected_updated_at: expected, ...changes } = parsed.value as Row;
  const cur = await a.supabase.from("church_about").select("updated_at").eq("profile_id", a.profileId).maybeSingle();
  if (cur.error) return fromDb(cur.error);
  if (!cur.data) {
    if (expected !== undefined && expected !== null) return fail(409, "stale");
    const ins = await a.supabase.from("church_about").insert({ profile_id: a.profileId, ...changes }).select(ABOUT_COLS);
    if (ins.error) return fromDb(ins.error);
    const row = Array.isArray(ins.data) ? ins.data[0] : ins.data;
    return row ? ok({ item: row }, 201) : fail(403, "forbidden");
  }
  if (!isTimestamp(expected)) return fail(400, "invalid_body", "expected_updated_at");
  if (!sameInstant(expected, (cur.data as Row).updated_at)) return fail(409, "stale");
  const up = await a.supabase.from("church_about").update(changes).eq("profile_id", a.profileId).eq("updated_at", (cur.data as Row).updated_at).select(ABOUT_COLS);
  if (up.error) return fromDb(up.error);
  if (!Array.isArray(up.data) || up.data.length === 0) return fail(409, "stale");
  return ok({ item: up.data[0] });
}

export { plainObject };
