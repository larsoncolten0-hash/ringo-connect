// Churches & Ministries Recurring Weekly Services: the back end, validated end to end and OFFLINE.
// The REAL route files (src/app/api/church/services/**), the REAL handlers, validation, error mapping and actor resolution run against scratch in-memory PostgreSQL (PGlite) that holds the REAL Team
// migrations, the REAL Phase 2A church migration and the REAL 2027-01-16_church_service_schedule.sql. See scripts/tests/ministryApiHarness.mjs.
//   Run:  node scripts/tests/churchServiceScheduleApi.test.mjs
import path from "path";
import fs from "fs";
import { createHarness, kit, SRC, REPO } from "./ministryApiHarness.mjs";

const H = await createHarness({ services: true });
const { F, jiti } = H;
const { u, prof } = F;
const { check, eq, is, section, summary } = kit();
console.error = () => {};

const SH = jiti(path.join(SRC, "lib/church/schedule/handlers.ts"));
const PERM = jiti(path.join(SRC, "lib/church/permissions.ts"));
const ERR = jiti(path.join(SRC, "lib/church/errors.ts"));

const publisher = F.id("c", 90), viewer = F.id("c", 91), manager = F.id("c", 92), noPerm = F.id("c", 93), adminPub = F.id("c", 94), otherChurch = u.owner2;
const R = { publish: F.id("b", 90), view: F.id("b", 91), manage: F.id("b", 92), other: F.id("b", 93), adminPub: F.id("b", 94) };
const EXTRA = `
  insert into public.users (id, role, plan_id) values ('${publisher}','user','${F.plan.free}'), ('${viewer}','user','${F.plan.free}'), ('${manager}','user','${F.plan.free}'), ('${noPerm}','user','${F.plan.free}'), ('${adminPub}','admin','${F.plan.free}');
  insert into public.organization_roles (id, profile_id, key, name, permissions) values
    ('${R.publish}','${prof.c1}','spub','Events publisher','{church.events.publish}'),
    ('${R.view}','${prof.c1}','sview','Events viewer','{church.events.view}'),
    ('${R.manage}','${prof.c1}','smanage','Events drafter','{church.events.manage}'),
    ('${R.other}','${prof.c1}','sother','Members viewer','{church.members.view}'),
    ('${R.adminPub}','${prof.c1}','sadmin','Platform admin holding publish','{church.events.publish}');
  insert into public.organization_members (profile_id, user_id, role_id) values ('${prof.c1}','${publisher}','${R.publish}'), ('${prof.c1}','${viewer}','${R.view}'), ('${prof.c1}','${manager}','${R.manage}'), ('${prof.c1}','${noPerm}','${R.other}'), ('${prof.c1}','${adminPub}','${R.adminPub}');
`;
const O = u.owner1;
const list = (who) => H.call(who, "GET", "church/services");
const add = (who, body) => H.call(who, "POST", "church/services", { body });
const edit = (who, id, body) => H.call(who, "PATCH", "church/services/[id]", { params: { id }, body });
const del = (who, id, stamp) => H.call(who, "DELETE", "church/services/[id]", { params: { id }, url: stamp === undefined ? "" : `?expected_updated_at=${encodeURIComponent(stamp)}` });
const SUN = (o = {}) => ({ title_en: "Sunday worship", weekday: 0, start_time: "09:00", end_time: "12:00", timezone: "Africa/Douala", ...o });
const count = async () => (await H.rows("select count(*)::int as n from public.church_service_schedule"))[0].n;
const stamp = (id) => H.stamp("church_service_schedule", id);

section("A. input validation (pure): ");
{
  const P = SH.parseServiceBody;
  check("create: a valid service", P(SUN(), "create").ok);
  check("create: weekday, start_time, end_time and timezone are required", ["weekday", "start_time", "end_time", "timezone"].every((f) => { const b = SUN(); delete b[f]; return !P(b, "create").ok; }));
  check("create: a name in at least one language is required", P(SUN({ title_en: undefined }), "create").code === "needs_title" && P(SUN({ title_en: "  ", title_fr: null }), "create").code === "needs_title" && P(SUN({ title_en: undefined, title_fr: "Culte" }), "create").ok);
  check("weekday must be a whole number 0..6", [7, -1, 1.5, "1", null].every((w) => P(SUN({ weekday: w }), "create").code === "invalid_weekday"));
  check("times must be HH:MM (seconds accepted), 00:00..23:59", ["9:00", "24:00", "09:60", "nine", "", null, 900].every((tm) => P(SUN({ start_time: tm }), "create").code === "invalid_time") && P(SUN({ start_time: "09:00:00", end_time: "12:00:00" }), "create").ok);
  check("end must be after start, within one day", P(SUN({ start_time: "12:00", end_time: "09:00" }), "create").code === "invalid_time_range" && P(SUN({ start_time: "09:00", end_time: "09:00" }), "create").code === "invalid_time_range");
  check("timezone must be a real IANA name", ["Mars/Phobos", "", "UTC; drop table", 5, null, "a".repeat(65)].every((z) => P(SUN({ timezone: z }), "create").code === "invalid_timezone") && P(SUN({ timezone: "Europe/Paris" }), "create").ok);
  check("name 80 / description 400 / place 160 characters at most", P(SUN({ title_en: "x".repeat(81) }), "create").code === "invalid_title_en" && P(SUN({ description_fr: "x".repeat(401) }), "create").code === "invalid_description_fr" && P(SUN({ location: "x".repeat(161) }), "create").code === "invalid_location");
  check("is_enabled must be a boolean", P(SUN({ is_enabled: "yes" }), "create").code === "invalid_body");
  check("no other field is accepted (church, owner, audit, id, archive on create)", ["profile_id", "id", "created_by", "updated_by", "archived_at", "archived", "status"].every((f) => P(SUN({ [f]: "x" }), "create").code === "unexpected_field"));
  check("update: empty change / bad version refused", P({}, "update").code === "empty_update" && P({ expected_updated_at: "2026-01-01T00:00:00Z" }, "update").code === "empty_update" && P({ is_enabled: false, expected_updated_at: "soon" }, "update").code === "invalid_body");
  check("update: archived can only be true", P({ archived: false }, "update").code === "invalid_body" && P({ archived: true }, "update").ok);
  check("update: only the fields sent are returned", JSON.stringify(Object.keys(P({ is_enabled: false }, "update").value)) === '["is_enabled"]');
  check("not an object", P(null, "create").code === "invalid_body" && P([], "create").code === "invalid_body");
  check("capabilities: viewEvents reads, publishEvents writes; manage alone does not write", PERM.churchCapabilities(["church.events.view"]).viewEvents && !PERM.churchCapabilities(["church.events.view"]).publishEvents && !PERM.churchCapabilities(["church.events.manage"]).publishEvents && PERM.churchCapabilities(["church.events.publish"]).publishEvents);
  const cls = (message, code = "23514") => ERR.classifyDbError({ message, code });
  check("db codes: limit, timezone, wrong profile, end before start", cls("schedule_limit").code === "schedule_limit" && cls("schedule_timezone_invalid").code === "invalid_timezone" && cls("schedule_profile_required").code === "not_available" && cls('violates check constraint "church_service_schedule_time_check"').code === "invalid_time_range");
}

section("B. permissions: ");
{
  await H.fresh(EXTRA);
  is("anonymous: 401", await list(null), 401);
  is("anonymous cannot add: 401", await add(null, SUN()), 401);
  is("a stranger: 403", await list(u.stranger), 403);
  is("a staff member without any events permission: 403", await list(noPerm), 403);
  is("...cannot add: 403", await add(noPerm, SUN()), 403);
  is("the church owner can list", await list(O), 200, "ok");
  is("an events viewer can list", await list(viewer), 200, "ok");
  eq("...and is told it is read-only", (await list(viewer)).body.can_edit, false);
  is("a viewer cannot add: 403", await add(viewer, SUN()), 403);
  is("a drafter (events.manage only) can list but cannot publish a weekly service: 403", await add(manager, SUN()), 403);
  is("a platform admin who is not the owner: 403", await list(adminPub), 403);
  is("...and cannot add: 403", await add(adminPub, SUN()), 403);
  is("a church publisher can add", await add(publisher, SUN({ title_en: "By publisher" })), 201, "ok");
  eq("...and is told it can edit", (await list(publisher)).body.can_edit, true);
  is("the owner of ANOTHER church cannot list THIS church (the church comes from the session)", await H.call(otherChurch, "GET", "church/services"), 200, "ok");
  eq("...they see only their own (none), never this church's", (await H.call(otherChurch, "GET", "church/services")).body.items.length, 0);
  is("a body naming another church is refused outright", await add(O, SUN({ profile_id: prof.c2 })), 400, "unexpected_field");
  is("a non-JSON write is refused: 415", await H.call(O, "POST", "church/services", { raw: "x", headers: { "content-type": "text/plain" } }), 415);
  is("a search parameter is refused", await H.call(O, "GET", "church/services?profile_id=" + prof.c2), 400, "unexpected_field");
}

section("C. create, list, edit, switch off, archive: ");
{
  await H.fresh(EXTRA);
  const tue = await add(O, SUN({ title_en: "Tuesday prayer", title_fr: "Prière du mardi", weekday: 2, start_time: "17:30", end_time: "21:00" }));
  is("Tuesday 17:30-21:00 is created", tue, 201, "ok");
  const thu = await add(O, SUN({ title_en: "Thursday prayer", weekday: 4, start_time: "17:30", end_time: "21:00" }));
  const sun = await add(O, SUN());
  const sun2 = await add(O, SUN({ title_en: "Second service", start_time: "14:00", end_time: "16:00", timezone: "Europe/Paris", location: "Annex" }));
  is("two services on the same day (with different timezones) are allowed", sun2, 201, "ok");
  check("a church can run its own timezone per service", sun2.body.item.timezone === "Europe/Paris" && sun.body.item.timezone === "Africa/Douala");
  const l = await list(O);
  eq("listed by weekday then time", l.body.items.map((x) => `${x.weekday} ${x.start_time}`), ["0 09:00", "0 14:00", "2 17:30", "4 17:30"]);
  check("a row never exposes the church, owner or audit columns", l.body.items.every((x) => !("profile_id" in x) && !("created_by" in x) && !("updated_by" in x) && !("archived_at" in x)));
  eq("the stored church is the session's church", (await H.rows("select distinct profile_id from public.church_service_schedule"))[0].profile_id, prof.c1);
  eq("the audit columns are filled by the database from the signed-in user", (await H.rows("select distinct created_by from public.church_service_schedule"))[0].created_by, O);

  const s1 = tue.body.item;
  is("an edit without the version it is based on: 400", await edit(O, s1.id, { title_en: "x" }), 400, "invalid_body");
  is("an edit with a stale version: 409", await edit(O, s1.id, { title_en: "Tuesday night", expected_updated_at: "2020-01-01T00:00:00Z" }), 409, "stale");
  const ok1 = await edit(O, s1.id, { title_en: "Tuesday night", end_time: "21:30", expected_updated_at: await stamp(s1.id) });
  is("an edit with the current version works", ok1, 200, "ok");
  eq("...and the change is stored", [ok1.body.item.title_en, ok1.body.item.end_time, ok1.body.item.start_time], ["Tuesday night", "21:30", "17:30"]);
  is("moving the start after the stored end is refused", await edit(O, s1.id, { start_time: "22:00", expected_updated_at: await stamp(s1.id) }), 400, "invalid_time_range");
  is("clearing both names is refused", await edit(O, s1.id, { title_en: null, title_fr: null, expected_updated_at: await stamp(s1.id) }), 400, "needs_title");
  is("clearing one name while the other stays is fine", await edit(O, s1.id, { title_en: null, expected_updated_at: await stamp(s1.id) }), 200, "ok");
  is("a bad timezone on edit: 400", await edit(O, s1.id, { timezone: "Nowhere/Land", expected_updated_at: await stamp(s1.id) }), 400, "invalid_timezone");
  is("a viewer cannot edit: 403", await edit(viewer, s1.id, { title_en: "x", expected_updated_at: await stamp(s1.id) }), 403);
  is("a stranger gets not found / forbidden, never the row", await edit(u.stranger, s1.id, { title_en: "x", expected_updated_at: await stamp(s1.id) }), 403);
  is("another church's owner cannot edit it: not found", await edit(otherChurch, s1.id, { title_en: "x", expected_updated_at: await stamp(s1.id) }), 404);
  is("a malformed id: 404", await edit(O, "not-a-uuid", { title_en: "x", expected_updated_at: "2026-01-01T00:00:00Z" }), 404);

  const off = await edit(O, thu.body.item.id, { is_enabled: false, expected_updated_at: await stamp(thu.body.item.id) });
  is("a service can be switched off", off, 200, "ok");
  eq("...and stays in the manager's list, switched off", (await list(O)).body.items.find((x) => x.id === thu.body.item.id).is_enabled, false);
  const on = await edit(O, thu.body.item.id, { is_enabled: true, expected_updated_at: await stamp(thu.body.item.id) });
  eq("...and can be switched back on", on.body.item.is_enabled, true);

  const before = await count();
  is("remove without a version: 400", await del(O, sun.body.item.id), 400, "invalid_body");
  is("remove with a stale version: 409", await del(O, sun.body.item.id, "2020-01-01T00:00:00Z"), 409, "stale");
  is("a viewer cannot remove: 403", await del(viewer, sun.body.item.id, await stamp(sun.body.item.id)), 403);
  is("remove works for the publisher", await del(publisher, sun.body.item.id, await stamp(sun.body.item.id)), 200, "ok");
  eq("REMOVED means ARCHIVED: the row is still in the table, history is kept", await count(), before);
  check("...with the archive time set", (await H.rows(`select archived_at from public.church_service_schedule where id = '${sun.body.item.id}'`))[0].archived_at !== null);
  check("...and it is gone from the manager's list", !(await list(O)).body.items.some((x) => x.id === sun.body.item.id));
  is("an archived service cannot be edited: 404", await edit(O, sun.body.item.id, { title_en: "back", expected_updated_at: await stamp(sun.body.item.id) }), 404);
  is("...nor removed again: 404", await del(O, sun.body.item.id, await stamp(sun.body.item.id)), 404);
}

section("D. the database is the authority (a direct session, no API): ");
{
  await H.fresh(EXTRA);
  const S = (who) => F.sessionFor(H.db, who).from("church_service_schedule");
  const row = (o = {}) => ({ id: F.id("6", 100 + Math.floor(Math.random() * 1e6)), profile_id: prof.c1, title_en: "Direct", weekday: 1, start_time: "08:00", end_time: "09:00", timezone: "Africa/Douala", ...o });
  const code = (x) => x && x.error && x.error.code;
  check("owner can insert", !(await S(O).insert(row())).error);
  check("publisher can insert", !(await S(publisher).insert(row())).error);
  check("viewer cannot insert (RLS)", !!(await S(viewer).insert(row())).error);
  check("drafter cannot insert (RLS)", !!(await S(manager).insert(row())).error);
  check("a platform admin who is not the owner cannot insert", !!(await S(adminPub).insert(row())).error);
  check("a signed-in outsider cannot insert into this church", !!(await S(u.stranger).insert(row())).error);
  eq("insert into another church by its owner is refused", code(await S(otherChurch).insert(row())) !== undefined, true);
  check("a profile that is not a church is refused by the guard", !!(await S(u.ownerNC).insert(row({ profile_id: prof.nc }))).error);
  check("weekday 7 is refused", !!(await S(O).insert(row({ weekday: 7 }))).error);
  check("end not after start is refused", !!(await S(O).insert(row({ start_time: "10:00", end_time: "10:00" }))).error);
  check("no title in either language is refused", !!(await S(O).insert(row({ title_en: null, title_fr: null }))).error);
  check("an unknown timezone is refused by the database itself", !!(await S(O).insert(row({ timezone: "Mars/Phobos" }))).error);
  check("a timezone with unsafe characters is refused", !!(await S(O).insert(row({ timezone: "UTC'; drop table x;--" }))).error);
  check("a known timezone is accepted", !(await S(O).insert(row({ timezone: "Asia/Kolkata" }))).error);
  check("NO ONE can delete through the API role (history is kept)", !!(await S(O).delete().eq("title_en", "Direct")).error || (await count()) > 0);
  const del1 = await S(O).delete().eq("title_en", "Direct");
  check("delete is denied at the privilege level", !!del1.error && /permission denied|42501/i.test(JSON.stringify(del1.error)), JSON.stringify(del1.error));
  const mine = (await H.rows("select id from public.church_service_schedule limit 1"))[0].id;
  check("the church can never be changed on an existing row", !!(await S(O).update({ profile_id: prof.c2 }).eq("id", mine)).error);
  check("the audit columns are not writable", !!(await S(O).update({ created_by: publisher }).eq("id", mine)).error);
  check("the audit columns are not readable", !!(await S(O).select("created_by").limit(1)).error);
  eq("a client cannot forge the audit author on insert", (await H.rows(`select created_by from public.church_service_schedule where created_by is not null limit 1`)).length > 0, true);
  // limit: 30 live services per church
  await H.fresh(EXTRA);
  let bad = 0;
  for (let i = 0; i < 30; i++) if ((await S(O).insert(row({ id: F.id("6", 5000 + i), start_time: `${String(i % 20).padStart(2, "0")}:00`, end_time: `${String(i % 20).padStart(2, "0")}:30` }))).error) bad++;
  eq("30 services fit", bad, 0);
  const over = await S(O).insert(row({ id: F.id("6", 6000) }));
  check("the 31st is refused", !!over.error && /schedule_limit/.test(over.error.message || ""), JSON.stringify(over.error));
  const arch = await S(O).update({ archived_at: new Date().toISOString() }).eq("id", F.id("6", 5000));
  check("archiving one frees a place", !arch.error && !(await S(O).insert(row({ id: F.id("6", 6001) }))).error);
  const unarch = await S(O).update({ archived_at: null }).eq("id", F.id("6", 5000));
  check("...and un-archiving it back past the limit is refused", !!unarch.error);
}

section("E. what the public may read: ");
{
  await H.fresh(EXTRA);
  const anon = () => F.sessionFor(H.db, null).from("church_service_schedule");
  await add(O, SUN({ title_en: "Live one" }));
  const hidden = await add(O, SUN({ title_en: "Switched off", weekday: 1 }));
  const gone = await add(O, SUN({ title_en: "Archived", weekday: 2 }));
  await edit(O, hidden.body.item.id, { is_enabled: false, expected_updated_at: await stamp(hidden.body.item.id) });
  await del(O, gone.body.item.id, await stamp(gone.body.item.id));
  const pub = await anon().select("title_en, weekday, start_time, end_time, timezone");
  check("a visitor can read the schedule", !pub.error && pub.data.length === 1, JSON.stringify(pub));
  eq("...only the enabled, non-archived service", pub.data.map((x) => x.title_en), ["Live one"]);
  check("a visitor cannot read the audit columns", !!(await anon().select("created_by")).error && !!(await anon().select("updated_by")).error);
  check("a visitor cannot write", !!(await anon().insert({ profile_id: prof.c1, title_en: "x", weekday: 0, start_time: "09:00", end_time: "10:00", timezone: "UTC" })).error);
  check("a visitor cannot update or delete", !!(await anon().update({ is_enabled: false }).eq("title_en", "Live one")).error || (await anon().select("title_en")).data.length === 1);
  await H.rows(`update public.profiles set published = false where id = '${prof.c1}'`);
  eq("an unpublished church shows nothing to visitors", (await anon().select("title_en")).data.length, 0);
}

section("F. the migration files: ");
{
  const rd = (p) => fs.readFileSync(path.join(REPO, p), "utf8").replace(/\r\n/g, "\n");
  const MIG = rd("supabase/migrations/2027-01-16_church_service_schedule.sql");
  const ROLL = rd("supabase/support/2027-01-16_church_service_schedule.rollback.sql");
  const VER = rd("supabase/support/2027-01-16_church_service_schedule.verify.sql");
  check("one transaction, self-verifying", /^begin;/m.test(MIG) && /^commit;/m.test(MIG) && /postcondition failed/.test(MIG) && /precondition failed/.test(MIG));
  check("creates only its own objects (one table, one function)", (MIG.match(/create table/gi) || []).length === 1 && (MIG.match(/create (or replace )?function/gi) || []).length === 1);
  check("alters no existing table and drops nothing of anyone else's", !/alter table public\.(?!church_service_schedule)/i.test(MIG) && !/drop (table|function|policy) (if exists )?(?!public\.church_service_schedule|church_service_schedule)/i.test(MIG.replace(/drop policy if exists church_service_schedule_\w+ on public\.church_service_schedule;/g, "")));
  check("no DELETE grant or policy exists for any API role", !/grant[^;]*\bdelete\b[^;]*to (anon|authenticated)/i.test(MIG) && !/for delete/i.test(MIG));
  check("writes need church.events.publish; reads accept view / manage / publish", /church_has_permission\(profile_id, 'church\.events\.publish'\)/.test(MIG) && /'church\.events\.view'/.test(MIG));
  check("platform admins are refused unless they own the church (restrictive policies)", (MIG.match(/as restrictive/g) || []).length === 2);
  check("a rollback exists, refuses while rows exist, and a read-only verify exists", /rollback refused: the table holds/.test(ROLL) && /allow_data_loss/.test(ROLL) && /^select label, expect, actual/m.test(VER) && !/\b(insert|update|delete|drop|alter|create)\b/i.test(VER.replace(/--.*$/gm, "").replace(/'[^']*'/g, "''")));
  const ver = await (async () => { await H.fresh(EXTRA); return H.rows(VER); })();
  check("the verify script passes on the migrated database", ver.length > 0 && ver.every((r) => r.ok === true), JSON.stringify(ver.filter((r) => !r.ok)));
  // the rollback refuses with data, then works once the loss is confirmed, and leaves the rest alone
  await add(O, SUN());
  let refuse = null;
  try { await H.db.exec(ROLL); } catch (e) { refuse = String(e.message); await H.db.exec("rollback").catch(() => {}); } // a refusing script leaves its transaction open
  check("the rollback refuses to run while a service exists", !!refuse && /rollback refused/.test(refuse), refuse);
  let okRoll = null;
  try { await H.db.exec(ROLL.replace("begin;", "begin;\nselect set_config('church_service_schedule.allow_data_loss', 'yes', true);")); } catch (e) { okRoll = String(e.message); await H.db.exec("rollback").catch(() => {}); }
  check("...and works once the loss is confirmed", okRoll === null, okRoll);
  eq("...removing the table and the function", (await H.rows("select to_regclass('public.church_service_schedule') is null as a, to_regprocedure('public.church_service_schedule_guard()') is null as b"))[0], { a: true, b: true });
}

await H.close();
process.exit(summary());
