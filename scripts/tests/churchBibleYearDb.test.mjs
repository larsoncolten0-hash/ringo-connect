// Churches & Ministries expansion, Phase 5A: the 2027-01-07_church_bible_year migration (the church's feature switches and "The Bible in one year" enrolments and ticks), attacked OFFLINE
// (PGlite, synthetic data, no Supabase, no network).
//   * the preflight is all-true before, the verify all-true after, the migration is re-runnable, and the rollback refuses while rows exist;
//   * the switches: the public reads them for a published church page, only the church OWNER writes them, a platform admin who is not the owner cannot, a non-church profile cannot have them;
//   * an enrolment: its start date is today's date in Cameroon chosen by the DATABASE, one open plan per person and church, at most 20 per person, only its end can change, a closed plan stays closed;
//   * a tick: days 1..365, never a day that has not come, never on a closed plan, once per day;
//   * the reader tables are closed to every API role.
//   Run:  node scripts/tests/churchBibleYearDb.test.mjs
import fs from "fs";
import path from "path";
import * as F from "./churchFixtures.mjs";

const { PGlite } = await import(process.env.PGLITE_ENTRY || "@electric-sql/pglite");
const { u, prof, REPO } = F;
let pass = 0, fail = 0, section = "";
const check = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log("  FAIL:", `${section}${name}`, "|", String(detail).slice(0, 400)); } };
const eq = (name, a, b) => check(name, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8").replace(/\r\n/g, "\n");
const MIG = F.BY_MIG;
const SUP = "supabase/support/2027-01-07_church_bible_year";
const PRE = read(`${SUP}.preflight.sql`), VER = read(`${SUP}.verify.sql`), ROLL = read(`${SUP}.rollback.sql`);
const rows = (db, sql) => F.svcQuery(db, sql);
const S = (db, who) => F.sessionFor(db, who);
const attempt = async (db, sql) => { try { await db.exec(sql); return null; } catch (e) { try { await db.exec("rollback"); } catch { /* nothing to roll back */ } return String(e.message); } };
const allOk = (r) => r.length > 0 && r.every((x) => x.ok === true);
const cu = (n) => F.id("7", n);
const todayDouala = () => new Date(Date.now() + 3600_000).toISOString().slice(0, 10);

async function fresh({ bibleYear = true } = {}) {
  const db = await F.newDb(PGlite, { dailyWords: true, events: true, attendance: true, bible: true, music: true, care: true, testimonies: true, landing: true, groupsPastors: true, customers: true, bibleYear });
  await F.seed(db);
  return db;
}
async function customer(db, n) { await F.svc(db, `insert into public.ringo_customers (id, name, email) values ('${cu(n)}','Reader ${n}','r${n}@example.test')`); return cu(n); }
const svcErr = (db, sql) => F.svcErr(db, sql);

section = "A. preflight, apply, verify, re-run, rollback: ";
{
  const before = await fresh({ bibleYear: false });
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
  const broken = await fresh({ bibleYear: false });
  await broken.exec("alter function public.ministry_today() rename to ministry_today_gone");
  check("the migration refuses when ministry_today() is missing", (await attempt(broken, MIG)) !== null);

  const db = await fresh();
  const c = await customer(db, 1);
  await F.svc(db, `insert into public.bible_year_enrollments (customer_id, profile_id) values ('${c}','${prof.c1}')`);
  const refused = await attempt(db, ROLL);
  check("the rollback REFUSES while a row exists", refused !== null && /rollback refused/.test(refused), refused);
  check("a refused rollback changed nothing", (await rows(db, "select count(*)::int n from public.bible_year_enrollments"))[0].n === 1);
  check("the rollback runs once the loss is confirmed", (await attempt(db, ROLL.replace("begin;", "begin;\nselect set_config('church_bible_year.allow_data_loss', 'yes', true);"))) === null);
  check("the rollback leaves no table or function behind", (await rows(db, "select (select count(*) from information_schema.tables where table_schema='public' and table_name in ('church_features','bible_year_enrollments','bible_year_progress')) + (select count(*) from pg_proc where proname like '%bible_year%' or proname = 'church_features_guard') as n"))[0].n === 0);
  check("the earlier tables are untouched (customers still there)", (await rows(db, "select count(*)::int n from public.ringo_customers"))[0].n === 1);
  const empty = await fresh();
  check("an empty install rolls back without confirmation", (await attempt(empty, ROLL)) === null);
  check("...and the migration applies again", (await attempt(empty, MIG)) === null);
}

section = "B. the church switches: ";
{
  const db = await fresh();
  const anon = S(db, null), owner = S(db, u.owner1);
  const ins = await owner.from("church_features").insert({ profile_id: prof.c1, bible_year: true });
  check("the church owner switches a feature on", !ins.error, JSON.stringify(ins.error));
  eq("the public reads the switches of a published church page", ((await anon.from("church_features").select("profile_id, bible_year, counselling, giving")).data || []).map((r) => [r.bible_year, r.counselling, r.giving]), [[true, false, false]]);
  check("the public cannot read who changed them", !!(await anon.from("church_features").select("updated_by")).error);
  const up = await owner.from("church_features").update({ counselling: true }).eq("profile_id", prof.c1);
  check("the owner changes another switch", !up.error);
  eq("all defaults are OFF until the owner chooses", (await rows(db, `select giving from public.church_features where profile_id = '${prof.c1}'`))[0].giving, false);
  const stamp = (await rows(db, `select updated_by from public.church_features where profile_id = '${prof.c1}'`))[0].updated_by;
  check("who changed it comes from the signed-in caller", stamp === u.owner1);
  for (const [label, who] of [["a members manager", u.mgr1], ["a stranger", u.stranger], ["the owner of ANOTHER church", u.owner2], ["a platform admin who is not the owner", u.admin], ["the public", null]]) {
    const r = await S(db, who).from("church_features").update({ giving: true }).eq("profile_id", prof.c1).select("profile_id");
    check(`${label} cannot change a switch`, (!!r.error || (r.data || []).length === 0) && (await rows(db, `select giving from public.church_features where profile_id = '${prof.c1}'`))[0].giving === false);
  }
  const mgrIns = await S(db, u.mgr2).from("church_features").insert({ profile_id: prof.c2, bible_year: true });
  check("a staff member (not the owner) cannot create the row", !!mgrIns.error);
  const nonChurch = await S(db, u.ownerNC).from("church_features").insert({ profile_id: prof.nc, bible_year: true });
  check("a profile that is not a church cannot have switches", !!nonChurch.error, JSON.stringify(nonChurch.error));
  const move = await svcErr(db, `update public.church_features set profile_id = '${prof.c2}' where profile_id = '${prof.c1}'`);
  check("a row can never move to another church", move && move.code === "42501", JSON.stringify(move));
  await F.svc(db, `update public.profiles set published = false where id = '${prof.c1}'`);
  eq("an unpublished church page shows its switches to nobody public", ((await anon.from("church_features").select("profile_id")).data || []).length, 0);
  eq("...but the owner still reads them", ((await owner.from("church_features").select("profile_id")).data || []).length, 1);
}

section = "C. enrolments: ";
{
  const db = await fresh();
  const c1 = await customer(db, 1), c2 = await customer(db, 2);
  await F.svc(db, `insert into public.bible_year_enrollments (customer_id, profile_id, start_date) values ('${c1}','${prof.c1}','2020-02-02')`);
  const e = (await rows(db, `select id, start_date, ended_at from public.bible_year_enrollments where customer_id = '${c1}'`))[0];
  eq("the start date is TODAY (Cameroon), whatever the writer sent", String(e.start_date.toISOString ? e.start_date.toISOString().slice(0, 10) : e.start_date).slice(0, 10), todayDouala());
  const dup = await svcErr(db, `insert into public.bible_year_enrollments (customer_id, profile_id) values ('${c1}','${prof.c1}')`);
  check("only one OPEN plan per person and church", dup && dup.code === "23505", JSON.stringify(dup));
  check("the same person may follow with another church", (await svcErr(db, `insert into public.bible_year_enrollments (customer_id, profile_id) values ('${c1}','${prof.c3}')`)) === null);
  const nc = await svcErr(db, `insert into public.bible_year_enrollments (customer_id, profile_id) values ('${c2}','${prof.nc}')`);
  check("a page that is not a church takes no reader", nc && nc.code === "23514", JSON.stringify(nc));
  const changeStart = await svcErr(db, `update public.bible_year_enrollments set start_date = '2020-01-01' where id = '${e.id}'`);
  check("the start date can never be changed", changeStart && changeStart.code === "23514", JSON.stringify(changeStart));
  const move = await svcErr(db, `update public.bible_year_enrollments set profile_id = '${prof.c2}' where id = '${e.id}'`);
  check("the church can never be changed", move && move.code === "23514");
  check("a plan can be left (ended_at)", (await svcErr(db, `update public.bible_year_enrollments set ended_at = now() where id = '${e.id}'`)) === null);
  const reopen = await svcErr(db, `update public.bible_year_enrollments set ended_at = null where id = '${e.id}'`);
  check("a closed plan stays closed", reopen && reopen.code === "23514", JSON.stringify(reopen));
  check("after leaving, the person can start again (a new plan, a new start)", (await svcErr(db, `insert into public.bible_year_enrollments (customer_id, profile_id) values ('${c1}','${prof.c1}')`)) === null);
  // the limit of 20 open plans: 20 other churches are not available, so use the same church via closed rows is not enough; make many church profiles
  for (let i = 0; i < 19; i++) {
    await F.svc(db, `insert into public.users (id, role, plan_id) values ('${F.id("c", 600 + i)}','user','${F.plan.free}'); insert into public.profiles (id, user_id, category, categories) values ('${F.id("a", 600 + i)}','${F.id("c", 600 + i)}','church_ministries','{church_ministries}');`);
  }
  const c3 = await customer(db, 3);
  let accepted = 0, refusedAt = 0;
  for (let i = 0; i < 19; i++) { const r = await svcErr(db, `insert into public.bible_year_enrollments (customer_id, profile_id) values ('${c3}','${F.id("a", 600 + i)}')`); if (r === null) accepted++; }
  for (const p of [prof.c1, prof.c2]) { const r = await svcErr(db, `insert into public.bible_year_enrollments (customer_id, profile_id) values ('${c3}','${p}')`); if (r === null) accepted++; else refusedAt++; }
  check("a person has at most 20 open plans", accepted === 20 && refusedAt === 1, `accepted ${accepted} refused ${refusedAt}`);
}

section = "D. ticked days: ";
{
  const db = await fresh();
  const c1 = await customer(db, 1);
  await F.svc(db, `insert into public.bible_year_enrollments (customer_id, profile_id) values ('${c1}','${prof.c1}')`);
  const id = (await rows(db, "select id from public.bible_year_enrollments"))[0].id;
  check("day 1 can be ticked on the first day", (await svcErr(db, `insert into public.bible_year_progress (enrollment_id, day) values ('${id}', 1)`)) === null);
  const future = await svcErr(db, `insert into public.bible_year_progress (enrollment_id, day) values ('${id}', 2)`);
  check("a day that has not come cannot be ticked", future && future.code === "23514", JSON.stringify(future));
  const dup = await svcErr(db, `insert into public.bible_year_progress (enrollment_id, day) values ('${id}', 1)`);
  check("a day is ticked once", dup && dup.code === "23505");
  for (const bad of [0, -3, 366, 1000]) {
    const r = await svcErr(db, `insert into public.bible_year_progress (enrollment_id, day) values ('${id}', ${bad})`);
    check(`day ${bad} is outside the plan`, r && r.code === "23514", JSON.stringify(r));
  }
  // a plan that started 10 days ago has days 1..11 available
  await db.exec(`alter table public.bible_year_enrollments disable trigger user; update public.bible_year_enrollments set start_date = (public.ministry_today() - 10) where id = '${id}'; alter table public.bible_year_enrollments enable trigger user;`);
  check("on the 11th day, day 11 can be ticked", (await svcErr(db, `insert into public.bible_year_progress (enrollment_id, day) values ('${id}', 11)`)) === null);
  const d12 = await svcErr(db, `insert into public.bible_year_progress (enrollment_id, day) values ('${id}', 12)`);
  check("...and day 12 cannot yet", d12 && d12.code === "23514");
  check("an earlier day can be caught up", (await svcErr(db, `insert into public.bible_year_progress (enrollment_id, day) values ('${id}', 5)`)) === null);
  await F.svc(db, `update public.bible_year_enrollments set ended_at = now() where id = '${id}'`);
  const closed = await svcErr(db, `insert into public.bible_year_progress (enrollment_id, day) values ('${id}', 6)`);
  check("a closed plan takes no more ticks", closed && closed.code === "23514", JSON.stringify(closed));
  const orphan = await svcErr(db, `insert into public.bible_year_progress (enrollment_id, day) values ('${F.id("9", 999)}', 1)`);
  check("a tick needs an enrolment", !!orphan);
  // privacy
  for (const [label, who] of [["the public", null], ["a signed-in staff member", u.mgr1], ["the church owner", u.owner1], ["a platform admin", u.admin]]) {
    const s = S(db, who);
    const a = await s.from("bible_year_enrollments").select("id"), b = await s.from("bible_year_progress").select("day");
    const w = await s.from("bible_year_progress").insert({ enrollment_id: id, day: 2 });
    check(`${label} can neither read nor write the reader tables`, !!a.error && !!b.error && !!w.error, JSON.stringify([a.error && a.error.code, b.error && b.error.code, w.error && w.error.code]));
  }
  check("deleting the visitor deletes their reading (cascade)", (await svcErr(db, `delete from public.ringo_customers where id = '${c1}'`)) === null && (await rows(db, "select (select count(*) from public.bible_year_enrollments) + (select count(*) from public.bible_year_progress) as n"))[0].n === 0);
}

console.log(`${fail === 0 ? "OK" : "FAILED"}: ${pass} checks passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
