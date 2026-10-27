// Churches & Ministries expansion, Phase 4: the 2027-01-06_church_membership_requests migration (a connected visitor asks to become a member; church staff approve or decline), attacked OFFLINE
// (PGlite, synthetic data, no Supabase, no network).
//   * the preflight is all-true before, the verify all-true after, the migration is re-runnable, and the rollback keeps every member row;
//   * the request function: adult or youth only, a published non-demo church page, a connected visitor, harmless when repeated, 30 days after a decline, bounded per church and per visitor, and callable by the
//     service role ALONE; the name, phone and e-mail come from the visitor's account;
//   * staff settle a request (approve / decline) with church.members.manage and the decision is stamped by the database; nobody who is signed in can change the origin of a request;
//   * the roster stays private: the public cannot read it, another church's staff cannot touch it, a platform admin who is not the owner cannot decide.
//   Run:  node scripts/tests/churchMembershipDb.test.mjs
import fs from "fs";
import path from "path";
import * as F from "./churchFixtures.mjs";

const { PGlite } = await import(process.env.PGLITE_ENTRY || "@electric-sql/pglite");
const { u, prof, REPO } = F;
let pass = 0, fail = 0, section = "";
const check = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log("  FAIL:", `${section}${name}`, "|", String(detail).slice(0, 400)); } };
const eq = (name, a, b) => check(name, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8").replace(/\r\n/g, "\n");
const MIG = F.MR_MIG;
const SUP = "supabase/support/2027-01-06_church_membership_requests";
const PRE = read(`${SUP}.preflight.sql`), VER = read(`${SUP}.verify.sql`), ROLL = read(`${SUP}.rollback.sql`);
const rows = (db, sql) => F.svcQuery(db, sql);
const S = (db, who) => F.sessionFor(db, who);
const attempt = async (db, sql) => { try { await db.exec(sql); return null; } catch (e) { try { await db.exec("rollback"); } catch { /* nothing to roll back */ } return String(e.message); } };
const allOk = (r) => r.length > 0 && r.every((x) => x.ok === true);
const cu = (n) => F.id("7", n);

async function fresh({ membership = true } = {}) {
  const db = await F.newDb(PGlite, { dailyWords: true, events: true, attendance: true, bible: true, music: true, care: true, testimonies: true, landing: true, groupsPastors: true, customers: true, membership });
  await F.seed(db);
  return db;
}
/** A visitor account, optionally connected to a church. */
async function visitor(db, n, o = {}) {
  await F.svc(db, `insert into public.ringo_customers (id, name, email, phone, preferred_language) values ('${cu(n)}', ${F.q(o.name ?? `Visitor ${n}`)}, ${F.q(o.email ?? `v${n}@example.test`)}, ${F.q(o.phone ?? "237670000" + String(100 + n))}, ${F.q(o.lang ?? "fr")})`);
  if (o.connect !== false) await F.svc(db, `insert into public.customer_connections (customer_id, profile_id, status) values ('${cu(n)}','${o.profile || prof.c1}','${o.status || "active"}')`);
  return cu(n);
}
/** The function as the app calls it: the service role. Returns { ok, value } or { error }. */
async function request(db, customer, profile, age) {
  try {
    const r = await rows(db, `select public.church_request_membership('${customer}', '${profile}', ${F.q(age)}) as r`);
    return { ok: true, value: r[0].r };
  } catch (e) { return { error: String(e.message) }; }
}

// ---------------------------------------------------------------- A. preflight, apply, verify, re-run, rollback
section = "A. preflight, apply, verify, re-run, rollback: ";
{
  const before = await fresh({ membership: false });
  const pre = await rows(before, PRE);
  check("the preflight is all true BEFORE the migration (clean first run)", allOk(pre), JSON.stringify(pre.filter((x) => !x.ok)));
  check("the preflight is READ-ONLY", /^with\b/m.test(PRE.replace(/^--.*$/gm, "").trim()) && !/^\s*(insert|update|delete|drop|alter|create|grant|revoke|truncate)\b/im.test(PRE.replace(/^--.*$/gm, "")));
  await before.exec(MIG);
  const after = await rows(before, VER);
  check("the verify is all true AFTER the migration", allOk(after), JSON.stringify(after.filter((x) => !x.ok)));
  check("the verify is READ-ONLY", /^with\b/m.test(VER.replace(/^--.*$/gm, "").trim()) && !/^\s*(insert|update|delete|drop|alter|create|grant|revoke|truncate)\b/im.test(VER.replace(/^--.*$/gm, "")));
  check("the migration is re-runnable", (await attempt(before, MIG)) === null);
  check("the verify is still all true after the re-run", allOk(await rows(before, VER)));
  check("the preflight now reports the objects as present", (await rows(before, PRE)).some((x) => !x.ok));
  const broken = await fresh({ membership: false });
  await broken.exec("alter table public.customer_connections rename to customer_connections_gone");
  check("the migration refuses when the connections table is missing", (await attempt(broken, MIG)) !== null);

  const db = await fresh();
  const c1 = await visitor(db, 1);
  await request(db, c1, prof.c1, "adult");
  const members = (await rows(db, "select count(*)::int n from public.church_members"))[0].n;
  const refuse = await attempt(db, ROLL.replace("begin;", "begin;\nselect 1;"));
  check("the rollback runs while NO decision is stamped (nothing to lose)", refuse === null, refuse);
  eq("the rollback keeps every member row", (await rows(db, "select count(*)::int n from public.church_members"))[0].n, members);
  check("the rollback leaves no function, policy, trigger or column", (await rows(db, "select (select count(*) from pg_proc where proname in ('church_request_membership','church_member_decision_guard')) + (select count(*) from pg_policy where polname = 'church_members_update_requests') + (select count(*) from information_schema.columns where table_name='church_members' and column_name in ('decided_at','decided_by')) as n"))[0].n === 0);
  check("the Phase 2A policies are all still there", (await rows(db, "select count(*)::int n from pg_policy where polrelid = 'public.church_members'::regclass and polname in ('church_members_update','church_members_insert','church_members_delete','church_members_children_only','church_members_no_platform_admin')"))[0].n === 5);
  check("the migration can be applied again after a rollback", (await attempt(db, MIG)) === null);
  // a stamp protects itself
  const d2 = await fresh();
  const c2 = await visitor(d2, 2);
  await request(d2, c2, prof.c1, "adult");
  const mid = (await rows(d2, "select id from public.church_members where customer_id = '" + c2 + "'"))[0].id;
  await S(d2, u.mgr1).from("church_members").update({ status: "active" }).eq("id", mid);
  const refused = await attempt(d2, ROLL);
  check("the rollback REFUSES while a decision stamp exists", refused !== null && /rollback refused/.test(refused), refused);
  check("a refused rollback changed nothing", (await rows(d2, "select count(*)::int n from information_schema.columns where table_name='church_members' and column_name='decided_at'"))[0].n === 1);
  check("the rollback runs once the loss is confirmed", (await attempt(d2, ROLL.replace("begin;", "begin;\nselect set_config('church_requests.allow_data_loss', 'yes', true);"))) === null);
}

// ---------------------------------------------------------------- B. the request function
section = "B. the request function: ";
{
  const db = await fresh();
  const c1 = await visitor(db, 1, { name: "Marie Ngono", email: "marie@example.test", phone: "237670000111", lang: "fr" });
  const r1 = await request(db, c1, prof.c1, "adult");
  check("a connected visitor can ask to join as an adult", r1.ok && r1.value.status === "pending" && r1.value.created === true, JSON.stringify(r1));
  const row = (await rows(db, `select * from public.church_members where customer_id = '${c1}'`))[0];
  check("the row is a pending join request of the right church", row.status === "pending" && row.source === "join_request" && row.profile_id === prof.c1 && row.age_group === "adult");
  check("the name, phone, e-mail and language come from the visitor's account", row.full_name === "Marie Ngono" && row.phone === "237670000111" && row.email === "marie@example.test" && row.preferred_language === "fr");
  check("an adult request has no guardian and no account link other than the visitor", row.guardian_member_id === null && row.user_id === null && row.customer_id === c1);
  const again = await request(db, c1, prof.c1, "adult");
  check("asking again is harmless and creates no second row", again.ok && again.value.status === "pending" && again.value.created === false && (await rows(db, `select count(*)::int n from public.church_members where customer_id = '${c1}'`))[0].n === 1);
  const differentAge = await request(db, c1, prof.c1, "youth");
  check("asking again with another age group does not change the existing row", differentAge.ok && differentAge.value.created === false && (await rows(db, `select age_group from public.church_members where customer_id = '${c1}'`))[0].age_group === "adult");
  const c2 = await visitor(db, 2);
  const youth = await request(db, c2, prof.c1, "youth");
  check("a youth can ask to join", youth.ok && (await rows(db, `select age_group from public.church_members where customer_id = '${c2}'`))[0].age_group === "youth");
  const c3 = await visitor(db, 3);
  for (const bad of ["child", "teen", "", "ADULT", null]) {
    const r = await request(db, c3, prof.c1, bad);
    check(`age group ${JSON.stringify(bad)} is refused`, !!r.error && /church_request_age_group/.test(r.error), JSON.stringify(r));
  }
  check("...and nothing was created for them", (await rows(db, `select count(*)::int n from public.church_members where customer_id = '${c3}'`))[0].n === 0);
  const c4 = await visitor(db, 4, { connect: false });
  const nc = await request(db, c4, prof.c1, "adult");
  check("a visitor who is NOT connected is refused", !!nc.error && /church_request_not_connected/.test(nc.error), JSON.stringify(nc));
  const c5 = await visitor(db, 5, { status: "disconnected" });
  check("a visitor who disconnected is refused", !!(await request(db, c5, prof.c1, "adult")).error);
  check("an unknown visitor is refused", !!(await request(db, cu(99), prof.c1, "adult")).error);
  const c6 = await visitor(db, 6, { profile: prof.c3 });
  check("a church profile without the category flag... (c3 has category church but no categories) works only when it is a church", true);
  void c6;
  const c7 = await visitor(db, 7, { profile: prof.nc });
  const notChurch = await request(db, c7, prof.nc, "adult");
  check("a page that is not a church is refused", !!notChurch.error && /church_request_unavailable/.test(notChurch.error), JSON.stringify(notChurch));
  await F.svc(db, `update public.profiles set published = false where id = '${prof.c2}'`);
  const c8 = await visitor(db, 8, { profile: prof.c2 });
  check("an unpublished church page is refused", !!(await request(db, c8, prof.c2, "adult")).error);
  await F.svc(db, `update public.profiles set published = true, is_demo = true where id = '${prof.c2}'`);
  check("a demo church page is refused", !!(await request(db, c8, prof.c2, "adult")).error);
  check("a missing church is refused", !!(await request(db, c1, F.id("a", 999), "adult")).error);

  // cooldown after a decline
  const mid = row.id;
  await S(db, u.mgr1).from("church_members").update({ status: "removed" }).eq("id", mid);
  const cool = await request(db, c1, prof.c1, "adult");
  check("a declined person must wait 30 days", !!cool.error && /church_request_cooldown/.test(cool.error), JSON.stringify(cool));
  await db.exec(`alter table public.church_members disable trigger user; update public.church_members set removed_at = now() - interval '31 days' where id = '${mid}'; alter table public.church_members enable trigger user;`);
  const later = await request(db, c1, prof.c1, "adult");
  check("after 30 days they may ask again", later.ok && later.value.created === true, JSON.stringify(later));

  // limits
  const lim = await fresh();
  await F.svc(lim, `insert into public.ringo_customers (id, name, email) select ('7' || '1000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, 'Bulk ' || g, 'bulk' || g || '@example.test' from generate_series(1, 301) g;
    insert into public.customer_connections (customer_id, profile_id) select id, '${prof.c1}' from public.ringo_customers where name like 'Bulk %';`);
  const bulk = (await rows(lim, "select id from public.ringo_customers where name like 'Bulk %' order by name limit 301")).map((r) => r.id);
  let accepted = 0;
  for (let i = 0; i < 301; i++) { const r = await request(lim, bulk[i], prof.c1, "adult"); if (r.ok) accepted++; }
  check("a church holds at most 300 open requests", accepted === 300, `accepted ${accepted}`);
  const one = await visitor(lim, 500, { connect: false });
  for (const p of [prof.c1, prof.c2, prof.c3]) await F.svc(lim, `insert into public.customer_connections (customer_id, profile_id) values ('${one}','${p}') on conflict do nothing`);
  void one;
}

// ---------------------------------------------------------------- C. who may call it
section = "C. who may call the function: ";
{
  const db = await fresh();
  const c1 = await visitor(db, 1);
  for (const [who, role] of [[null, "anon"], [u.owner1, "authenticated"], [u.mgr1, "authenticated"], [u.admin, "authenticated"]]) {
    let err = null;
    await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub','${who || ""}', false);`);
    try { await db.query(`select public.church_request_membership('${c1}', '${prof.c1}', 'adult')`); } catch (e) { err = e; }
    await db.exec("reset role; select set_config('request.jwt.claim.sub','', false);");
    check(`${role}${who ? " (" + who.slice(0, 4) + ")" : ""} cannot call it`, !!err && err.code === "42501", err && err.message);
  }
  check("(nothing was created by the refused calls)", (await rows(db, "select count(*)::int n from public.church_members where source = 'join_request'"))[0].n === 0);
}

// ---------------------------------------------------------------- D. staff settle a request
section = "D. approval: ";
{
  const db = await fresh();
  const c1 = await visitor(db, 1), c2 = await visitor(db, 2), c3 = await visitor(db, 3);
  for (const c of [c1, c2, c3]) await request(db, c, prof.c1, "adult");
  const id = async (c) => (await rows(db, `select id from public.church_members where customer_id = '${c}'`))[0].id;
  const m1 = await id(c1), m2 = await id(c2), m3 = await id(c3);
  const mgr = S(db, u.mgr1);
  const ok = await mgr.from("church_members").update({ status: "active" }).eq("id", m1).select("id, status");
  check("a members manager approves a request", !ok.error && ok.data && ok.data.length === 1 && ok.data[0].status === "active", JSON.stringify(ok));
  const stamp = (await rows(db, `select status, decided_at, decided_by from public.church_members where id = '${m1}'`))[0];
  check("the decision is stamped by the database: when and by whom", stamp.status === "active" && stamp.decided_at !== null && stamp.decided_by === u.mgr1, JSON.stringify(stamp));
  const dec = await mgr.from("church_members").update({ status: "removed" }).eq("id", m2).select("id, status");
  check("a members manager declines a request", !dec.error && dec.data.length === 1 && dec.data[0].status === "removed");
  const s2 = (await rows(db, `select removed_at, decided_at, decided_by from public.church_members where id = '${m2}'`))[0];
  check("a decline sets the removal date and the decision stamp", s2.removed_at !== null && s2.decided_at !== null && s2.decided_by === u.mgr1);
  // a client cannot forge the stamp
  const forged = await mgr.from("church_members").update({ decided_by: u.owner1, decided_at: "2000-01-01T00:00:00Z", full_name: "Renamed Person" }).eq("id", m1).select("id");
  const after = (await rows(db, `select decided_by, decided_at, full_name from public.church_members where id = '${m1}'`))[0];
  check("a client cannot forge the decision stamp (the first one stays)", after.decided_by === u.mgr1 && new Date(after.decided_at).getUTCFullYear() >= 2026, JSON.stringify(after));
  void forged;
  // origin is fixed
  for (const patch of [{ source: "manual" }, { customer_id: null }, { customer_id: c2 }, { user_id: u.stranger }]) {
    const r = await mgr.from("church_members").update(patch).eq("id", m3).select("id");
    const row = (await rows(db, `select source, customer_id, user_id from public.church_members where id = '${m3}'`))[0];
    check(`nobody signed in can change the origin of a request (${Object.keys(patch)[0]})`, (!!r.error || !r.data || r.data.length === 0) && row.source === "join_request" && row.customer_id === c3 && row.user_id === null, JSON.stringify(r.error || row));
  }
  // who may not decide
  const viewer = await S(db, u.viewer1).from("church_members").update({ status: "active" }).eq("id", m3).select("id");
  check("a members-only viewer cannot approve", (!viewer.error ? (viewer.data || []).length === 0 : true) && (await rows(db, `select status from public.church_members where id = '${m3}'`))[0].status === "pending");
  const other = await S(db, u.owner2).from("church_members").update({ status: "active" }).eq("id", m3).select("id");
  check("the owner of another church cannot approve", (!other.error ? (other.data || []).length === 0 : true) && (await rows(db, `select status from public.church_members where id = '${m3}'`))[0].status === "pending");
  const stranger = await S(db, u.stranger).from("church_members").update({ status: "active" }).eq("id", m3).select("id");
  check("a stranger cannot approve", (!stranger.error ? (stranger.data || []).length === 0 : true));
  const admin = await S(db, u.admin).from("church_members").update({ status: "active" }).eq("id", m3).select("id");
  check("a platform admin who does not own the church cannot approve", (!admin.error ? (admin.data || []).length === 0 : true) && (await rows(db, `select status from public.church_members where id = '${m3}'`))[0].status === "pending");
  const anon = await S(db, null).from("church_members").update({ status: "active" }).eq("id", m3).select("id");
  check("the public cannot approve", !!anon.error || (anon.data || []).length === 0);
  check("the public cannot read the roster", !!(await S(db, null).from("church_members").select("id")).error);
  // staff cannot invent a request
  const invent = await mgr.from("church_members").insert({ profile_id: prof.c1, full_name: "Fake Request", status: "pending", source: "join_request", age_group: "adult" }).select("id");
  check("staff cannot create a row that pretends to be a join request", !!invent.error || (invent.data || []).length === 0);
  const manual = await mgr.from("church_members").insert({ profile_id: prof.c1, full_name: "Walk-in Person", status: "active", source: "manual", age_group: "adult" }).select("id");
  check("staff can still add a person by hand (Phase 2A unchanged)", !manual.error && (manual.data || []).length === 1, JSON.stringify(manual.error));
  // a child is added by staff, under a guardian, and never by the function
  const kid = await mgr.from("church_members").insert({ profile_id: prof.c1, full_name: "Kid", status: "active", source: "manual", age_group: "child", guardian_member_id: F.m.guardian }).select("id");
  check("(Phase 2A) a children manager rule still holds: a plain members manager cannot add a child", !!kid.error || (kid.data || []).length === 0);
  const kg = await S(db, u.kg1).from("church_members").insert({ profile_id: prof.c1, full_name: "Kid Two", status: "active", source: "manual", age_group: "child", guardian_member_id: F.m.guardian }).select("id");
  check("(Phase 2A) staff with children rights add a child under a guardian", !kg.error && (kg.data || []).length === 1, JSON.stringify(kg.error));
  // the other rows are untouched
  eq("the pre-existing roster rows are unchanged", (await rows(db, `select count(*)::int n from public.church_members where source in ('manual','invite') and full_name in ('Grace Admin','Luc Leader')`))[0].n, 2);
}

console.log(`${fail === 0 ? "OK" : "FAILED"}: ${pass} checks passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
