// Churches & Ministries Phase 7: the Attendance back end, validated end to end and OFFLINE.
// The REAL route files (src/app/api/church/attendance/**, and the Phase 4 events routes for the delete interplay), the REAL handlers, validation, error mapping and actor resolution run against
// scratch in-memory PostgreSQL (PGlite) that holds the REAL Team migrations, the REAL Phase 2A church migration and the REAL Phase 3 / 4 / 7 migrations. See scripts/tests/ministryApiHarness.mjs.
//   Run:  node scripts/tests/ministryAttendanceApi.test.mjs
import fs from "fs";
import path from "path";
import { createHarness, kit, shift, doualaToday, SRC } from "./ministryApiHarness.mjs";

const H = await createHarness({ dailyWords: true, events: true, attendance: true });
const { F, jiti } = H;
const { u, prof, m } = F;
const { check, eq, is, section, summary } = kit();
const realConsoleError = console.error;
console.error = () => {};

const AH = jiti(path.join(SRC, "lib/church/attendance/handlers.ts"));
const PERM = jiti(path.join(SRC, "lib/church/permissions.ts"));
const ERR = jiti(path.join(SRC, "lib/church/errors.ts"));

const U2 = (n) => F.id("c", 60 + n);
const av = U2(1), am = U2(2), amr = U2(3), adminMgr = U2(4), evOnly = U2(5);
const R2 = (n) => F.id("b", 60 + n);
const r = { view: R2(1), manage: R2(2), manageRoster: R2(3), adminMgr: R2(4), events: R2(5) };
const E = (k) => F.id("8", 300 + k);
const D0 = doualaToday();
const EXTRA = `
  insert into public.users (id, role, plan_id) values ('${av}','user','${F.plan.free}'), ('${am}','user','${F.plan.free}'), ('${amr}','user','${F.plan.free}'), ('${adminMgr}','admin','${F.plan.free}'), ('${evOnly}','user','${F.plan.free}');
  insert into public.organization_roles (id, profile_id, key, name, permissions) values
    ('${r.view}','${prof.c1}','aview','Attendance viewer','{church.attendance.view}'),
    ('${r.manage}','${prof.c1}','amanage','Attendance recorder (no roster)','{church.attendance.manage}'),
    ('${r.manageRoster}','${prof.c1}','amr','Attendance recorder with People view','{church.attendance.manage,church.members.view}'),
    ('${r.adminMgr}','${prof.c1}','aadmin','Admin holding manage','{church.attendance.manage,church.attendance.view,church.members.view}'),
    ('${r.events}','${prof.c1}','aevents','Events publisher only','{church.events.publish}');
  insert into public.organization_members (profile_id, user_id, role_id) values ('${prof.c1}','${av}','${r.view}'), ('${prof.c1}','${am}','${r.manage}'), ('${prof.c1}','${amr}','${r.manageRoster}'), ('${prof.c1}','${adminMgr}','${r.adminMgr}'), ('${prof.c1}','${evOnly}','${r.events}');
  insert into public.ministry_events (id, profile_id, status, event_date, title_en, is_cancelled) values
    ('${E(1)}','${prof.c1}','published', public.ministry_today(), 'Today service', false),
    ('${E(2)}','${prof.c1}','published', public.ministry_today() - 7, 'Last week service', false),
    ('${E(3)}','${prof.c1}','published', public.ministry_today() + 3, 'Future service', false),
    ('${E(4)}','${prof.c1}','draft', public.ministry_today() - 1, 'Draft event', false),
    ('${E(5)}','${prof.c1}','published', public.ministry_today() - 1, 'Cancelled event', true),
    ('${E(6)}','${prof.c2}','published', public.ministry_today(), 'Other church service', false);
`;
const O = u.owner1;
const rec = (who, ev, body) => H.call(who, "POST", "church/attendance/[eventId]", { params: { eventId: ev }, body });
const get = (who, ev) => H.call(who, "GET", "church/attendance/[eventId]", { params: { eventId: ev } });
const del = (who, ev, mid) => H.call(who, "DELETE", "church/attendance/[eventId]", { params: { eventId: ev }, url: `?member_id=${mid}` });
const counts = (who, ev, body) => H.call(who, "POST", "church/attendance/[eventId]/counts", { params: { eventId: ev }, body });
const present = async (ev) => (await H.rows(`select count(*)::int as n from public.ministry_attendance where event_id = '${ev}'`))[0].n;

// =================================================================================================================================================================
section("A. input validation (pure): ");
// =================================================================================================================================================================
{
  const P = AH.parseRecordBody, C = AH.parseCountsBody, L = AH.parseAttendanceListQuery;
  const id1 = F.id("e", 1), id2 = F.id("e", 2);
  check("record: one person", P({ member_id: id1 }).ok && P({ member_id: id1 }).ids[0] === id1);
  check("record: several people, duplicates folded", P({ member_ids: [id1, id2, id1] }).ids.length === 2);
  check("record: exactly one of member_id / member_ids", P({}).code === "invalid_body" && P({ member_id: id1, member_ids: [id2] }).code === "invalid_body");
  check("record: not a uuid", P({ member_id: "x" }).code === "invalid_member_id" && P({ member_id: 5 }).code === "invalid_member_id");
  check("record: a list must be non-empty, uuids, at most 100", P({ member_ids: [] }).code === "invalid_member_ids" && P({ member_ids: ["x"] }).code === "invalid_member_ids" && P({ member_ids: Array.from({ length: 101 }, (_, i) => F.id("e", i + 1)) }).code === "invalid_member_ids" && P({ member_ids: Array.from({ length: 100 }, (_, i) => F.id("e", i + 1)) }).ok && P({ member_ids: "x" }).code === "invalid_member_ids");
  check("record: no other field is accepted (church, event, status, recorder)", ["profile_id", "event_id", "recorded_by", "status", "id"].every((f) => P({ member_id: id1, [f]: "x" }).code === "unexpected_field"));
  check("record: not an object", P(null).code === "invalid_body" && P([]).code === "invalid_body" && P("x").code === "invalid_body");
  check("counts: two whole numbers in range", C({ visitors: 0, children: 0 }).ok && C({ visitors: 100000, children: 5 }).ok);
  check("counts: negative, fractional, too large, text, missing are refused", ["-1", "1.5", "100001"].every((v) => C({ visitors: Number(v), children: 0 }).code === "invalid_count") && C({ visitors: "3", children: 0 }).code === "invalid_count" && C({ visitors: 1 }).code === "invalid_count" && C({ visitors: null, children: 0 }).code === "invalid_count" && C({ visitors: NaN, children: 0 }).code === "invalid_count" && C({ visitors: Infinity, children: 0 }).code === "invalid_count");
  check("counts: a bad expected_updated_at is refused; unknown fields are refused", C({ visitors: 1, children: 0, expected_updated_at: "soon" }).code === "invalid_body" && C({ visitors: 1, children: 0, event_id: "x" }).code === "unexpected_field");
  check("list query: page only", L(new URLSearchParams("")).page === 1 && L(new URLSearchParams("page=3")).page === 3 && L(new URLSearchParams("page=0")).code === "invalid_page" && L(new URLSearchParams("view=all")).code === "unexpected_field");
  const caps = (...p) => PERM.churchCapabilities(p);
  check("capabilities: view / manage", caps("church.attendance.view").viewAttendance && !caps("church.attendance.view").manageAttendance && caps("church.attendance.manage").viewAttendance && caps("church.attendance.manage").manageAttendance && !caps("church.events.publish").viewAttendance && !caps("church.members.manage").viewAttendance);
  check("the two strings are registered as church permissions and are SENSITIVE (owner-only to grant)", ["church.attendance.view", "church.attendance.manage"].every((p) => PERM.CHURCH_PERMISSIONS.includes(p) && PERM.isSensitiveChurchPermissionName(p)));
  const cls = (message, code = "23514") => ERR.classifyDbError({ message, code });
  eq("db: child", [cls("attendance_child_not_allowed").status, cls("attendance_child_not_allowed").code], [422, "child_not_allowed"]);
  eq("db: inactive person", cls("attendance_member_not_active").code, "member_not_active");
  eq("db: cancelled / not started / not published", [cls("attendance_event_cancelled").code, cls("attendance_event_not_started").code, cls("attendance_event_not_published").code], ["event_cancelled", "event_not_started", "event_not_open"]);
  eq("db: duplicate", cls('duplicate key value violates unique constraint "ministry_attendance_event_member_key"', "23505").code, "already_recorded");
  eq("db: deleting an event that has attendance", cls('update or delete on table "ministry_events" violates foreign key constraint "ministry_attendance_event_fk" on table "ministry_attendance"', "23503").code, "event_has_attendance");
  eq("db: a foreign-key failure on an insert is NOT reported as 'event has attendance'", cls('insert or update on table "ministry_attendance" violates foreign key constraint "ministry_attendance_event_fk"', "23503").code, "in_use");
  eq("db: count out of range", cls('violates check constraint "ministry_attendance_counts_visitors_check"').code, "invalid_count");
}

// =================================================================================================================================================================
section("B. the recording flow: ");
// =================================================================================================================================================================
{
  await H.fresh(EXTRA);
  let res = await H.call(O, "GET", "church/attendance");
  is("list", res, 200, "ok");
  eq("the list holds the started, published events of the church, newest first (draft, future and other church excluded; cancelled included)", res.body.items.map((x) => x.id), [E(1), E(5), E(2)]);
  check("...each with present / visitors / children and whether it can be recorded", res.body.items.every((x) => x.present === 0 && x.visitors === 0 && x.children === 0) && res.body.items.find((x) => x.id === E(5)).recordable === false && res.body.items.find((x) => x.id === E(1)).recordable === true);
  check("the list leaks nothing but the event and numbers", res.body.items.every((x) => !("people" in x) && !("member_id" in x)) && !JSON.stringify(res.body).match(/Grace|full_name|created_by|recorded_by|profile_id/));
  res = await get(O, E(1));
  is("an event with no attendance yet", res, 200, "ok");
  check("...empty people, no counts, recordable", res.body.people.length === 0 && res.body.counts === null && res.body.can.record === true && res.body.open === true);
  res = await rec(O, E(1), { member_id: m.admin });
  is("record one person", res, 201, "ok");
  check("...recorded 1", res.body.recorded === 1 && res.body.already === 0);
  res = await rec(O, E(1), { member_id: m.admin });
  is("recording the same person again is idempotent", res, 200, "ok");
  check("...nothing new, one already present", res.body.recorded === 0 && res.body.already === 1 && (await present(E(1))) === 1);
  res = await rec(O, E(1), { member_ids: [m.admin, m.leader, m.vol, m.other] });
  is("record a group of people at once (one already present)", res, 201, "ok");
  check("...three new, one already", res.body.recorded === 3 && res.body.already === 1 && (await present(E(1))) === 4);
  res = await get(O, E(1));
  eq("the owner sees the names (the owner holds the People permission)", res.body.people.map((p) => p.full_name).sort(), ["Grace Admin", "Luc Leader", "Olivier Other", "Vera Volunteer"]);
  check("...in the order they were recorded, with a time, and no recorder", res.body.people.length === 4 && res.body.people.every((p) => p.recorded_at) && !JSON.stringify(res.body).match(/recorded_by|created_by|profile_id/));
  // refusals: atomic
  const before = await present(E(1));
  res = await rec(O, E(1), { member_ids: [m.youth, m.kid1] });
  is("a child in the batch refuses the whole batch", res, 422, "child_not_allowed");
  check("...and nobody of that batch was recorded", (await present(E(1))) === before);
  res = await rec(O, E(1), { member_ids: [m.youth, m.pending] });
  is("a person who is not active refuses the whole batch", res, 422, "member_not_active");
  check("...and nobody was recorded", (await present(E(1))) === before);
  is("a person of another church is not found", await rec(O, E(1), { member_id: m.c2a }), 404, "member_not_found");
  is("an unknown person is not found", await rec(O, E(1), { member_id: F.id("e", 998) }), 404, "member_not_found");
  is("an event that has not started is refused", await rec(O, E(3), { member_id: m.admin }), 409, "event_not_started");
  is("a cancelled event is refused", await rec(O, E(5), { member_id: m.admin }), 409, "event_cancelled");
  is("a draft event is not found (it is not attendable)", await rec(O, E(4), { member_id: m.admin }), 404, "not_found");
  is("another church's event is not found", await rec(O, E(6), { member_id: m.admin }), 404, "not_found");
  is("a malformed event id is not found", await rec(O, "x' or '1'='1", { member_id: m.admin }), 404, "not_found");
  is("an invalid body is refused", await rec(O, E(1), { member_id: "nope" }), 400, "invalid_member_id");
  res = await get(O, E(3));
  check("the detail of a future event is readable but not recordable", res.status === 200 && res.body.can.record === false && res.body.open === false);
  is("the detail of a draft event is not found", await get(O, E(4)), 404, "not_found");
  // remove
  res = await del(O, E(1), m.other);
  is("remove one person's record", res, 200, "ok");
  check("...and only that one", (await present(E(1))) === before - 1);
  is("removing it again is not found", await del(O, E(1), m.other), 404, "not_found");
  is("removing with a bad member id is refused", await H.call(O, "DELETE", "church/attendance/[eventId]", { params: { eventId: E(1) }, url: "?member_id=nope" }), 400, "invalid_member_id");
  is("removing without a member id is refused", await H.call(O, "DELETE", "church/attendance/[eventId]", { params: { eventId: E(1) } }), 400, "invalid_member_id");
  is("removing with an extra query key is refused", await H.call(O, "DELETE", "church/attendance/[eventId]", { params: { eventId: E(1) }, url: `?member_id=${m.admin}&x=1` }), 400, "unexpected_field");
  // counts
  res = await counts(O, E(1), { visitors: 5, children: 3 });
  is("set the counts (first time: no timestamp needed)", res, 201, "ok");
  const stamp1 = res.body.counts.updated_at;
  check("...numbers only", res.body.counts.visitors === 5 && res.body.counts.children === 3 && Object.keys(res.body.counts).sort().join() === "children,updated_at,visitors");
  res = await counts(O, E(1), { visitors: 6, children: 3 });
  is("changing existing counts WITHOUT expected_updated_at is refused", res, 400, "invalid_body");
  check("...naming the field", res.body.field === "expected_updated_at");
  for (const bad of ["soon", "", null, 12]) is(`changing existing counts with an invalid timestamp (${JSON.stringify(bad)})`, await counts(O, E(1), { visitors: 6, children: 3, expected_updated_at: bad }), 400, "invalid_body");
  is("changing existing counts with a stale timestamp", await counts(O, E(1), { visitors: 6, children: 3, expected_updated_at: "2020-01-01T00:00:00Z" }), 409, "stale");
  check("...nothing changed", (await H.rows(`select visitors from public.ministry_attendance_counts where event_id = '${E(1)}'`))[0].visitors === 5);
  res = await counts(O, E(1), { visitors: 6, children: 4, expected_updated_at: stamp1 });
  is("changing existing counts with the current timestamp", res, 200, "ok");
  check("...the new numbers and a new timestamp", res.body.counts.visitors === 6 && res.body.counts.children === 4 && res.body.counts.updated_at !== stamp1);
  is("the previous timestamp is now stale", await counts(O, E(1), { visitors: 7, children: 4, expected_updated_at: stamp1 }), 409, "stale");
  is("a count over the limit is refused", await counts(O, E(1), { visitors: 100001, children: 0, expected_updated_at: res.body.counts.updated_at }), 400, "invalid_count");
  is("counts for a cancelled event are refused", await counts(O, E(5), { visitors: 1, children: 0 }), 409, "event_cancelled");
  is("counts for a future event are refused", await counts(O, E(3), { visitors: 1, children: 0 }), 409, "event_not_started");
  is("counts for a draft event: not found", await counts(O, E(4), { visitors: 1, children: 0 }), 404, "not_found");
  res = await get(O, E(1));
  check("the detail carries the counts", res.body.counts.visitors === 6 && res.body.counts.children === 4);
  res = await H.call(O, "GET", "church/attendance");
  check("the list carries present and the counts", res.body.items.find((x) => x.id === E(1)).present === (await present(E(1))) && res.body.items.find((x) => x.id === E(1)).visitors === 6 && res.body.items.find((x) => x.id === E(1)).children === 4);
  is("an unknown query key on the list is refused", await H.call(O, "GET", "church/attendance?x=1"), 400, "unexpected_field");
  is("a bad page is refused", await H.call(O, "GET", "church/attendance?page=0"), 400, "invalid_page");
  check("the service-role client was never used", globalThis.__adminClientCalls === 0);
}

// =================================================================================================================================================================
section("C. permissions: ");
// =================================================================================================================================================================
{
  await H.fresh(EXTRA);
  await F.svc(H.db, `insert into public.ministry_attendance (profile_id, event_id, member_id) values ('${prof.c1}','${E(1)}','${m.admin}'), ('${prof.c1}','${E(1)}','${m.leader}');
    insert into public.ministry_attendance_counts (event_id, profile_id, visitors, children) values ('${E(1)}','${prof.c1}',2,1)`);
  // view only
  let res = await H.call(av, "GET", "church/attendance");
  check("view only: reads the list", res.status === 200 && res.body.items.length === 3);
  res = await get(av, E(1));
  check("view only: sees the count of people and the numbers, but NO names (no People permission)", res.status === 200 && res.body.people.length === 2 && res.body.people.every((p) => p.full_name === null) && res.body.counts.visitors === 2 && res.body.can.seeNames === false && res.body.can.record === false && res.body.can.remove === false);
  is("view only cannot record", await rec(av, E(1), { member_id: m.vol }), 403, "forbidden");
  is("view only cannot remove", await del(av, E(1), m.admin), 403, "forbidden");
  is("view only cannot set counts", await counts(av, E(1), { visitors: 9, children: 9 }), 403, "forbidden");
  // recorder without the roster: records by id, sees no names
  res = await get(am, E(1));
  check("recorder without People view: sees ids and numbers only", res.status === 200 && res.body.people.every((p) => p.full_name === null) && res.body.can.record === true && res.body.can.seeNames === false);
  is("...but can still record (a person is identified by id)", await rec(am, E(1), { member_id: m.vol }), 201, "ok");
  // recorder with the roster
  res = await get(amr, E(1));
  check("recorder with People view: sees names", res.body.people.some((p) => p.full_name === "Grace Admin") && res.body.can.seeNames === true);
  is("recorder with People view records", await rec(amr, E(1), { member_id: m.other }), 201, "ok");
  is("...remove", await del(amr, E(1), m.other), 200, "ok");
  // everyone else
  for (const [who, tag] of [[u.plain1, "staff without the permission"], [u.mgr1, "a church administrator without the permission"], [u.viewer1, "a People viewer"], [evOnly, "an events publisher"], [u.stranger, "a stranger"], [u.leader1, "a group leader (roster record only)"], [u.admin, "a platform admin with no relationship"], [adminMgr, "a platform admin holding the permissions as a team member"]]) {
    is(`${tag}: cannot list`, await H.call(who, "GET", "church/attendance"), 403, "forbidden");
    is(`${tag}: cannot read an event's attendance`, await get(who, E(1)), 403, "forbidden");
    is(`${tag}: cannot record`, await rec(who, E(1), { member_id: m.vol }), 403, "forbidden");
    is(`${tag}: cannot remove`, await del(who, E(1), m.admin), 403, "forbidden");
    is(`${tag}: cannot set counts`, await counts(who, E(1), { visitors: 9, children: 9 }), 403, "forbidden");
  }
  is("nobody signed in: 401", await H.call(null, "GET", "church/attendance"), 401, "not_signed_in");
  is("a write without JSON is refused (415)", await H.call(O, "POST", "church/attendance/[eventId]", { params: { eventId: E(1) }, headers: { "content-type": "text/plain" }, raw: "x" }), 415, "invalid_body");
  is("malformed JSON is refused", await H.call(O, "POST", "church/attendance/[eventId]", { params: { eventId: E(1) }, raw: "{nope" }), 400, "invalid_body");
  check("nothing was changed by the refused attempts", (await present(E(1))) === 3 && (await H.rows(`select visitors from public.ministry_attendance_counts where event_id = '${E(1)}'`))[0].visitors === 2);
  check("the service-role client was never used", globalThis.__adminClientCalls === 0);
}

// =================================================================================================================================================================
section("D. cross-church isolation and events: ");
// =================================================================================================================================================================
{
  await H.fresh(EXTRA);
  await F.svc(H.db, `insert into public.ministry_attendance (profile_id, event_id, member_id) values ('${prof.c1}','${E(1)}','${m.admin}');
    insert into public.ministry_attendance (profile_id, event_id, member_id) values ('${prof.c2}','${E(6)}','${m.c2a}')`);
  const snap = async () => JSON.stringify(await H.rows("select event_id, member_id from public.ministry_attendance order by 1, 2"));
  const before = await snap();
  for (const [n, rr] of [
    ["detail", await get(u.owner2, E(1))],
    ["record", await rec(u.owner2, E(1), { member_id: m.c2a })],
    ["record someone of church 1", await rec(u.owner2, E(6), { member_id: m.admin })],
    ["remove", await del(u.owner2, E(1), m.admin)],
    ["counts", await counts(u.owner2, E(1), { visitors: 9, children: 9 })],
  ]) check(`other church's owner: ${n} -> not found`, rr.status === 404, JSON.stringify(rr.body));
  check("nothing of church 1 changed", (await snap()) === before);
  const list = await H.call(u.owner2, "GET", "church/attendance");
  check("their list holds only their own event", list.body.items.length === 1 && list.body.items[0].id === E(6) && list.body.items[0].present === 1, JSON.stringify(list.body.items.map((x) => x.id)));
  // events interplay (Phase 4 routes)
  const ev = (rel, method, p, extra = {}) => H.call(O, method, rel, { params: p, ...extra });
  let res = await ev("church/events/[id]", "DELETE", { id: E(1) }, { url: `?expected_updated_at=${encodeURIComponent(await H.stamp("ministry_events", E(1)))}` });
  is("an event with attendance cannot be deleted (a clear code, not a database message)", res, 409, "event_has_attendance");
  check("...and it is still there with its attendance", (await H.rows(`select count(*)::int as n from public.ministry_events where id = '${E(1)}'`))[0].n === 1 && (await snap()) === before);
  res = await ev("church/events/[id]/unpublish", "POST", { id: E(1) }, { body: { confirm: true, expected_updated_at: await H.stamp("ministry_events", E(1)) } });
  is("it can be unpublished instead", res, 200, "ok");
  is("an unpublished event is no longer attendable (not found)", await rec(O, E(1), { member_id: m.leader }), 404, "not_found");
  check("...its attendance is kept in the database", (await present(E(1))) === 1);
  res = await ev("church/events/[id]/publish", "POST", { id: E(1) }, { body: { confirm: true, expected_updated_at: await H.stamp("ministry_events", E(1)) } });
  is("publishing it again brings it back", res, 200, "ok");
  is("...and it can be recorded again", await rec(O, E(1), { member_id: m.leader }), 201, "ok");
  // erasing a roster person erases their attendance (the roster's own delete, service side)
  await F.svc(H.db, `delete from public.church_members where id = '${m.leader}'`).catch(() => {});
  check("a person removed from the roster leaves no attendance row behind (or is still protected by the roster's own rules)", (await H.rows(`select count(*)::int as n from public.ministry_attendance where member_id = '${m.leader}'`))[0].n === 0 || (await H.rows(`select count(*)::int as n from public.church_members where id = '${m.leader}'`))[0].n === 1);
}

// =================================================================================================================================================================
section("E. the code itself: ");
// =================================================================================================================================================================
{
  const rd = (p) => fs.readFileSync(path.join(SRC, p), "utf8");
  const code = rd("lib/church/attendance/handlers.ts").replace(/\/\/[^\n]*/g, "");
  check("handlers: no service-role client, no raw SQL, no eval", !/createAdminClient|service_role|\.rpc\(|eval\(|new Function/.test(code));
  check("handlers: the church always comes from the actor", (code.match(/profile_id: a\.profileId/g) || []).length >= 2 && !/params\.get\("profile_id"\)|body\.profile_id/.test(code));
  check("handlers: the status of an event is not taken from the request and only published events are attendable", /\.eq\("status", "published"\)/.test(code));
  check("handlers: counts that exist need expected_updated_at and are written with an updated_at filter", /expected_updated_at/.test(code) && /\.eq\("updated_at"/.test(code));
  check("handlers: names are read only with the People permission", /a\.caps\.viewMembers/.test(code));
  for (const sub of ["route.ts", "[eventId]/route.ts", "[eventId]/counts/route.ts"]) {
    const route = rd(`app/api/church/attendance/${sub}`);
    check(`attendance/${sub}: goes through churchRoute, never takes a church from the request, dynamic and uncached`, /churchRoute\(/.test(route) && !/profile_id|profileId/.test(route.replace(/\/\/[^\n]*/g, "")) && /export const dynamic = "force-dynamic"/.test(route));
  }
}

console.error = realConsoleError;
await H.close();
process.exit(summary());
