import { makeLifecycle, type LifecycleSpec } from "./engine";
import { booleanField, dateField, httpsUrlField, imageUrlField, makeBodyParser, timeField, uuidOrNullField } from "./validation";

// Events and Announcements of a church (Phase 4): the two specs plugged into the shared lifecycle. See src/lib/church/lifecycle/engine.ts for the rules every entity follows.
// Both are DISPLAY content: nothing here sends a message, takes a booking, sells a ticket or records who attends (attendance is Phase 7 and is private).

type Row = Record<string, any>;
const hhmm = (t: unknown): string | null => (typeof t === "string" && t.length >= 5 ? t.slice(0, 5) : null);
const filled = (v: unknown): boolean => typeof v === "string" && v.trim() !== "";
const complete = (title: unknown, body: unknown): boolean => filled(title) && filled(body);

// ---- events -------------------------------------------------------------------------------------------------------------------------------------------------------

export const parseEvent = makeBodyParser({
  texts: {
    title_en: { max: 120, multiline: false, code: "invalid_title" },
    title_fr: { max: 120, multiline: false, code: "invalid_title" },
    description_en: { max: 2000, multiline: true, code: "invalid_description" },
    description_fr: { max: 2000, multiline: true, code: "invalid_description" },
    venue: { max: 160, multiline: false, code: "invalid_venue" },
    address: { max: 240, multiline: false, code: "invalid_address" },
  },
  fields: { event_date: dateField, start_time: timeField, end_time: timeField, online_url: httpsUrlField, image_url: imageUrlField, is_cancelled: booleanField },
});

/** past / upcoming is the Africa/Douala calendar day: an event dated today is still upcoming. */
export const eventStateOf = (r: Row, today: string): "draft" | "upcoming" | "past" => (r.status !== "published" ? "draft" : r.event_date < today ? "past" : "upcoming");

const EVENT_COLS = "id, event_date, start_time, end_time, status, title_en, title_fr, description_en, description_fr, venue, address, online_url, image_url, is_cancelled, published_at, created_at, updated_at";
const withoutPictures = (cols: string): string => cols.split(", ").filter((c) => c !== "image_url" && c !== "image_consent" && c !== "public_group_id").join(", ");
const EVENT_LIST_COLS = "id, event_date, start_time, end_time, status, title_en, title_fr, venue, is_cancelled, updated_at";

const eventShape = (r: Row, today: string): Record<string, unknown> => ({
  ...r,
  start_time: hhmm(r.start_time),
  end_time: hhmm(r.end_time),
  state: eventStateOf(r, today),
  has_en: filled(r.title_en),
  has_fr: filled(r.title_fr),
});

export const eventSpec: LifecycleSpec = {
  table: "ministry_events",
  logScope: "church_events",
  cols: EVENT_COLS,
  fallbackCols: withoutPictures(EVENT_COLS),
  listCols: EVENT_LIST_COLS,
  caps: { view: (c) => c.viewEvents, manage: (c) => c.manageEvents, publish: (c) => c.publishEvents },
  parse: parseEvent,
  views: {
    all: (query) => query,
    drafts: (query) => query.eq("status", "draft"),
    upcoming: (query, today) => query.eq("status", "published").gte("event_date", today),
    past: (query, today) => query.eq("status", "published").lt("event_date", today),
  },
  orderBy: [["event_date", false]],
  publishable: (r) => filled(r.title_en) || filled(r.title_fr),
  publishBlockedCode: "needs_title",
  stateOf: eventStateOf,
  listItem: (r, today) => {
    const s = eventShape(r, today);
    return { id: s.id, event_date: s.event_date, start_time: s.start_time, end_time: s.end_time, status: s.status, state: s.state, title_en: s.title_en, title_fr: s.title_fr, venue: s.venue, is_cancelled: s.is_cancelled, has_en: s.has_en, has_fr: s.has_fr, updated_at: s.updated_at };
  },
  detail: eventShape,
};
export const events = makeLifecycle(eventSpec);

// ---- announcements ------------------------------------------------------------------------------------------------------------------------------------------------

export const parseAnnouncement = makeBodyParser({
  texts: {
    title_en: { max: 120, multiline: false, code: "invalid_title" },
    title_fr: { max: 120, multiline: false, code: "invalid_title" },
    body_en: { max: 2000, multiline: true, code: "invalid_message" },
    body_fr: { max: 2000, multiline: true, code: "invalid_message" },
  },
  fields: { expires_on: { check: (v, field) => (v === null || v === undefined || v === "" ? { ok: true, value: null } : dateField.check(v, field)) }, image_url: imageUrlField, public_group_id: uuidOrNullField },
});

/** draft; published (shown); expired (published, but its last day has passed). */
export const announcementStateOf = (r: Row, today: string): "draft" | "published" | "expired" =>
  r.status !== "published" ? "draft" : r.expires_on && r.expires_on < today ? "expired" : "published";

const ANN_COLS = "id, status, title_en, title_fr, body_en, body_fr, expires_on, image_url, public_group_id, published_at, created_at, updated_at";
const ANN_LIST_COLS = "id, status, title_en, title_fr, body_en, body_fr, expires_on, updated_at";

const announcementShape = (r: Row, today: string): Record<string, unknown> => ({
  ...r,
  state: announcementStateOf(r, today),
  has_en: complete(r.title_en, r.body_en),
  has_fr: complete(r.title_fr, r.body_fr),
});

export const announcementSpec: LifecycleSpec = {
  table: "ministry_announcements",
  logScope: "church_announcements",
  cols: ANN_COLS,
  fallbackCols: withoutPictures(ANN_COLS),
  listCols: ANN_LIST_COLS,
  caps: { view: (c) => c.viewEvents, manage: (c) => c.manageEvents, publish: (c) => c.publishEvents },
  parse: parseAnnouncement,
  views: {
    all: (query) => query,
    drafts: (query) => query.eq("status", "draft"),
    published: (query, today) => query.eq("status", "published").or(`expires_on.is.null,expires_on.gte.${today}`),
    expired: (query, today) => query.eq("status", "published").lt("expires_on", today),
  },
  orderBy: [["created_at", false]],
  publishable: (r) => complete(r.title_en, r.body_en) || complete(r.title_fr, r.body_fr),
  publishBlockedCode: "needs_title_and_body",
  stateOf: announcementStateOf,
  listItem: (r, today) => {
    const s = announcementShape(r, today);
    return { id: s.id, status: s.status, state: s.state, title_en: s.title_en, title_fr: s.title_fr, expires_on: s.expires_on, has_en: s.has_en, has_fr: s.has_fr, updated_at: s.updated_at };
  },
  detail: announcementShape,
};
export const announcements = makeLifecycle(announcementSpec);
