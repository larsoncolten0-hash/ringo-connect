// Churches & Ministries expansion, Phase 6: the 2027-01-09_church_counselling migration (counselling requests), attacked OFFLINE (PGlite, synthetic data, no Supabase, no network).
//   * the preflight is all-true before, the verify all-true after, the migration is re-runnable, and the rollback refuses while requests exist;
//   * only the server (service role) creates a request; the shape of every field is enforced by the database;
//   * the reason, name and contact details are readable ONLY by staff holding church.counselling.view / manage (or the owner); the public, other churches, other staff, group leaders and platform admins see nothing;
//   * staff can change only the decision and the private note; the decision is stamped by the database; every change of decision leaves a history note without any personal text;
//   * the words of a request can never be edited, and the history cannot be rewritten.
//   Run:  node scripts/tests/churchCounsellingDb.test.mjs
import fs from "fs";
import path from "path";
import * as F from "./churchFixtures.mjs";

const { PGlite } = await import(process.env.PGLITE_ENTRY || "@electric-sql/pglite");
const { u, prof, REPO } = F;
let pass = 0, fail = 0, section = "";
const check = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log("  FAIL:", `${section}${name}`, "|", String(detail).slice(0, 400)); } };
const eq = (name, a, b) => check(name, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8").replace(/\r\n/g, "\n");
const MIG = F.CO_MIG;
const SUP = "supabase/support/2027-01-09_church_counselling";
const PRE = read(`${SUP}.preflight.sql`), VER = read(`${SUP}.verify.sql`), ROLL = read(`${SUP}.rollback.sql`);
const rows = (db, sql) => F.svcQuery(db, sql);
const S = (db, who) => F.sessionFor(db, who);
const attempt = async (db, sql) => { try { await db.exec(sql); return null; } catch (e) { try { await db.exec("rollback"); } catch { /* nothing to roll back */ } return String(e.message); } };
const allOk = (r) => r.length > 0 && r.every((x) => x.ok === true);
const VIEWER = F.id("c", 701), MANAGER = F.id("c", 702);
const R = { view: F.id("b", 701), manage: F.id("b", 702) };
const KEY = (n) => F.id("5", 700 + n);

async function fresh({ counselling = true } = {}) {
  const db = await F.newDb(PGlite, { dailyWords: true, events: true, attendance: true, bible: true, music: true, care: true, testimonies: true, landing: true, groupsPastors: true, customers: true, counselling });
  await F.seed(db);
  await F.svc(db, `insert into public.users (id, role, plan_id) values ('${VIEWER}','user','${F.plan.free}'), ('${MANAGER}','user','${F.plan.free}');
    insert into public.organization_roles (id, profile_id, key, name, permissions) values ('${R.view}','${prof.c1}','cview','Counselling viewer','{church.counselling.view}'), ('${R.manage}','${prof.c1}','cmanage','Counselling manager','{church.counselling.manage}');
    insert into public.organization_members (profile_id, user_id, role_id) values ('${prof.c1}','${VIEWER}','${R.view}'), ('${prof.c1}','${MANAGER}','${R.manage}')`);
  return db;
}
async function request(db, n = 1, o = {}) {
  const id = F.id("3", 700 + n);
  await F.svc(db, `insert into public.church_counselling_requests (id, profile_id, submission_key, full_name, phone, email, reason, lang) values ('${id}','${o.profile ?? prof.c1}','${KEY(n)}','Marie Ngono','237670000${100 + n}',${F.q(o.email ?? "marie@example.test")},'I am struggling after a loss in my family and would like to talk.','${o.lang ?? "en"}')`);
  return id;
}

section = "A. preflight, apply, verify, re-run, rollback: ";
{
  const before = await fresh({ counselling: false });
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
  const db = await fresh();
  await request(db);
  const refused = await attempt(db, ROLL);
  check("the rollback REFUSES while a request exists", refused !== null && /rollback refused/.test(refused), refused);
  check("a refused rollback changed nothing", (await rows(db, "select count(*)::int n from public.church_counselling_requests"))[0].n === 1);
  check("the rollback runs once the loss is confirmed", (await attempt(db, ROLL.replace("begin;", "begin;\nselect set_config('church_counselling.allow_data_loss', 'yes', true);"))) === null);
  check("the rollback leaves no table, function or trigger behind", (await rows(db, "select (select count(*) from information_schema.tables where table_schema='public' and table_name like 'church_counselling_%') + (select count(*) from pg_proc where proname like 'church_counselling_%') as n"))[0].n === 0);
  const empty = await fresh();
  check("an empty install rolls back without confirmation, and applies again", (await attempt(empty, ROLL)) === null && (await attempt(empty, MIG)) === null);
}

section = "B. the shape of a request: ";
{
  const db = await fresh();
  const ins = (o) => {
    const v = { key: KEY(50), name: "Marie Ngono", phone: "237670000111", email: "marie@example.test", reason: "I would like to talk about my marriage.", lang: "en", ...o };
    return F.svcErr(db, `insert into public.church_counselling_requests (profile_id, submission_key, full_name, phone, email, reason, lang) values ('${o.profile ?? prof.c1}','${v.key}',${F.q(v.name)},${F.q(v.phone)},${v.email === null ? "null" : F.q(v.email)},${F.q(v.reason)},${F.q(v.lang)})`);
  };
  check("a good request is accepted", (await ins({})) === null);
  const stored = (await rows(db, "select status, decided_at, decided_by, decision_note from public.church_counselling_requests"))[0];
  check("it starts pending with no decision", stored.status === "pending" && stored.decided_at === null && stored.decided_by === null && stored.decision_note === null);
  check("the e-mail is optional", (await ins({ key: KEY(51), email: null })) === null);
  for (const [label, o] of [["a one-letter name", { key: KEY(52), name: "M" }], ["a short phone", { key: KEY(53), phone: "1234" }], ["a phone with letters", { key: KEY(54), phone: "23767abc0111" }], ["a very long phone", { key: KEY(55), phone: "1".repeat(16) }],
    ["an upper-case e-mail", { key: KEY(56), email: "Marie@Example.test" }], ["an e-mail without a domain", { key: KEY(57), email: "marie" }], ["a 9-character reason", { key: KEY(58), reason: "too short" }], ["a 1001-character reason", { key: KEY(59), reason: "x".repeat(1001) }], ["another language", { key: KEY(60), lang: "de" }]]) {
    const e = await ins(o);
    check(`${label} is refused`, e && e.code === "23514", JSON.stringify(e));
  }
  const dup = await ins({});
  check("the same form key is one request", dup && dup.code === "23505", JSON.stringify(dup));
  check("the same key for another church is allowed", (await ins({ profile: prof.c3 })) === null);
  const nc = await ins({ key: KEY(61), profile: prof.nc });
  check("a page that is not a church takes no request", nc && nc.code === "23514", JSON.stringify(nc));
  const forced = await F.svcErr(db, `insert into public.church_counselling_requests (profile_id, submission_key, full_name, phone, reason, status, decided_at, decision_note) values ('${prof.c1}','${KEY(70)}','Forced Person','237670000999','A reason that is long enough.','approved', now(), 'x')`);
  void forced;
  const row = (await rows(db, `select status, decided_at, decision_note from public.church_counselling_requests where submission_key = '${KEY(70)}'`))[0];
  check("a request cannot arrive already approved: the database resets it to pending", !row || (row.status === "pending" && row.decided_at === null && row.decision_note === null), JSON.stringify(row));
}

section = "C. who can read: ";
{
  const db = await fresh();
  const id = await request(db);
  const cols = "id, full_name, phone, email, reason, status";
  for (const [label, who, expect] of [["the church owner", u.owner1, 1], ["a counselling viewer", VIEWER, 1], ["a counselling manager", MANAGER, 1], ["a members manager (no counselling right)", u.mgr1, 0], ["a stranger", u.stranger, 0],
    ["the owner of ANOTHER church", u.owner2, 0], ["a group leader (not staff)", u.leader1, 0], ["a platform admin who is not the owner", u.admin, 0]]) {
    const r = await S(db, who).from("church_counselling_requests").select(cols);
    check(`${label} ${expect ? "reads the request, reason included" : "reads nothing"}`, !r.error && (r.data || []).length === expect && (!expect || r.data[0].reason.includes("struggling")), JSON.stringify(r.error || r.data));
  }
  const anon = await S(db, null).from("church_counselling_requests").select("id");
  check("the public cannot read a request at all", !!anon.error && anon.error.code === "42501", JSON.stringify(anon));
  const internals = await S(db, u.owner1).from("church_counselling_requests").select("submission_key");
  check("not even the owner reads the internal form key", !!internals.error, JSON.stringify(internals));
  const stamp = await S(db, u.owner1).from("church_counselling_requests").select("decided_by");
  check("...or who decided (it is in the history)", !!stamp.error);
  const hist = await S(db, VIEWER).from("church_counselling_history").select("id");
  check("a viewer reads the history (no personal text in it)", !hist.error);
  check("the history table has no column that could hold personal text", (await rows(db, "select count(*)::int n from information_schema.columns where table_name = 'church_counselling_history' and column_name ~* '(name|phone|email|reason|note|body)'"))[0].n === 0);
  void id;
}

section = "D. who can write: ";
{
  const db = await fresh();
  const id = await request(db);
  for (const [label, who] of [["the public", null], ["a signed-in stranger", u.stranger], ["a counselling viewer", VIEWER], ["a members manager", u.mgr1], ["the owner of another church", u.owner2], ["a platform admin who is not the owner", u.admin]]) {
    const r = await S(db, who).from("church_counselling_requests").update({ status: "approved" }).eq("id", id).select("id");
    const now = (await rows(db, `select status from public.church_counselling_requests where id = '${id}'`))[0].status;
    check(`${label} cannot approve`, (!!r.error || (r.data || []).length === 0) && now === "pending", JSON.stringify(r.error || r.data));
  }
  for (const [label, who] of [["the owner", u.owner1], ["a manager", MANAGER], ["a viewer", VIEWER], ["a stranger", u.stranger]]) {
    const r = await S(db, who).from("church_counselling_requests").insert({ profile_id: prof.c1, submission_key: KEY(80), full_name: "Forged Person", phone: "237670000555", reason: "A forged request that is long enough." });
    check(`${label} cannot create a request (only the server can)`, !!r.error, JSON.stringify(r.error));
  }
  const approve = await S(db, MANAGER).from("church_counselling_requests").update({ status: "approved", decision_note: "Pastor Joy will call on Monday." }).eq("id", id).select("id, status, decision_note");
  check("a counselling manager approves, with a private note", !approve.error && approve.data.length === 1 && approve.data[0].status === "approved", JSON.stringify(approve.error || approve.data));
  const stamped = (await rows(db, `select decided_at, decided_by from public.church_counselling_requests where id = '${id}'`))[0];
  check("the decision is stamped by the database: when and by whom", stamped.decided_at !== null && stamped.decided_by === MANAGER, JSON.stringify(stamped));
  const hist = await rows(db, `select from_status, to_status, changed_by from public.church_counselling_history where request_id = '${id}'`);
  check("the change left a history note: pending -> approved, by the manager", hist.length === 1 && hist[0].from_status === "pending" && hist[0].to_status === "approved" && hist[0].changed_by === MANAGER, JSON.stringify(hist));
  const decline = await S(db, u.owner1).from("church_counselling_requests").update({ status: "declined" }).eq("id", id).select("status");
  check("the owner can change the decision", !decline.error && decline.data[0].status === "declined");
  eq("each change adds a note", (await rows(db, `select count(*)::int n from public.church_counselling_history where request_id = '${id}'`))[0].n, 2);
  const reopen = await S(db, u.owner1).from("church_counselling_requests").update({ status: "pending" }).eq("id", id).select("status");
  check("a decision can be put back to pending, which clears the stamp", !reopen.error && (await rows(db, `select decided_at from public.church_counselling_requests where id = '${id}'`))[0].decided_at === null);
  const same = await S(db, MANAGER).from("church_counselling_requests").update({ decision_note: "Updated note" }).eq("id", id).select("id");
  check("changing only the note adds no history note", !same.error && (await rows(db, `select count(*)::int n from public.church_counselling_history where request_id = '${id}'`))[0].n === 3);
  for (const patch of [{ reason: "A new reason that I made up." }, { full_name: "Someone Else" }, { phone: "237670000999" }, { email: "x@example.test" }, { lang: "fr" }, { decided_by: u.owner1 }, { submission_key: KEY(99) }, { profile_id: prof.c2 }, { decided_at: "2000-01-01T00:00:00Z" }]) {
    const r = await S(db, u.owner1).from("church_counselling_requests").update(patch).eq("id", id).select("id");
    check(`nobody signed in can edit ${Object.keys(patch)[0]}`, !!r.error || (r.data || []).length === 0, JSON.stringify(r.error || r.data));
  }
  const words = (await rows(db, `select full_name, reason, phone from public.church_counselling_requests where id = '${id}'`))[0];
  check("the person's words and details are exactly as they were sent", words.full_name === "Marie Ngono" && words.reason.includes("struggling") && words.phone === "237670000101");
  const badStatus = await F.svcErr(db, `update public.church_counselling_requests set status = 'closed' where id = '${id}'`);
  check("an unknown status is refused", badStatus && badStatus.code === "23514");
  // the service role is the one that can alter the words? the guard refuses everyone, the service role included
  const svcEdit = await F.svcErr(db, `update public.church_counselling_requests set reason = 'Edited by the server, long enough.' where id = '${id}'`);
  check("even the server cannot rewrite what a person wrote", svcEdit && svcEdit.code === "42501", JSON.stringify(svcEdit));
  // the history is a fixed record
  const h = (await rows(db, "select id from public.church_counselling_history limit 1"))[0].id;
  const rewrite = await F.svcErr(db, `update public.church_counselling_history set to_status = 'approved' where id = '${h}'`);
  check("the history cannot be rewritten", rewrite && rewrite.code === "42501", JSON.stringify(rewrite));
  for (const who of [u.owner1, MANAGER]) {
    const w = await S(db, who).from("church_counselling_history").update({ to_status: "approved" }).eq("id", h).select("id");
    check("...not even by staff", !!w.error || (w.data || []).length === 0);
  }
  // delete
  const delViewer = await S(db, VIEWER).from("church_counselling_requests").delete().eq("id", id).select("id");
  check("a viewer cannot delete a request", !!delViewer.error || (delViewer.data || []).length === 0);
  const delMgr = await S(db, MANAGER).from("church_counselling_requests").delete().eq("id", id).select("id");
  check("a counselling manager can delete a request", !delMgr.error && delMgr.data.length === 1);
  check("its history goes with it (nothing is left)", (await rows(db, "select (select count(*) from public.church_counselling_history) + (select count(*) from public.church_counselling_requests) as n"))[0].n === 0);
}

console.log(`${fail === 0 ? "OK" : "FAILED"}: ${pass} checks passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
