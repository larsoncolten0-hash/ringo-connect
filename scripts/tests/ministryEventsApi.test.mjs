// Churches & Ministries Phase 4: the Events and Announcements back end, validated end to end and OFFLINE.
// The REAL route files (src/app/api/church/events/**, src/app/api/church/announcements/**), the REAL handlers, validation, error mapping and actor resolution run against scratch in-memory
// PostgreSQL (PGlite) that holds the REAL Team migrations, the REAL Phase 2A church migration and the REAL Phase 3 / Phase 4 migrations. See scripts/tests/ministryApiHarness.mjs.
//   Run:  node scripts/tests/ministryEventsApi.test.mjs
import fs from "fs";
import path from "path";
import { createHarness, kit, shift, doualaToday, SRC } from "./ministryApiHarness.mjs";

const H = await createHarness({ dailyWords: true, events: true });
const { F, jiti } = H;
const { u, prof } = F;
const { check, eq, is, section, summary } = kit();
const realConsoleError = console.error;
console.error = () => {};

const LIFE = jiti(path.join(SRC, "lib/church/lifecycle/events.ts"));
const VAL = jiti(path.join(SRC, "lib/church/lifecycle/validation.ts"));
const PERM = jiti(path.join(SRC, "lib/church/permissions.ts"));
const ERR = jiti(path.join(SRC, "lib/church/errors.ts"));

const U2 = (n) => F.id("c", 40 + n);
const ev = U2(1), em = U2(2), ep = U2(3), adminPub = U2(5);
const R2 = (n) => F.id("b", 40 + n);
const r = { view: R2(1), manage: R2(2), publish: R2(3), adminPub: R2(5) };
const EXTRA = `
  insert into public.users (id, role, plan_id) values ('${ev}','user','${F.plan.free}'), ('${em}','user','${F.plan.free}'), ('${ep}','user','${F.plan.free}'), ('${adminPub}','admin','${F.plan.free}');
  insert into public.organization_roles (id, profile_id, key, name, permissions) values
    ('${r.view}','${prof.c1}','eview','Events viewer','{church.events.view}'),
    ('${r.manage}','${prof.c1}','emanage','Events writer','{church.events.manage}'),
    ('${r.publish}','${prof.c1}','epublish','Events publisher','{church.events.publish}'),
    ('${r.adminPub}','${prof.c1}','eadmin','Admin holding publish','{church.events.publish,church.events.view}');
  insert into public.organization_members (profile_id, user_id, role_id) values ('${prof.c1}','${ev}','${r.view}'), ('${prof.c1}','${em}','${r.manage}'), ('${prof.c1}','${ep}','${r.publish}'), ('${prof.c1}','${adminPub}','${r.adminPub}');
`;
const O = u.owner1;
const D0 = doualaToday();
const SPECS = {
  events: { rel: "church/events", table: "ministry_events", make: (o = {}) => ({ event_date: shift(D0, 5), title_en: "Sunday service", ...o }), edit: { venue: "Main hall" }, editCol: "venue", editVal: "Main hall", noun: "event" },
  announcements: { rel: "church/announcements", table: "ministry_announcements", make: (o = {}) => ({ title_en: "Notice", body_en: "Body text", ...o }), edit: { body_en: "Changed body" }, editCol: "body_en", editVal: "Changed body", noun: "announcement" },
};
const ts = async (table, id) => ({ url: `?expected_updated_at=${encodeURIComponent(await H.stamp(table, id))}` });

// =================================================================================================================================================================
section("A. input validation (pure): ");
// =================================================================================================================================================================
{
  const E = LIFE.parseEvent, A = LIFE.parseAnnouncement;
  check("event create: needs a date", E({ title_en: "x" }, "create").code === "invalid_event_date");
  check("event create: minimal body is valid", E({ event_date: "2027-03-01" }, "create").ok);
  check("event create: an impossible date is refused", E({ event_date: "2027-02-31" }, "create").code === "invalid_date");
  check("event create: a timestamp is not a date", E({ event_date: "2027-03-01T10:00:00Z" }, "create").code === "invalid_date");
  check("event: status is refused (never decided by the client)", E({ event_date: "2027-03-01", status: "published" }, "create").code === "unexpected_field");
  for (const f of ["profile_id", "id", "created_by", "updated_by", "published_by", "published_at", "created_at", "updated_at"]) check(`event: ${f} is refused`, E({ event_date: "2027-03-01", [f]: "x" }, "create").code === "unexpected_field");
  check("event: expected_updated_at only on update", E({ event_date: "2027-03-01", expected_updated_at: "2027-01-01T00:00:00Z" }, "create").code === "unexpected_field" && E({ title_en: "x", expected_updated_at: "2027-01-01T00:00:00Z" }, "update").ok);
  check("event: nothing but expected_updated_at is an empty update", E({ expected_updated_at: "2027-01-01T00:00:00Z" }, "update").code === "empty_update");
  check("event: an invalid expected_updated_at is refused", E({ title_en: "x", expected_updated_at: "soon" }, "update").code === "invalid_body");
  check("event: times must be HH:MM", E({ event_date: "2027-03-01", start_time: "9am" }, "create").code === "invalid_time" && E({ event_date: "2027-03-01", start_time: "25:00" }, "create").code === "invalid_time" && E({ event_date: "2027-03-01", start_time: "09:00" }, "create").ok);
  check("event: a blank time clears it", E({ event_date: "2027-03-01", start_time: "" }, "create").value.start_time === null);
  check("event: is_cancelled must be a boolean", E({ title_en: "x", is_cancelled: "yes" }, "update").code === "invalid_body" && E({ is_cancelled: true }, "update").ok);
  check("event: a too-long title carries the title code", E({ event_date: "2027-03-01", title_en: "x".repeat(121) }, "create").code === "invalid_title");
  check("event: a too-long description carries the description code", E({ event_date: "2027-03-01", description_fr: "x".repeat(2001) }, "create").code === "invalid_description");
  check("event: venue and address have their own codes", E({ event_date: "2027-03-01", venue: "x".repeat(161) }, "create").code === "invalid_venue" && E({ event_date: "2027-03-01", address: "x".repeat(241) }, "create").code === "invalid_address");
  check("event: control characters in a title are refused", E({ event_date: "2027-03-01", title_en: "a\u0007b" }, "create").code === "invalid_title");
  check("event: non-string text is refused", E({ event_date: "2027-03-01", title_en: 12 }, "create").code === "invalid_title");
  check("event: blank text is stored as null", E({ event_date: "2027-03-01", title_en: "   " }, "create").value.title_en === null);
  check("event: markup is kept as plain text, not interpreted", E({ event_date: "2027-03-01", title_en: "<b>x</b>" }, "create").value.title_en === "<b>x</b>");
  // online links
  for (const url of ["https://example.org/live", "https://live.church.cm/watch?v=1", "https://youtu.be/abc#t=1", " https://example.org/x "]) check(`link accepted: ${url}`, E({ event_date: "2027-03-01", online_url: url }, "create").ok);
  for (const url of ["http://example.org/live", "javascript:alert(1)", "https://user:pw@example.org/x", "https://exa mple.org", "https://localhost/x", "https://127.0.0.1/x", "https://[::1]/x", "https://intranet", "ftp://example.org", "//example.org", "https://", "data:text/html,x", "example.org/live", "https://" + "a".repeat(500) + ".org", "https://example.org/\u0000", "https://a.b"]) {
    check(`link refused: ${url.slice(0, 40)}`, E({ event_date: "2027-03-01", online_url: url }, "create").code === "invalid_online_url", JSON.stringify(E({ event_date: "2027-03-01", online_url: url }, "create")));
  }
  check("event: a blank link clears it", E({ event_date: "2027-03-01", online_url: "" }, "create").value.online_url === null);
  // announcements
  check("announcement create: an empty body is valid (a draft may be empty)", A({}, "create").ok);
  check("announcement: expires_on must be a date", A({ expires_on: "tomorrow" }, "create").code === "invalid_date" && A({ expires_on: "2027-03-01" }, "create").ok && A({ expires_on: null }, "create").value.expires_on === null);
  check("announcement: too-long text carries the message / title codes", A({ body_en: "x".repeat(2001) }, "create").code === "invalid_message" && A({ title_fr: "x".repeat(121) }, "create").code === "invalid_title");
  check("announcement: status and venue are refused", A({ status: "published" }, "create").code === "unexpected_field" && A({ venue: "x" }, "create").code === "unexpected_field");
  // list queries
  const LQ = (qs, views = ["all", "drafts", "upcoming", "past"]) => jiti(path.join(SRC, "lib/church/lifecycle/engine.ts")).parseLifecycleListQuery(new URLSearchParams(qs), views);
  check("list query: defaults", LQ("").ok && LQ("").value.view === "all" && LQ("").value.page === 1);
  check("list query: unknown view / key / page are refused", LQ("view=nope").code === "invalid_view" && LQ("x=1").code === "unexpected_field" && LQ("page=0").code === "invalid_page" && LQ("page=abc").code === "invalid_page" && LQ("page=2001").code === "invalid_page");
  // state helpers
  eq("event state: a past published event", LIFE.eventStateOf({ status: "published", event_date: "2027-01-01" }, "2027-01-02"), "past");
  eq("event state: today is still upcoming", LIFE.eventStateOf({ status: "published", event_date: "2027-01-02" }, "2027-01-02"), "upcoming");
  eq("event state: a draft", LIFE.eventStateOf({ status: "draft", event_date: "2020-01-01" }, "2027-01-02"), "draft");
  eq("announcement state: its last day is still shown", LIFE.announcementStateOf({ status: "published", expires_on: "2027-01-02" }, "2027-01-02"), "published");
  eq("announcement state: after its last day it is expired", LIFE.announcementStateOf({ status: "published", expires_on: "2027-01-01" }, "2027-01-02"), "expired");
  // capabilities
  const caps = (...p) => PERM.churchCapabilities(p);
  check("capabilities: the three levels", caps("church.events.view").viewEvents && !caps("church.events.view").manageEvents && caps("church.events.manage").viewEvents && caps("church.events.manage").manageEvents && !caps("church.events.manage").publishEvents && caps("church.events.publish").manageEvents && caps("church.events.publish").publishEvents);
  check("capabilities: content permissions grant nothing here", !caps("church.content.publish").viewEvents && !caps("church.members.manage").manageEvents);
  check("the three strings are registered as church permissions", ["church.events.view", "church.events.manage", "church.events.publish"].every((p) => PERM.CHURCH_PERMISSIONS.includes(p)));
  check("...and are SENSITIVE (owner-only to grant)", ["church.events.view", "church.events.manage", "church.events.publish"].every((p) => PERM.isSensitiveChurchPermissionName(p)));
  // error mapping
  const cls = (message, code = "23514") => ERR.classifyDbError({ message, code });
  eq("db: end before start", cls('new row for relation "ministry_events" violates check constraint "ministry_events_times_check"').code, "invalid_time_range");
  eq("db: bad link", cls('violates check constraint "ministry_events_online_url_check"').code, "invalid_online_url");
  eq("db: event without a title", cls('violates check constraint "ministry_events_publish_content_check"').code, "needs_title");
  eq("db: announcement without a body", cls('violates check constraint "ministry_announcements_publish_content_check"').code, "needs_title_and_body");
  eq("db: guard not-a-church", cls("ministry_profile_required").code, "not_available");
}

// =================================================================================================================================================================
section("B. the lifecycle, for events and announcements: ");
// =================================================================================================================================================================
for (const [name, S] of Object.entries(SPECS)) {
  await H.fresh(EXTRA);
  const anon = () => F.sessionFor(H.db, null).from(S.table).select("id, title_en");
  let res = await H.call(O, "GET", S.rel);
  is(`${name}: empty list`, res, 200, "ok");
  check(`${name}: empty: no items, total 0, today is the Douala date`, res.body.items.length === 0 && res.body.total === 0 && res.body.today === D0);
  res = await H.call(O, "POST", S.rel, { body: S.make() });
  is(`${name}: create a draft`, res, 201, "ok");
  const id = res.body.id;
  check(`${name}: created as a DRAFT`, res.body.item.status === "draft" && res.body.item.state === "draft");
  const stored = (await H.rows(`select profile_id::text as p, status, created_by::text as c, published_at from public.${S.table} where id = '${id}'`))[0];
  check(`${name}: the church, the creator and the status are decided by the server`, stored.p === prof.c1 && stored.c === O && stored.status === "draft" && stored.published_at === null, JSON.stringify(stored));
  res = await H.call(O, "GET", `${S.rel}/[id]`, { params: { id } });
  is(`${name}: detail`, res, 200, "ok");
  check(`${name}: detail: can-flags for a draft`, res.body.can.publish === true && res.body.can.unpublish === false && res.body.can.edit === true && res.body.can.delete === true);
  check(`${name}: no audit column is ever returned`, !("created_by" in res.body.item) && !("updated_by" in res.body.item) && !("published_by" in res.body.item) && !("profile_id" in res.body.item));
  check(`${name}: a draft is invisible to the public`, ((await anon()).data || []).length === 0);
  // edit
  const upd1 = res.body.item.updated_at;
  res = await H.call(O, "PATCH", `${S.rel}/[id]`, { params: { id }, body: { ...S.edit, expected_updated_at: upd1 } });
  is(`${name}: edit a draft`, res, 200, "ok");
  const upd2 = res.body.item.updated_at;
  check(`${name}: updated_at advanced`, upd2 !== upd1);
  res = await H.call(O, "PATCH", `${S.rel}/[id]`, { params: { id }, body: { ...S.edit, expected_updated_at: upd2 } });
  is(`${name}: a second consecutive save with the latest returned timestamp`, res, 200, "ok");
  res = await H.call(O, "PATCH", `${S.rel}/[id]`, { params: { id }, body: { title_en: "Stale", expected_updated_at: upd1 } });
  is(`${name}: an edit based on an older version is refused (stale)`, res, 409, "stale");
  check(`${name}: ...and changed nothing`, (await H.rows(`select title_en from public.${S.table} where id = '${id}'`))[0].title_en !== "Stale");
  // publish
  res = await H.call(O, "POST", `${S.rel}/[id]/publish`, { params: { id }, body: { expected_updated_at: await H.stamp(S.table, id) } });
  is(`${name}: publish without confirmation is refused`, res, 400, "confirmation_required");
  res = await H.call(O, "POST", `${S.rel}/[id]/publish`, { params: { id }, body: { confirm: "yes", expected_updated_at: await H.stamp(S.table, id) } });
  is(`${name}: publish with a non-true confirmation is refused`, res, 400, "confirmation_required");
  check(`${name}: ...still a draft`, (await H.rows(`select status from public.${S.table} where id = '${id}'`))[0].status === "draft");
  res = await H.call(O, "POST", `${S.rel}/[id]/publish`, { params: { id }, body: { confirm: true, expected_updated_at: await H.stamp(S.table, id) } });
  is(`${name}: publish`, res, 200, "ok");
  check(`${name}: published stamps are set`, res.body.item.status === "published" && (await H.rows(`select published_at is not null as a, published_by::text as b from public.${S.table} where id = '${id}'`))[0].b === O);
  res = await H.call(O, "POST", `${S.rel}/[id]/publish`, { params: { id }, body: { confirm: true, expected_updated_at: await H.stamp(S.table, id) } });
  is(`${name}: publishing twice is refused`, res, 409, "already_published");
  check(`${name}: the public now reads it`, ((await anon()).data || []).length === 1);
  res = await H.call(O, "GET", S.rel + "?view=drafts");
  check(`${name}: the drafts view no longer lists it`, res.body.items.length === 0);
  // edit a live entry
  res = await H.call(O, "PATCH", `${S.rel}/[id]`, { params: { id }, body: { ...S.edit, title_en: "Live edit", expected_updated_at: await H.stamp(S.table, id) } });
  is(`${name}: the publisher edits a live entry`, res, 200, "ok");
  check(`${name}: ...and the public sees the edit at once`, ((await anon()).data || [])[0]?.title_en === "Live edit");
  // unpublish
  res = await H.call(O, "POST", `${S.rel}/[id]/unpublish`, { params: { id }, body: { confirm: true, expected_updated_at: await H.stamp(S.table, id) } });
  is(`${name}: unpublish`, res, 200, "ok");
  check(`${name}: ...it is a draft again, stamps cleared, and hidden from the public`, res.body.item.state === "draft" && ((await anon()).data || []).length === 0 && (await H.rows(`select published_at, published_by from public.${S.table} where id = '${id}'`))[0].published_at === null);
  res = await H.call(O, "POST", `${S.rel}/[id]/unpublish`, { params: { id }, body: { confirm: true, expected_updated_at: await H.stamp(S.table, id) } });
  is(`${name}: unpublishing a draft is refused`, res, 409, "not_published");
  // list filters
  res = await H.call(O, "GET", S.rel + "?view=nope");
  is(`${name}: an unknown view is refused`, res, 400, "invalid_view");
  res = await H.call(O, "GET", S.rel + "?x=1");
  is(`${name}: an unknown query key is refused`, res, 400, "unexpected_field");
  // delete
  res = await H.call(O, "DELETE", `${S.rel}/[id]`, { params: { id }, ...(await ts(S.table, id)) });
  is(`${name}: delete a draft`, res, 200, "ok");
  res = await H.call(O, "GET", `${S.rel}/[id]`, { params: { id } });
  is(`${name}: ...it is gone`, res, 404, "not_found");
  check(`${name}: the service-role client was never used`, globalThis.__adminClientCalls === 0);
}

// ---- state-specific rules --------------------------------------------------------------------------------------------------------------------------------------
section("C. events: dates, cancelling and views; announcements: expiry and the title+body rule: ");
{
  await H.fresh(EXTRA);
  const mk = async (rel, body) => (await H.call(O, "POST", rel, { body })).body.id;
  const pub = async (rel, table, id) => H.call(O, "POST", `${rel}/[id]/publish`, { params: { id }, body: { confirm: true, expected_updated_at: await H.stamp(table, id) } });
  // events
  const past = await mk("church/events", { event_date: shift(D0, -10), title_en: "Past one" });
  const today = await mk("church/events", { event_date: D0, title_en: "Today one" });
  const future = await mk("church/events", { event_date: shift(D0, 10), title_en: "Future one" });
  const draft = await mk("church/events", { event_date: shift(D0, 11), title_en: "Draft one" });
  for (const x of [past, today, future]) is("publish an event", await pub("church/events", "ministry_events", x), 200, "ok");
  const titles = async (qs) => (await H.call(O, "GET", "church/events" + qs)).body.items.map((x) => x.title_en).sort();
  eq("events view all", await titles(""), ["Draft one", "Future one", "Past one", "Today one"]);
  eq("events view drafts", await titles("?view=drafts"), ["Draft one"]);
  eq("events view upcoming (today counts)", await titles("?view=upcoming"), ["Future one", "Today one"]);
  eq("events view past", await titles("?view=past"), ["Past one"]);
  eq("events are newest first", (await H.call(O, "GET", "church/events")).body.items.map((x) => x.title_en), ["Draft one", "Future one", "Today one", "Past one"]);
  let res = await H.call(O, "PATCH", "church/events/[id]", { params: { id: future }, body: { is_cancelled: true, expected_updated_at: await H.stamp("ministry_events", future) } });
  is("cancel a live event", res, 200, "ok");
  check("...the public still lists it, flagged cancelled", ((await F.sessionFor(H.db, null).from("ministry_events").select("id, is_cancelled").eq("id", future)).data || [])[0]?.is_cancelled === true);
  res = await H.call(O, "PATCH", "church/events/[id]", { params: { id: draft }, body: { start_time: "18:00", end_time: "17:00", expected_updated_at: await H.stamp("ministry_events", draft) } });
  is("an end time before the start time is refused by the database (mapped to a code)", res, 422, "invalid_time_range");
  res = await H.call(O, "PATCH", "church/events/[id]", { params: { id: draft }, body: { start_time: "17:00", end_time: "18:00", online_url: "https://example.org/live", expected_updated_at: await H.stamp("ministry_events", draft) } });
  is("a valid time range and an https link are saved", res, 200, "ok");
  check("...times come back as HH:MM", res.body.item.start_time === "17:00" && res.body.item.end_time === "18:00");
  res = await H.call(O, "PATCH", "church/events/[id]", { params: { id: draft }, body: { online_url: "http://example.org/live", expected_updated_at: await H.stamp("ministry_events", draft) } });
  is("an http link is refused", res, 400, "invalid_online_url");
  const noTitle = await mk("church/events", { event_date: shift(D0, 20) });
  is("an event with no title cannot be published", await pub("church/events", "ministry_events", noTitle), 422, "needs_title");
  const frOnly = await mk("church/events", { event_date: shift(D0, 21), title_fr: "Culte" });
  is("a French-only event can be published", await pub("church/events", "ministry_events", frOnly), 200, "ok");
  is("an event without a date cannot be created", await H.call(O, "POST", "church/events", { body: { title_en: "x" } }), 400, "invalid_event_date");
  // announcements
  const a1 = await mk("church/announcements", { title_en: "Open", body_en: "Body" });
  const a2 = await mk("church/announcements", { title_en: "Short", body_en: "Body", expires_on: shift(D0, 2) });
  const a3 = await mk("church/announcements", { title_en: "Ends today", body_en: "Body", expires_on: D0 });
  const aOnlyTitle = await mk("church/announcements", { title_en: "Only a title" });
  for (const x of [a1, a2, a3]) is("publish an announcement", await pub("church/announcements", "ministry_announcements", x), 200, "ok");
  is("an announcement needs a title AND a body", await pub("church/announcements", "ministry_announcements", aOnlyTitle), 422, "needs_title_and_body");
  const anon = () => F.sessionFor(H.db, null).from("ministry_announcements").select("title_en");
  eq("anonymous reads the open ones, including the one ending today", ((await anon()).data || []).map((x) => x.title_en).sort(), ["Ends today", "Open", "Short"]);
  await F.svc(H.db, `update public.ministry_announcements set expires_on = '${shift(D0, -1)}' where id = '${a3}'`);
  eq("after its last day the public no longer reads it", ((await anon()).data || []).map((x) => x.title_en).sort(), ["Open", "Short"]);
  const annTitles = async (qs) => (await H.call(O, "GET", "church/announcements" + qs)).body.items.map((x) => x.title_en).sort();
  eq("announcements view published (not expired)", await annTitles("?view=published"), ["Open", "Short"]);
  eq("announcements view expired", await annTitles("?view=expired"), ["Ends today"]);
  eq("announcements view drafts", await annTitles("?view=drafts"), ["Only a title"]);
  res = await H.call(O, "GET", "church/announcements");
  check("the list marks state expired for the owner", res.body.items.find((x) => x.title_en === "Ends today").state === "expired");
  const frAnn = await mk("church/announcements", { title_fr: "Avis", body_fr: "Corps" });
  is("a French-only announcement can be published", await pub("church/announcements", "ministry_announcements", frAnn), 200, "ok");
  is("an announcement body over 2000 characters is refused", await H.call(O, "POST", "church/announcements", { body: { body_en: "x".repeat(2001) } }), 400, "invalid_message");
}

// ---- permissions -----------------------------------------------------------------------------------------------------------------------------------------------
section("D. permissions, for both entities: ");
for (const [name, S] of Object.entries(SPECS)) {
  await H.fresh(EXTRA);
  const draft = (await H.call(O, "POST", S.rel, { body: S.make() })).body.id;
  const live = (await H.call(O, "POST", S.rel, { body: S.make({ title_en: "Live one" }) })).body.id;
  await H.call(O, "POST", `${S.rel}/[id]/publish`, { params: { id: live }, body: { confirm: true, expected_updated_at: await H.stamp(S.table, live) } });
  const body = async (id, extra = {}) => ({ confirm: true, expected_updated_at: await H.stamp(S.table, id), ...extra });
  // view only
  let res = await H.call(ev, "GET", S.rel);
  check(`${name}: view only: reads the list, drafts included`, res.status === 200 && res.body.total === 2);
  res = await H.call(ev, "GET", `${S.rel}/[id]`, { params: { id: draft } });
  check(`${name}: view only: detail flags everything off`, res.status === 200 && res.body.can.edit === false && res.body.can.publish === false && res.body.can.delete === false);
  for (const [n, rr, st, code] of [
    ["create", await H.call(ev, "POST", S.rel, { body: S.make() }), 403, "forbidden"],
    ["edit", await H.call(ev, "PATCH", `${S.rel}/[id]`, { params: { id: draft }, body: { ...S.edit, expected_updated_at: await H.stamp(S.table, draft) } }), 403, "forbidden"],
    ["delete", await H.call(ev, "DELETE", `${S.rel}/[id]`, { params: { id: draft }, ...(await ts(S.table, draft)) }), 403, "forbidden"],
    ["publish", await H.call(ev, "POST", `${S.rel}/[id]/publish`, { params: { id: draft }, body: await body(draft) }), 403, "forbidden"],
    ["unpublish", await H.call(ev, "POST", `${S.rel}/[id]/unpublish`, { params: { id: live }, body: await body(live) }), 403, "forbidden"],
  ]) is(`${name}: view only cannot ${n}`, rr, st, code);
  // manage: drafts only
  res = await H.call(em, "POST", S.rel, { body: S.make({ title_en: "By writer" }) });
  is(`${name}: manage: create a draft`, res, 201, "ok");
  const mine = res.body.id;
  res = await H.call(em, "PATCH", `${S.rel}/[id]`, { params: { id: mine }, body: { ...S.edit, expected_updated_at: await H.stamp(S.table, mine) } });
  is(`${name}: manage: edit a draft`, res, 200, "ok");
  for (const [n, rr, st, code] of [
    ["publish", await H.call(em, "POST", `${S.rel}/[id]/publish`, { params: { id: mine }, body: await body(mine) }), 403, "forbidden"],
    ["unpublish", await H.call(em, "POST", `${S.rel}/[id]/unpublish`, { params: { id: live }, body: await body(live) }), 403, "forbidden"],
    ["edit a LIVE entry", await H.call(em, "PATCH", `${S.rel}/[id]`, { params: { id: live }, body: { title_en: "Vandal", expected_updated_at: await H.stamp(S.table, live) } }), 403, "publish_required"],
    ["delete a LIVE entry", await H.call(em, "DELETE", `${S.rel}/[id]`, { params: { id: live }, ...(await ts(S.table, live)) }), 403, "publish_required"],
  ]) is(`${name}: manage cannot ${n}`, rr, st, code);
  check(`${name}: ...the live entry is untouched`, (await H.rows(`select title_en from public.${S.table} where id = '${live}'`))[0].title_en === "Live one");
  res = await H.call(em, "DELETE", `${S.rel}/[id]`, { params: { id: mine }, ...(await ts(S.table, mine)) });
  is(`${name}: manage: delete a draft`, res, 200, "ok");
  // publish permission
  res = await H.call(ep, "PATCH", `${S.rel}/[id]`, { params: { id: live }, body: { title_en: "Corrected", expected_updated_at: await H.stamp(S.table, live) } });
  is(`${name}: publish: may edit a live entry`, res, 200, "ok");
  res = await H.call(ep, "POST", `${S.rel}/[id]/unpublish`, { params: { id: live }, body: await body(live) });
  is(`${name}: publish: may unpublish`, res, 200, "ok");
  res = await H.call(ep, "POST", `${S.rel}/[id]/publish`, { params: { id: live }, body: await body(live) });
  is(`${name}: publish: may publish`, res, 200, "ok");
  res = await H.call(ep, "DELETE", `${S.rel}/[id]`, { params: { id: live }, ...(await ts(S.table, live)) });
  is(`${name}: publish: may delete a live entry`, res, 200, "ok");
  // others
  for (const [who, tag] of [[u.plain1, "staff without the permission"], [u.mgr1, "a church administrator without the permission"], [u.stranger, "a stranger"], [u.leader1, "a group leader (roster record only)"], [u.viewer1, "a People viewer"]]) {
    is(`${name}: ${tag} cannot list`, await H.call(who, "GET", S.rel), 403, "forbidden");
    is(`${name}: ${tag} cannot create`, await H.call(who, "POST", S.rel, { body: S.make() }), 403, "forbidden");
  }
  is(`${name}: a platform admin with no relationship cannot list`, await H.call(u.admin, "GET", S.rel), 403, "forbidden");
  is(`${name}: a platform admin holding publish as a team member is refused`, await H.call(adminPub, "GET", S.rel), 403, "forbidden");
  is(`${name}: nobody signed in: 401`, await H.call(null, "GET", S.rel), 401, "not_signed_in");
  is(`${name}: a write without JSON is refused (415)`, await H.call(O, "POST", S.rel, { headers: { "content-type": "text/plain" }, raw: "x" }), 415, "invalid_body");
  check(`${name}: the service-role client was never used`, globalThis.__adminClientCalls === 0);
}

// ---- cross-church isolation --------------------------------------------------------------------------------------------------------------------------------------
section("E. cross-church isolation: ");
for (const [name, S] of Object.entries(SPECS)) {
  await H.fresh(EXTRA);
  const id1 = (await H.call(O, "POST", S.rel, { body: S.make() })).body.id;
  const live1 = (await H.call(O, "POST", S.rel, { body: S.make({ title_en: "Live one" }) })).body.id;
  await H.call(O, "POST", `${S.rel}/[id]/publish`, { params: { id: live1 }, body: { confirm: true, expected_updated_at: await H.stamp(S.table, live1) } });
  const id2 = (await H.call(u.owner2, "POST", S.rel, { body: S.make({ title_en: "Other church" }) })).body.id;
  const before = JSON.stringify(await H.rows(`select id, title_en, status, updated_at::text from public.${S.table} order by id`));
  for (const [n, rr] of [
    ["detail", await H.call(u.owner2, "GET", `${S.rel}/[id]`, { params: { id: id1 } })],
    ["edit", await H.call(u.owner2, "PATCH", `${S.rel}/[id]`, { params: { id: id1 }, body: { title_en: "Hijack", expected_updated_at: await H.stamp(S.table, id1) } })],
    ["delete", await H.call(u.owner2, "DELETE", `${S.rel}/[id]`, { params: { id: id1 }, ...(await ts(S.table, id1)) })],
    ["publish", await H.call(u.owner2, "POST", `${S.rel}/[id]/publish`, { params: { id: id1 }, body: { confirm: true, expected_updated_at: await H.stamp(S.table, id1) } })],
    ["unpublish a LIVE one", await H.call(u.owner2, "POST", `${S.rel}/[id]/unpublish`, { params: { id: live1 }, body: { confirm: true, expected_updated_at: await H.stamp(S.table, live1) } })],
    ["delete a LIVE one", await H.call(u.owner2, "DELETE", `${S.rel}/[id]`, { params: { id: live1 }, ...(await ts(S.table, live1)) })],
  ]) is(`${name}: other church's owner: ${n} -> not found`, rr, 404, "not_found");
  check(`${name}: nothing of church 1 changed`, JSON.stringify(await H.rows(`select id, title_en, status, updated_at::text from public.${S.table} order by id`)) === before);
  const list = await H.call(u.owner2, "GET", S.rel);
  check(`${name}: their list holds only their own entry`, list.body.total === 1 && list.body.items[0].id === id2, JSON.stringify(list.body.items));
  // a body can never carry another church or a status
  for (const [n, rr, st, code] of [
    ["profile_id in a create", await H.call(O, "POST", S.rel, { body: { ...S.make(), profile_id: prof.c2 } }), 400, "unexpected_field"],
    ["status in a create", await H.call(O, "POST", S.rel, { body: { ...S.make(), status: "published" } }), 400, "unexpected_field"],
    ["profile_id in an edit", await H.call(O, "PATCH", `${S.rel}/[id]`, { params: { id: id1 }, body: { profile_id: prof.c2, expected_updated_at: await H.stamp(S.table, id1) } }), 400, "unexpected_field"],
    ["status in an edit", await H.call(O, "PATCH", `${S.rel}/[id]`, { params: { id: id1 }, body: { status: "published", expected_updated_at: await H.stamp(S.table, id1) } }), 400, "unexpected_field"],
    ["published_at in an edit", await H.call(O, "PATCH", `${S.rel}/[id]`, { params: { id: id1 }, body: { published_at: "2020-01-01T00:00:00Z", expected_updated_at: await H.stamp(S.table, id1) } }), 400, "unexpected_field"],
    ["an array body", await H.call(O, "POST", S.rel, { raw: "[]" }), 400, "invalid_body"],
    ["a null body", await H.call(O, "POST", S.rel, { raw: "null" }), 400, "invalid_body"],
    ["malformed JSON", await H.call(O, "POST", S.rel, { raw: "{nope" }), 400, "invalid_body"],
    ["an oversized body", await H.call(O, "POST", S.rel, { raw: JSON.stringify({ title_en: "x".repeat(9000) }) }), 413, "invalid_body"],
    ["an id that is not a uuid", await H.call(O, "GET", `${S.rel}/[id]`, { params: { id: "x' or '1'='1" } }), 404, "not_found"],
    ["an empty edit", await H.call(O, "PATCH", `${S.rel}/[id]`, { params: { id: id1 }, body: { expected_updated_at: await H.stamp(S.table, id1) } }), 400, "empty_update"],
  ]) is(`${name}: ${n} is refused`, rr, st, code);
  // an entry planted for another church directly through the database stays invisible
  check(`${name}: the other church's anonymous read holds no draft`, ((await F.sessionFor(H.db, null).from(S.table).select("id")).data || []).length === 1);
}

// ---- concurrency: every change of an existing entry needs the version it was based on ---------------------------------------------------------------------------
section("F. the mandatory expected_updated_at, for every kind of change: ");
for (const [name, S] of Object.entries(SPECS)) {
  await H.fresh(EXTRA);
  const id = (await H.call(O, "POST", S.rel, { body: S.make() })).body.id;
  const snap = async () => JSON.stringify(await H.rows(`select title_en, status, updated_at::text, published_at::text from public.${S.table} where id = '${id}'`));
  const before = await snap();
  const BAD = ["not-a-date", "", null, 12345, "x".repeat(41)];
  // edit
  let res = await H.call(O, "PATCH", `${S.rel}/[id]`, { params: { id }, body: { ...S.edit } });
  is(`${name}: edit without expected_updated_at is refused`, res, 400, "invalid_body");
  check(`${name}: ...naming the field`, res.body.field === "expected_updated_at");
  for (const bad of BAD) is(`${name}: edit with an invalid timestamp (${JSON.stringify(bad)})`, await H.call(O, "PATCH", `${S.rel}/[id]`, { params: { id }, body: { ...S.edit, expected_updated_at: bad } }), 400, "invalid_body");
  is(`${name}: edit with a stale timestamp`, await H.call(O, "PATCH", `${S.rel}/[id]`, { params: { id }, body: { ...S.edit, expected_updated_at: "2020-01-01T00:00:00Z" } }), 409, "stale");
  // publish / unpublish
  for (const kind of ["publish", "unpublish"]) {
    if (kind === "unpublish") {
      res = await H.call(O, "POST", `${S.rel}/[id]/publish`, { params: { id }, body: { confirm: true, expected_updated_at: await H.stamp(S.table, id) } });
      is(`${name}: publish with the current timestamp`, res, 200, "ok");
    }
    const mid = await snap();
    res = await H.call(O, "POST", `${S.rel}/[id]/${kind}`, { params: { id }, body: { confirm: true } });
    is(`${name}: ${kind} without expected_updated_at is refused`, res, 400, "invalid_body");
    check(`${name}: ...${kind}: naming the field`, res.body.field === "expected_updated_at");
    for (const bad of BAD) is(`${name}: ${kind} with an invalid timestamp (${JSON.stringify(bad)})`, await H.call(O, "POST", `${S.rel}/[id]/${kind}`, { params: { id }, body: { confirm: true, expected_updated_at: bad } }), 400, "invalid_body");
    is(`${name}: ${kind} with a stale timestamp`, await H.call(O, "POST", `${S.rel}/[id]/${kind}`, { params: { id }, body: { confirm: true, expected_updated_at: "2020-01-01T00:00:00Z" } }), 409, "stale");
    check(`${name}: ${kind}: nothing was modified by the refused attempts`, (await snap()) === mid);
  }
  // delete
  const mid = await snap();
  res = await H.call(O, "DELETE", `${S.rel}/[id]`, { params: { id } });
  is(`${name}: delete without expected_updated_at is refused`, res, 400, "invalid_body");
  for (const bad of ["not-a-date", "", "x".repeat(41)]) is(`${name}: delete with an invalid timestamp (${JSON.stringify(bad)})`, await H.call(O, "DELETE", `${S.rel}/[id]`, { params: { id }, url: `?expected_updated_at=${encodeURIComponent(bad)}` }), 400, "invalid_body");
  is(`${name}: delete with a repeated timestamp`, await H.call(O, "DELETE", `${S.rel}/[id]`, { params: { id }, url: "?expected_updated_at=2020-01-01T00:00:00Z&expected_updated_at=2020-01-02T00:00:00Z" }), 400, "invalid_body");
  is(`${name}: delete with an extra query key`, await H.call(O, "DELETE", `${S.rel}/[id]`, { params: { id }, url: `?expected_updated_at=${encodeURIComponent(await H.stamp(S.table, id))}&x=1` }), 400, "unexpected_field");
  is(`${name}: delete with a stale timestamp`, await H.call(O, "DELETE", `${S.rel}/[id]`, { params: { id }, url: "?expected_updated_at=2020-01-01T00:00:00Z" }), 409, "stale");
  check(`${name}: delete: the row is unchanged after every refused attempt`, (await snap()) === mid);
  // someone else's edit in between
  const old = await H.stamp(S.table, id);
  await H.call(O, "POST", `${S.rel}/[id]/unpublish`, { params: { id }, body: { confirm: true, expected_updated_at: old } });
  const old2 = await H.stamp(S.table, id);
  await H.call(O, "PATCH", `${S.rel}/[id]`, { params: { id }, body: { ...S.edit, expected_updated_at: old2 } });
  is(`${name}: a delete based on the version before someone else's edit is refused`, await H.call(O, "DELETE", `${S.rel}/[id]`, { params: { id }, url: `?expected_updated_at=${encodeURIComponent(old2)}` }), 409, "stale");
  check(`${name}: ...and the edited entry survives`, (await H.rows(`select count(*)::int as n from public.${S.table} where id = '${id}'`))[0].n === 1);
  is(`${name}: delete with the current timestamp`, await H.call(O, "DELETE", `${S.rel}/[id]`, { params: { id }, ...(await ts(S.table, id)) }), 200, "ok");
  // ordering is unchanged: permission and existence answer before the timestamp
  const other = (await H.call(O, "POST", S.rel, { body: S.make() })).body.id;
  is(`${name}: a view-only user without a timestamp still gets 403, not 400`, await H.call(ev, "PATCH", `${S.rel}/[id]`, { params: { id: other }, body: { ...S.edit } }), 403, "forbidden");
  is(`${name}: an unknown entry without a timestamp still gets 404, not 400`, await H.call(O, "PATCH", `${S.rel}/[id]`, { params: { id: F.id("e", 997) }, body: { ...S.edit } }), 404, "not_found");
  is(`${name}: another church's entry without a timestamp still gets 404`, await H.call(u.owner2, "DELETE", `${S.rel}/[id]`, { params: { id: other } }), 404, "not_found");
}

// ---- static ---------------------------------------------------------------------------------------------------------------------------------------------------
section("G. the code itself: ");
{
  const rd = (p) => fs.readFileSync(path.join(SRC, p), "utf8");
  const files = ["lib/church/lifecycle/engine.ts", "lib/church/lifecycle/events.ts", "lib/church/lifecycle/validation.ts"];
  for (const f of files) {
    const code = rd(f).replace(/\/\/[^\n]*/g, "");
    check(`${f}: no service-role client, no raw SQL, no eval`, !/createAdminClient|service_role|\.rpc\(|eval\(|new Function|dangerouslySetInnerHTML/.test(code));
  }
  for (const f of ["events", "announcements"]) for (const sub of ["route.ts", "[id]/route.ts", "[id]/publish/route.ts", "[id]/unpublish/route.ts"]) {
    const code = rd(`app/api/church/${f}/${sub}`);
    check(`church/${f}/${sub}: goes through churchRoute and never takes a church from the request`, /churchRoute\(/.test(code) && !/profile_id|profileId|searchParams\.get\(/.test(code.replace(/\/\/[^\n]*/g, "")));
    check(`church/${f}/${sub}: dynamic and uncached`, /export const dynamic = "force-dynamic"/.test(code));
  }
  check("the public tables are not reachable through the ticketing events table", !/from\("events"\)/.test(rd("lib/church/lifecycle/events.ts")));
}

console.error = realConsoleError;
await H.close();
process.exit(summary());
