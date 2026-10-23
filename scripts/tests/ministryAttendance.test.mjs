// Churches & Ministries Phase 7: the ministry_attendance / ministry_attendance_counts migration, attacked OFFLINE.
// Loads the REAL Team migrations, the real permission-ceiling and Inbox guards, the REAL Phase 2A church migration, the Phase 3 and Phase 4 migrations and then the new
// 2026-12-31_ministry_attendance.sql into scratch in-memory PostgreSQL (PGlite), and attacks it the way a visitor or a signed-in user could: direct table access under the `anon` /
// `authenticated` roles with RLS on and auth.uid() = that user. It also runs the preflight, verify and rollback scripts against it. All data is synthetic. No Supabase, no network, no production
// data, no SQL against any real database.
//   Run:  node scripts/tests/ministryAttendance.test.mjs
import fs from "fs";
import path from "path";
import * as F from "./churchFixtures.mjs";

const { PGlite } = await import(process.env.PGLITE_ENTRY || "@electric-sql/pglite");
const { u, prof, m, REPO } = F;
let pass = 0, fail = 0, section = "";
const check = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log("  FAIL:", `${section}${name}`, "|", String(detail).slice(0, 400)); } };
const eq = (name, a, b) => check(name, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8").replace(/\r\n/g, "\n");
const MIG = F.AT_MIG;
const SUP = "supabase/support/2026-12-31_ministry_attendance";
const PRE = read(`${SUP}.preflight.sql`), VER = read(`${SUP}.verify.sql`), ROLL = read(`${SUP}.rollback.sql`);

const U2 = (n) => F.id("c", 60 + n);
const av = U2(1), am = U2(2), adminMgr = U2(3), evOnly = U2(4);
const R2 = (n) => F.id("b", 60 + n);
const r = { view: R2(1), manage: R2(2), adminMgr: R2(3), events: R2(4) };
const E = (k) => F.id("8", 200 + k);

async function fresh({ withAt = true, extras = true, withEvents = true } = {}) {
  const db = await F.newDb(PGlite, { dailyWords: true, events: withEvents, attendance: withAt && withEvents });
  await F.seed(db);
  if (extras && withEvents) await F.svc(db, `
    insert into public.users (id, role, plan_id) values ('${av}','user','${F.plan.free}'), ('${am}','user','${F.plan.free}'), ('${adminMgr}','admin','${F.plan.free}'), ('${evOnly}','user','${F.plan.free}');
    insert into public.organization_roles (id, profile_id, key, name, permissions) values
      ('${r.view}','${prof.c1}','aview','Attendance viewer','{church.attendance.view}'),
      ('${r.manage}','${prof.c1}','amanage','Attendance recorder','{church.attendance.manage}'),
      ('${r.adminMgr}','${prof.c1}','aadmin','Platform admin holding manage','{church.attendance.manage,church.attendance.view}'),
      ('${r.events}','${prof.c1}','aevents','Events publisher only','{church.events.publish}');
    insert into public.organization_members (profile_id, user_id, role_id) values ('${prof.c1}','${av}','${r.view}'), ('${prof.c1}','${am}','${r.manage}'), ('${prof.c1}','${adminMgr}','${r.adminMgr}'), ('${prof.c1}','${evOnly}','${r.events}');
  `);
  if (extras && withEvents) await F.svc(db, `
    insert into public.ministry_events (id, profile_id, status, event_date, title_en, is_cancelled) values
      ('${E(1)}','${prof.c1}','published', public.ministry_today(), 'Today service', false),
      ('${E(2)}','${prof.c1}','published', public.ministry_today() - 7, 'Last week service', false),
      ('${E(3)}','${prof.c1}','published', public.ministry_today() + 3, 'Future service', false),
      ('${E(4)}','${prof.c1}','draft', public.ministry_today() - 1, 'Draft event', false),
      ('${E(5)}','${prof.c1}','published', public.ministry_today() - 1, 'Cancelled event', true),
      ('${E(6)}','${prof.c2}','published', public.ministry_today(), 'Other church service', false);
  `);
  return db;
}
const rows = (db, sql) => F.svcQuery(db, sql);
const S = (db, who) => F.sessionFor(db, who);
const Att = (db, who) => S(db, who).from("ministry_attendance");
const Cnt = (db, who) => S(db, who).from("ministry_attendance_counts");
let n = 100;
const id = () => F.id("7", ++n);
const rec = (o = {}) => ({ id: id(), profile_id: prof.c1, event_id: E(1), member_id: m.admin, ...o });

// =================================================================================================================================================================
section = "A. structure and grants: ";
// =================================================================================================================================================================
{
  const db = await fresh();
  for (const t of ["ministry_attendance", "ministry_attendance_counts"]) {
    for (const k of ["select", "insert", "update", "delete", "truncate", "references", "trigger"]) {
      check(`${t}: anon has no table-level ${k}`, (await rows(db, `select has_table_privilege('anon','public.${t}','${k}') as b`))[0].b === false);
      check(`${t}: PUBLIC has no ${k}`, (await rows(db, `select has_table_privilege('public','public.${t}','${k}') as b`))[0].b === false);
    }
    for (const k of ["select", "insert", "update"]) check(`${t}: anon has no column-level ${k}`, (await rows(db, `select has_any_column_privilege('anon','public.${t}','${k}') as b`))[0].b === false);
    for (const k of ["select", "insert", "update"]) check(`${t}: authenticated cannot ${k} recorded_by`, (await rows(db, `select has_column_privilege('authenticated','public.${t}','recorded_by','${k}') as b`))[0].b === false);
    for (const k of ["truncate", "references", "trigger"]) check(`${t}: authenticated cannot ${k}`, (await rows(db, `select has_table_privilege('authenticated','public.${t}','${k}') as b`))[0].b === false);
    for (const c of ["profile_id", "event_id"]) check(`${t}: authenticated cannot update ${c}`, (await rows(db, `select has_column_privilege('authenticated','public.${t}','${c}','update') as b`))[0].b === false);
    check(`${t}: row-level security is on, and no policy applies to PUBLIC`, (await rows(db, `select relrowsecurity as b from pg_class where oid = 'public.${t}'::regclass`))[0].b === true && (await rows(db, `select count(*)::int as n from pg_policy where polrelid = 'public.${t}'::regclass and polroles = array[0::oid]`))[0].n === 0);
  }
  check("attendance rows have no update privilege for authenticated at all", (await rows(db, `select has_any_column_privilege('authenticated','public.ministry_attendance','update') as b`))[0].b === false);
  const star = await Att(db, null).select("id");
  check("anon cannot read attendance (privilege error, not an empty list)", star.error && star.error.code === "42501", JSON.stringify(star.error));
  const star2 = await Cnt(db, null).select("visitors");
  check("anon cannot read the counts either", star2.error && star2.error.code === "42501");
  const sel = await Att(db, u.owner1).select("recorded_by");
  check("even the owner cannot read recorded_by through the API", sel.error && sel.error.code === "42501");
  await db.close();
}

// =================================================================================================================================================================
section = "B. recording attendance: ";
// =================================================================================================================================================================
{
  const db = await fresh();
  let res = await Att(db, u.owner1).insert(rec());
  check("owner: records an active adult at a published event of today", !res.error, JSON.stringify(res.error));
  const row = (await rows(db, `select recorded_by::text as b from public.ministry_attendance where member_id = '${m.admin}'`))[0];
  check("the recorder is stamped from auth.uid()", row.b === u.owner1, JSON.stringify(row));
  res = await Att(db, u.owner1).insert(rec({ member_id: m.admin }));
  check("a person is recorded at most once per event (unique key)", !!res.error && res.error.code === "23505" && /ministry_attendance_event_member_key/.test(res.error.message), JSON.stringify(res.error));
  res = await Att(db, u.owner1).insert(rec({ member_id: m.admin, event_id: E(2) }));
  check("...but may be recorded at another event", !res.error, JSON.stringify(res.error));
  res = await Att(db, u.owner1).insert(rec({ member_id: m.youth }));
  check("a youth is a roster person and may be recorded", !res.error, JSON.stringify(res.error));
  const bad = async (name, o, re, who = u.owner1) => { const x = await Att(db, who).insert(rec(o)); check(name, !!x.error && re.test(x.error.message + " " + (x.error.code || "")), JSON.stringify(x.error)); };
  await bad("a CHILD can never be recorded (children are counted, never named)", { member_id: m.kid1 }, /attendance_child_not_allowed/);
  await bad("a person whose roster status is pending cannot be recorded", { member_id: m.pending }, /attendance_member_not_active/);
  await F.svc(db, `update public.church_members set status = 'inactive' where id = '${m.vol}'`);
  await bad("an inactive person cannot be recorded", { member_id: m.vol }, /attendance_member_not_active/);
  await bad("an event that is a draft cannot have attendance", { event_id: E(4), member_id: m.leader }, /attendance_event_not_published/);
  await bad("a cancelled event cannot have attendance", { event_id: E(5), member_id: m.leader }, /attendance_event_cancelled/);
  await bad("an event that has not started cannot have attendance", { event_id: E(3), member_id: m.leader }, /attendance_event_not_started/);
  await bad("another church's event is not reachable (composite foreign key / guard)", { event_id: E(6), member_id: m.leader }, /attendance_event_missing|23503/);
  await bad("another church's person is not reachable", { member_id: m.c2a }, /attendance_member_missing|23503/);
  await bad("an unknown event is refused", { event_id: F.id("8", 999) }, /attendance_event_missing|23503/);
  await bad("an unknown person is refused", { member_id: F.id("e", 998) }, /attendance_member_missing|23503/);
  // never editable
  res = await Att(db, u.owner1).update({ member_id: m.leader }).eq("member_id", m.admin).select("id");
  check("an attendance row cannot be edited through the API (no update privilege)", !!res.error && res.error.code === "42501", JSON.stringify(res));
  const upd = await F.svcErr(db, `update public.ministry_attendance set event_id = event_id where member_id = '${m.admin}'`);
  check("...nor by the service role (the guard refuses every update)", !!upd && /attendance_immutable/.test(upd.msg), JSON.stringify(upd));
  // forged columns
  res = await Att(db, u.owner1).insert(rec({ member_id: m.leader, recorded_by: u.stranger }));
  check("a client-supplied recorded_by is refused (no column grant)", !!res.error && res.error.code === "42501");
  res = await Att(db, u.owner1).insert(rec({ member_id: m.leader, profile_id: prof.c2 }));
  check("a church other than the person's and the event's is refused", !!res.error);
  eq("only the three valid rows exist", (await rows(db, "select count(*)::int as n from public.ministry_attendance"))[0].n, 3);
  await db.close();
}

// =================================================================================================================================================================
section = "C. who may read and write: ";
// =================================================================================================================================================================
{
  const db = await fresh();
  await F.svc(db, `insert into public.ministry_attendance (id, profile_id, event_id, member_id) values ('${F.id("7", 1)}','${prof.c1}','${E(1)}','${m.admin}'), ('${F.id("7", 2)}','${prof.c1}','${E(1)}','${m.leader}');
    insert into public.ministry_attendance_counts (event_id, profile_id, visitors, children) values ('${E(1)}','${prof.c1}',4,2)`);
  const count = async (who, t = "ministry_attendance") => { const x = await S(db, who).from(t).select("id, event_id").eq("profile_id", prof.c1); return x.error ? -1 : (x.data || []).length; };
  eq("owner reads the attendance", await count(u.owner1), 2);
  eq("attendance viewer reads it", await count(av), 2);
  eq("attendance recorder reads it", await count(am), 2);
  for (const [who, tag] of [[u.plain1, "staff without the permission"], [u.mgr1, "a church administrator without the permission"], [u.viewer1, "a People viewer"], [evOnly, "an events publisher"], [u.stranger, "a stranger"], [u.owner2, "another church's owner"], [u.admin, "a platform admin with no relationship"], [adminMgr, "a platform admin who is a team member holding manage"], [u.leader1, "a group leader (roster record only)"]]) {
    eq(`${tag}: reads nothing`, await count(who), 0);
  }
  const cnts = async (who) => { const x = await Cnt(db, who).select("visitors, children"); return x.error ? -1 : (x.data || []).length; };
  eq("counts: owner / viewer / recorder read them", [await cnts(u.owner1), await cnts(av), await cnts(am)], [1, 1, 1]);
  eq("counts: nobody else does", [await cnts(u.plain1), await cnts(u.stranger), await cnts(u.owner2), await cnts(u.admin), await cnts(adminMgr)], [0, 0, 0, 0, 0]);
  // writes
  let res = await Att(db, av).insert(rec({ member_id: m.vol }));
  check("view only: cannot record", !!res.error);
  res = await Att(db, av).delete().eq("member_id", m.admin).select("id");
  check("view only: cannot remove", !res.error && res.data.length === 0);
  res = await Att(db, am).insert(rec({ member_id: m.other }));
  check("recorder: records", !res.error, JSON.stringify(res.error));
  res = await Att(db, am).delete().eq("member_id", m.other).select("id");
  check("recorder: removes (undo a mistake)", !res.error && res.data.length === 1);
  for (const [who, tag] of [[u.plain1, "staff without the permission"], [u.stranger, "a stranger"], [u.owner2, "another church's owner"], [evOnly, "an events publisher"], [u.mgr1, "a church administrator"]]) {
    res = await Att(db, who).insert(rec({ member_id: m.guardian }));
    check(`${tag}: cannot record`, !!res.error);
    res = await Att(db, who).delete().eq("member_id", m.admin).select("id");
    check(`${tag}: cannot remove`, !res.error && res.data.length === 0);
  }
  res = await Att(db, null).insert(rec({ member_id: m.guardian }));
  check("anon cannot record", !!res.error && res.error.code === "42501");
  res = await Att(db, null).delete().eq("member_id", m.admin).select("id");
  check("anon cannot remove", !!res.error && res.error.code === "42501");
  res = await Att(db, adminMgr).insert(rec({ member_id: m.guardian }));
  check("a platform admin holding manage as a team member cannot record (restrictive policy, and never an admin)", !!res.error, JSON.stringify(res.error));
  res = await Att(db, u.adminOwner).insert({ id: id(), profile_id: prof.c3, event_id: E(1), member_id: m.admin });
  check("a platform admin who owns another church still cannot reach this church's event", !!res.error);
  // counts writes
  res = await Cnt(db, am).update({ visitors: 9 }).eq("event_id", E(1)).select("event_id");
  check("recorder: updates the counts", !res.error && res.data.length === 1);
  res = await Cnt(db, av).update({ visitors: 1 }).eq("event_id", E(1)).select("event_id");
  check("view only: cannot update the counts", !res.error && res.data.length === 0);
  res = await Cnt(db, am).update({ profile_id: prof.c2 }).eq("event_id", E(1)).select("event_id");
  check("the church of a count cannot be changed (no privilege)", !!res.error && res.error.code === "42501");
  res = await Cnt(db, am).update({ event_id: E(2) }).eq("event_id", E(1)).select("event_id");
  check("the event of a count cannot be changed (no privilege)", !!res.error && res.error.code === "42501");
  res = await Cnt(db, am).insert({ event_id: E(2), profile_id: prof.c1, visitors: 5, children: 1 });
  check("recorder: inserts the counts of another past event", !res.error, JSON.stringify(res.error));
  for (const bad of [{ visitors: -1 }, { children: -1 }, { visitors: 100001 }, { children: 100001 }]) {
    res = await Cnt(db, am).update(bad).eq("event_id", E(1)).select("event_id");
    check(`counts out of range are refused: ${JSON.stringify(bad)}`, !!res.error && res.error.code === "23514", JSON.stringify(res.error));
  }
  for (const [ev, tag] of [[E(3), "a future event"], [E(4), "a draft event"], [E(5), "a cancelled event"]]) {
    res = await Cnt(db, am).insert({ event_id: ev, profile_id: prof.c1, visitors: 1, children: 0 });
    check(`counts for ${tag} are refused`, !!res.error, JSON.stringify(res.error));
  }
  res = await Cnt(db, am).insert({ event_id: E(6), profile_id: prof.c1, visitors: 1, children: 0 });
  check("counts for another church's event are refused", !!res.error);
  res = await Cnt(db, am).insert({ event_id: E(1), profile_id: prof.c1, visitors: 1, children: 0 });
  check("one count row per event (primary key)", !!res.error && res.error.code === "23505");
  const upd = (await rows(db, `select updated_at::text as u, recorded_by::text as b from public.ministry_attendance_counts where event_id = '${E(1)}'`))[0];
  check("the counts are stamped with the recorder", upd.b === am, JSON.stringify(upd));
  await db.close();
}

// =================================================================================================================================================================
section = "D. events, people and the whole church: ";
// =================================================================================================================================================================
{
  const db = await fresh();
  await F.svc(db, `insert into public.ministry_attendance (profile_id, event_id, member_id) values ('${prof.c1}','${E(1)}','${m.pending}'), ('${prof.c1}','${E(1)}','${m.admin}')`).catch(() => {});
  // the pending person cannot be inserted by the guard; seed the rest
  await F.svc(db, `insert into public.ministry_attendance (profile_id, event_id, member_id) values ('${prof.c1}','${E(1)}','${m.admin}') on conflict do nothing; insert into public.ministry_attendance_counts (event_id, profile_id, visitors) values ('${E(1)}','${prof.c1}',3) on conflict do nothing`);
  let res = await S(db, u.owner1).from("ministry_events").delete().eq("id", E(1)).select("id");
  check("an event that has attendance cannot be deleted (the owner is refused)", !!res.error && res.error.code === "23503" && /ministry_attendance_event_fk|ministry_attendance_counts_event_fk/.test(res.error.message), JSON.stringify(res.error));
  check("...and it is still there", (await rows(db, `select count(*)::int as n from public.ministry_events where id = '${E(1)}'`))[0].n === 1);
  res = await S(db, u.owner1).from("ministry_events").update({ status: "draft" }).eq("id", E(1)).select("id");
  check("it can be unpublished instead (the attendance stays)", !res.error && res.data.length === 1);
  check("...with its attendance intact", (await rows(db, "select count(*)::int as n from public.ministry_attendance"))[0].n === 1);
  res = await S(db, u.owner1).from("ministry_events").update({ is_cancelled: true }).eq("id", E(1)).select("id");
  check("it can be edited after attendance was recorded", !res.error && res.data.length === 1);
  await F.svc(db, "delete from public.ministry_attendance_counts; delete from public.ministry_attendance");
  res = await S(db, u.owner1).from("ministry_events").delete().eq("id", E(1)).select("id");
  check("once the attendance and counts are removed the event can be deleted", !res.error && res.data.length === 1, JSON.stringify(res.error));
  // erasing a person erases their attendance
  await F.svc(db, `insert into public.ministry_attendance (profile_id, event_id, member_id) values ('${prof.c1}','${E(2)}','${m.leader}'), ('${prof.c1}','${E(2)}','${m.vol}')`);
  const del = await F.svcErr(db, `delete from public.church_members where id = '${m.vol}'`);
  check("deleting a roster person is not blocked by their attendance", del === null || !/ministry_attendance/.test(del.msg), JSON.stringify(del));
  if (del === null) eq("...and erases their attendance with them", (await rows(db, `select count(*)::int as n from public.ministry_attendance where member_id = '${m.vol}'`))[0].n, 0);
  // deleting the whole church works even with attendance and counts present
  await F.svc(db, `insert into public.ministry_attendance_counts (event_id, profile_id, visitors) values ('${E(2)}','${prof.c1}',1) on conflict do nothing`);
  const whole = await F.svcErr(db, `delete from public.profiles where id = '${prof.c1}'`);
  check("deleting the whole church profile still works (cascades, NO ACTION is checked afterwards)", whole === null, JSON.stringify(whole));
  eq("...and leaves no attendance behind", [(await rows(db, "select count(*)::int as n from public.ministry_attendance"))[0].n, (await rows(db, "select count(*)::int as n from public.ministry_attendance_counts"))[0].n], [0, 0]);
  await db.close();
}

// =================================================================================================================================================================
section = "E. the Team grant guard covers the new permissions without any Phase 2A change: ";
// =================================================================================================================================================================
{
  const db = await fresh();
  const mk = (who, perms, k) => S(db, who).from("organization_roles").insert({ id: F.id("2", 700 + k), profile_id: prof.c1, key: `at${k}`, name: `AT${k}`, permissions: `{${perms.join(",")}}` });
  let res = await mk(u.owner1, ["church.attendance.manage", "church.attendance.view"], 1);
  check("the owner can create a role holding the attendance permissions", !res.error, JSON.stringify(res.error));
  let k = 10;
  for (const p of ["church.attendance.view", "church.attendance.manage"]) {
    res = await mk(u.mgr1, [p], ++k);
    check(`a church administrator (staff.manage) cannot create a role with ${p}`, !!res.error, JSON.stringify(res.error));
  }
  res = await mk(u.admin, ["church.attendance.view"], 40);
  check("a platform admin cannot grant them", !!res.error, JSON.stringify(res.error));
  await db.close();
}

// =================================================================================================================================================================
section = "F. support scripts and re-runs: ";
// =================================================================================================================================================================
{
  const pre = await fresh({ withAt: false, extras: false });
  const p1 = (await pre.query(PRE)).rows;
  check("preflight: ten rows, all ok on a database with Phase 2A and Phase 4 and nothing of Phase 7", p1.length === 10 && p1.every((x) => x.ok === true), JSON.stringify(p1.filter((x) => x.ok !== true)));
  await pre.exec(MIG);
  const p2 = (await pre.query(PRE)).rows;
  check("preflight after applying: the 'does not exist yet' rows now fail (it is a BEFORE check)", p2.filter((x) => x.ok !== true).length >= 2);
  const v = (await pre.query(VER)).rows;
  check("verify: sixteen rows, all ok", v.length === 16 && v.every((x) => x.ok === true), JSON.stringify(v.filter((x) => x.ok !== true)));
  await F.svc(pre, `insert into public.ministry_events (id, profile_id, status, event_date, title_en) values ('${E(1)}','${prof.c1}','published', public.ministry_today(), 'X');
    insert into public.ministry_attendance (profile_id, event_id, member_id) values ('${prof.c1}','${E(1)}','${m.admin}')`);
  await pre.exec(MIG);
  eq("re-running the migration keeps the data", (await rows(pre, "select count(*)::int as n from public.ministry_attendance"))[0].n, 1);
  check("verify still passes after a re-run", (await pre.query(VER)).rows.every((x) => x.ok === true));
  let err = null; try { await pre.exec(ROLL); } catch (e) { err = String(e.message); await pre.exec("rollback").catch(() => {}); }
  check("rollback refuses while a row exists", !!err && /rollback refused/.test(err), err);
  eq("...and nothing was dropped", (await rows(pre, "select count(*)::int as n from public.ministry_attendance"))[0].n, 1);
  const sig = async (d) => JSON.stringify(await rows(d, "select proname, md5(pg_get_functiondef(oid)) as d from pg_proc where pronamespace = 'public'::regnamespace and (proname like 'church\\_%' or proname like 'team\\_church\\_%' or proname like 'daily\\_word%' or proname like 'ministry\\_today' or proname like 'ministry\\_content\\_guard') order by 1"));
  const sigBefore = await sig(pre);
  const eventsBefore = (await rows(pre, "select count(*)::int as n from public.ministry_events"))[0].n;
  await pre.exec(ROLL.replace("begin;", "begin;\nselect set_config('ministry_attendance.allow_data_loss', 'yes', true);"));
  check("rollback with explicit confirmation drops both tables and both functions", (await rows(pre, "select to_regclass('public.ministry_attendance') is null and to_regclass('public.ministry_attendance_counts') is null and (select count(*) from pg_proc where proname like 'ministry\\_attendance%') = 0 as a"))[0].a === true);
  check("rollback left every Phase 2A / 3 / 4 function byte-for-byte unchanged", sigBefore === (await sig(pre)));
  eq("rollback left the events and the roster alone", [(await rows(pre, "select count(*)::int as n from public.ministry_events"))[0].n, (await rows(pre, "select count(*)::int as n from public.church_members"))[0].n], [eventsBefore, 10]);
  await pre.exec(ROLL);
  check("rollback is safe to run again", true);
  await pre.exec(MIG);
  check("the migration can be applied again after a rollback", (await rows(pre, "select to_regclass('public.ministry_attendance') is not null as a"))[0].a === true);
  await pre.close();

  // Phase 4 rollback refuses while attendance references it
  const p4 = await fresh();
  const R4 = read("supabase/support/2026-12-29_ministry_events_announcements.rollback.sql");
  let e0 = null; try { await p4.exec(R4); } catch (e) { e0 = String(e.message); await p4.exec("rollback").catch(() => {}); }
  check("the Phase 4 rollback refuses while the attendance tables reference its events", !!e0 && /rollback refused/.test(e0), e0);
  await p4.close();

  const noEvents = await fresh({ extras: false, withEvents: false });
  let e3 = null; try { await noEvents.exec(MIG); } catch (e) { e3 = String(e.message); await noEvents.exec("rollback").catch(() => {}); }
  check("the migration refuses to run without Phase 4", !!e3 && /Phase 4|missing tables/.test(e3), e3);
  const pf = (await noEvents.query(PRE)).rows;
  check("...and the preflight says so", pf.some((x) => x.ok !== true));
  await noEvents.close();

  const foreign = await fresh({ withAt: false, extras: false });
  await foreign.exec("create table public.ministry_attendance (id int)");
  let e1 = null; try { await foreign.exec(MIG); } catch (e) { e1 = String(e.message); await foreign.exec("rollback").catch(() => {}); }
  check("the migration refuses to adopt an unmanaged table of the same name", !!e1 && /half-applied|not managed by this migration/.test(e1), e1);
  await foreign.close();
  const foreignFn = await fresh({ withAt: false, extras: false });
  await foreignFn.exec("create function public.ministry_attendance_guard() returns trigger language plpgsql as $$ begin return new; end $$");
  let e2 = null; try { await foreignFn.exec(MIG); } catch (e) { e2 = String(e.message); await foreignFn.exec("rollback").catch(() => {}); }
  check("...and an unmanaged function of the same name", !!e2 && /already exists/.test(e2), e2);
  await foreignFn.close();

  const a = await fresh({ withAt: false, extras: false }); const b = await fresh({ extras: false });
  const fp = async (d) => JSON.stringify(await rows(d, `select (select jsonb_agg(proname || ':' || md5(pg_get_functiondef(oid)) order by proname) from pg_proc where pronamespace = 'public'::regnamespace and (proname like 'church\\_%' or proname like 'team\\_church\\_%' or proname like 'daily\\_word%' or proname in ('ministry_today','ministry_content_guard','is_admin','has_org_permission','is_org_member'))) as f, (select jsonb_agg(polrelid::regclass::text || ':' || polname order by polrelid::regclass::text, polname) from pg_policy where polrelid::regclass::text in ('profiles','organization_roles','organization_members','church_members','church_groups','church_group_members','church_leadership','daily_words','ministry_events','ministry_announcements')) as p`));
  check("applying the migration changes no Phase 2A / 3 / 4 / Team function and no other table's policy", (await fp(a)) === (await fp(b)));
  await a.close(); await b.close();
}

// =================================================================================================================================================================
section = "G. the migration text itself: ";
// =================================================================================================================================================================
{
  const code = MIG.replace(/--[^\n]*/g, "");
  const created = [...code.matchAll(/create (?:or replace )?(?:unique )?(table|function|trigger|index|policy)\s+(?:if not exists\s+)?(?:public\.)?([a-z_]+)/gi)].map((mm) => mm[2]);
  check("it creates only ministry_attendance* objects", created.length > 0 && created.every((x) => /^ministry_attendance/.test(x)), created.filter((x) => !/^ministry_attendance/.test(x)).join());
  check("it never alters or drops an existing object", !/alter table public\.(?!ministry_attendance)|drop (table|function|index) /i.test(code), "");
  check("it writes no row anywhere", !/(^|;)\s*(insert\s+into|update\s+public\.|delete\s+from)/im.test(code), "");
  check("nothing is granted to anon or PUBLIC, and no policy is for them", ![...code.matchAll(/\bgrant\b[^;]*?\sto\s+([a-z_, ]+);/gi)].some((g) => /\b(anon|public)\b/i.test(g[1])) && [...code.matchAll(/\bfor\s+(?:select|insert|update|delete)\s+to\s+([^\n]+)/gi)].every((p) => p[1].trim() === "authenticated"));
  check("recorded_by has no grant to authenticated", !/grant [^;]*recorded_by/i.test(code));
  check("no church_ prefixed object is created (Phase 0 verify row 10)", !/create (table|index|function)[^\n]*\bchurch_/i.test(code));
  check("the two permissions are named exactly", /church\.attendance\.view/.test(MIG) && /church\.attendance\.manage/.test(MIG));
  check("the foreign keys to events and to the roster are composite (same-church) and the event one is NO ACTION", /foreign key \(event_id, profile_id\) references public\.ministry_events \(id, profile_id\)\s*,/.test(code) && /foreign key \(member_id, profile_id\) references public\.church_members \(id, profile_id\) on delete cascade/.test(code) && !/ministry_events \(id, profile_id\) on delete (cascade|restrict|set)/.test(code));
  check("it is wrapped in one transaction", /^begin;/m.test(MIG) && /^commit;/m.test(MIG));
}

console.log(`\n${fail === 0 ? "OK" : "FAILED"}: ${pass} checks passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
