// Churches & Ministries expansion, Phase 5B: the 2027-01-08_church_push migration (a connected visitor opts in, per topic, to notifications from a church), attacked OFFLINE
// (PGlite, synthetic data, no Supabase, no network).
//   * the preflight is all-true before, the verify all-true after, the migration is re-runnable, and the rollback refuses while rows exist;
//   * preferences: only for a church page, only the known topics, only while connected, kept sorted and without duplicates;
//   * the queue: one notification per church, kind and reference; only a published, non-demo church page can queue; due ones are claimed once, a stalled claim is released after 10 minutes;
//   * the recipients: opted in to THAT topic, still connected, not yet notified, under the daily cap; the daily Bible reading only for readers; a group notice only for active roster members of its group;
//   * everything is closed to every API role: only the service role can use it.
//   Run:  node scripts/tests/churchPushDb.test.mjs
import fs from "fs";
import path from "path";
import * as F from "./churchFixtures.mjs";

const { PGlite } = await import(process.env.PGLITE_ENTRY || "@electric-sql/pglite");
const { u, prof, REPO } = F;
let pass = 0, fail = 0, section = "";
const check = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log("  FAIL:", `${section}${name}`, "|", String(detail).slice(0, 400)); } };
const eq = (name, a, b) => check(name, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8").replace(/\r\n/g, "\n");
const MIG = F.PU_MIG;
const SUP = "supabase/support/2027-01-08_church_push";
const PRE = read(`${SUP}.preflight.sql`), VER = read(`${SUP}.verify.sql`), ROLL = read(`${SUP}.rollback.sql`);
const rows = (db, sql) => F.svcQuery(db, sql);
const attempt = async (db, sql) => { try { await db.exec(sql); return null; } catch (e) { try { await db.exec("rollback"); } catch { /* nothing to roll back */ } return String(e.message); } };
const allOk = (r) => r.length > 0 && r.every((x) => x.ok === true);
const cu = (n) => F.id("7", n);

async function fresh({ push = true } = {}) {
  const db = await F.newDb(PGlite, { dailyWords: true, events: true, attendance: true, bible: true, music: true, care: true, testimonies: true, landing: true, groupsPastors: true, customers: true, membership: true, bibleYear: true, push });
  await F.seed(db);
  return db;
}
/** A visitor, optionally connected to a church, optionally with topics chosen. */
async function person(db, n, o = {}) {
  await F.svc(db, `insert into public.ringo_customers (id, name, email, preferred_language) values ('${cu(n)}','Person ${n}','p${n}@example.test', ${F.q(o.lang ?? "en")})`);
  if (o.connect !== false) await F.svc(db, `insert into public.customer_connections (customer_id, profile_id, status) values ('${cu(n)}','${o.profile ?? prof.c1}','active')`);
  if (o.topics) await F.svc(db, `insert into public.church_push_prefs (customer_id, profile_id, topics) values ('${cu(n)}','${o.profile ?? prof.c1}', ${F.q("{" + o.topics.join(",") + "}")})`);
  // the visitor may disconnect AFTER choosing topics: the choice stays but the person is no longer a recipient
  if (o.status === "disconnected") await F.svc(db, `update public.customer_connections set status = 'disconnected' where customer_id = '${cu(n)}'`);
  return cu(n);
}
const enqueue = async (db, kind, ref, o = {}) => (await rows(db, `select public.church_push_enqueue('${o.profile ?? prof.c1}', ${F.q(kind)}, ${F.q(ref)}, ${o.runAt ? F.q(o.runAt) : "(now() - interval '1 minute')"}::timestamptz, ${F.q(JSON.stringify(o.payload ?? { title_en: "T", body_en: "B", path: "/x" }))}::jsonb) as r`))[0].r;
const outboxId = async (db, kind, ref) => (await rows(db, `select id from public.church_push_outbox where kind = ${F.q(kind)} and ref = ${F.q(ref)}`))[0]?.id;
const recipients = async (db, id) => (await rows(db, `select * from public.church_push_recipients('${id}', 500)`));

section = "A. preflight, apply, verify, re-run, rollback: ";
{
  const before = await fresh({ push: false });
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
  const broken = await fresh({ push: false });
  await broken.exec("alter table public.church_public_groups rename to church_public_groups_gone");
  check("the migration refuses when Phase 3 is missing", (await attempt(broken, MIG)) !== null);

  const db = await fresh();
  await person(db, 1, { topics: ["events"] });
  const refused = await attempt(db, ROLL);
  check("the rollback REFUSES while a row exists", refused !== null && /rollback refused/.test(refused), refused);
  check("a refused rollback changed nothing", (await rows(db, "select count(*)::int n from public.church_push_prefs"))[0].n === 1);
  check("the rollback runs once the loss is confirmed", (await attempt(db, ROLL.replace("begin;", "begin;\nselect set_config('church_push.allow_data_loss', 'yes', true);"))) === null);
  check("the rollback leaves no table or function behind, and the visitors stay", (await rows(db, "select (select count(*) from information_schema.tables where table_schema='public' and table_name like 'church_push_%') + (select count(*) from pg_proc where proname like 'church_push_%') as n"))[0].n === 0 && (await rows(db, "select count(*)::int n from public.ringo_customers"))[0].n === 1);
  const empty = await fresh();
  check("an empty install rolls back without confirmation, and applies again", (await attempt(empty, ROLL)) === null && (await attempt(empty, MIG)) === null);
}

section = "B. preferences: ";
{
  const db = await fresh();
  const c1 = await person(db, 1, { connect: false });
  const bad = await F.svcErr(db, `insert into public.church_push_prefs (customer_id, profile_id, topics) values ('${c1}','${prof.c1}','{sports}')`);
  check("only the known topics are accepted", bad && bad.code === "23514", JSON.stringify(bad));
  const notConnected = await F.svcErr(db, `insert into public.church_push_prefs (customer_id, profile_id, topics) values ('${c1}','${prof.c1}','{events}')`);
  check("topics need an active connection", notConnected && notConnected.code === "23514", JSON.stringify(notConnected));
  check("an empty choice needs no connection (it is the same as no notifications)", (await F.svcErr(db, `insert into public.church_push_prefs (customer_id, profile_id, topics) values ('${c1}','${prof.c1}','{}')`)) === null);
  await F.svc(db, `insert into public.customer_connections (customer_id, profile_id) values ('${c1}','${prof.c1}')`);
  check("once connected the topics are accepted", (await F.svcErr(db, `update public.church_push_prefs set topics = '{events,care}' where customer_id = '${c1}'`)) === null);
  await F.svc(db, `update public.church_push_prefs set topics = '{store,events,store,announcements}' where customer_id = '${c1}'`);
  eq("topics are kept sorted and without duplicates", (await rows(db, `select topics from public.church_push_prefs where customer_id = '${c1}'`))[0].topics, ["announcements", "events", "store"]);
  const tooMany = await F.svcErr(db, `update public.church_push_prefs set topics = '{announcements,events,testimonies,daily_word,bible_day,care,store,groups,groups}' where customer_id = '${c1}'`);
  check("the duplicates collapse, so all eight topics fit", tooMany === null);
  const move = await F.svcErr(db, `update public.church_push_prefs set profile_id = '${prof.c3}' where customer_id = '${c1}'`);
  check("a choice cannot be moved to another church", move && move.code === "23514");
  const c2 = await person(db, 2, { connect: false });
  await F.svc(db, `insert into public.customer_connections (customer_id, profile_id) values ('${c2}','${prof.nc}')`);
  const nc = await F.svcErr(db, `insert into public.church_push_prefs (customer_id, profile_id, topics) values ('${c2}','${prof.nc}','{events}')`);
  check("a page that is not a church takes no choices", nc && nc.code === "23514");
  for (const [label, who, role] of [["the public", null, "anon"], ["a signed-in staff member", u.mgr1, "authenticated"], ["the church owner", u.owner1, "authenticated"], ["a platform admin", u.admin, "authenticated"]]) {
    let r = null;
    await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub','${who || ""}', false);`);
    try { await db.query("select * from public.church_push_prefs"); } catch (e) { r = e; }
    await db.exec("reset role; select set_config('request.jwt.claim.sub','', false);");
    check(`${label} cannot read anyone's choices`, !!r && r.code === "42501", r && r.message);
  }
}

section = "C. the queue: ";
{
  const db = await fresh();
  check("a notification is queued", (await enqueue(db, "announcement", "a-1")) === true);
  check("the same one again is a no-op (false)", (await enqueue(db, "announcement", "a-1")) === false);
  check("the same reference with another kind is a different notification", (await enqueue(db, "event", "a-1")) === true);
  check("the same item for another church is a different notification", (await enqueue(db, "announcement", "a-1", { profile: prof.c3 })) === true);
  eq("only three rows exist", (await rows(db, "select count(*)::int n from public.church_push_outbox"))[0].n, 3);
  const badKind = await F.svcErr(db, `select public.church_push_enqueue('${prof.c1}', 'gossip', 'x', now(), '{}'::jsonb)`);
  check("an unknown kind is refused", badKind && badKind.code === "23514", JSON.stringify(badKind));
  const bigPayload = await F.svcErr(db, `select public.church_push_enqueue('${prof.c1}', 'announcement', 'big', now(), jsonb_build_object('body', repeat('x', 3000)))`);
  check("a big payload is refused", bigPayload && bigPayload.code === "23514", JSON.stringify(bigPayload));
  const arr = await F.svcErr(db, `select public.church_push_enqueue('${prof.c1}', 'announcement', 'arr', now(), '[1,2]'::jsonb)`);
  check("a payload must be an object", arr && arr.code === "23514");
  check("a page that is not a church queues nothing (false)", (await enqueue(db, "announcement", "n-1", { profile: prof.nc })) === false);
  await F.svc(db, `update public.profiles set published = false where id = '${prof.c3}'`);
  check("an unpublished church page queues nothing (false)", (await enqueue(db, "announcement", "n-2", { profile: prof.c3 })) === false);
  await F.svc(db, `update public.profiles set is_demo = true where id = '${prof.c1}'`);
  check("a demo church page queues nothing (false)", (await enqueue(db, "announcement", "n-3")) === false);
  await F.svc(db, `update public.profiles set is_demo = false where id = '${prof.c1}'`);
  // claim
  await enqueue(db, "daily_word", "future", { runAt: new Date(Date.now() + 3600_000).toISOString() });
  const claimed = await rows(db, "select * from public.church_push_claim(10)");
  check("only DUE notifications are claimed (the future one is not)", claimed.length === 3 && claimed.every((r) => r.status === "sending") && !claimed.some((r) => r.ref === "future"), JSON.stringify(claimed.map((r) => [r.kind, r.ref, r.status])));
  eq("a second claim finds nothing", (await rows(db, "select * from public.church_push_claim(10)")).length, 0);
  await db.exec("alter table public.church_push_outbox disable trigger user; update public.church_push_outbox set claimed_at = now() - interval '11 minutes' where ref = 'a-1' and kind = 'announcement' and profile_id = '" + prof.c1 + "'; alter table public.church_push_outbox enable trigger user;");
  const reclaimed = await rows(db, "select * from public.church_push_claim(10)");
  check("a claim whose sender stalled for 10 minutes is released and taken again", reclaimed.length === 1 && reclaimed[0].ref === "a-1");
  const id = reclaimed[0].id;
  await F.svc(db, `select public.church_push_finish('${id}', 'sent')`);
  const done = (await rows(db, `select status, processed_at from public.church_push_outbox where id = '${id}'`))[0];
  check("finishing marks it sent with a time", done.status === "sent" && done.processed_at !== null);
  eq("a finished notification is never claimed again", (await rows(db, "select * from public.church_push_claim(10)")).length, 0);
  // limit
  const lim = await fresh();
  for (let i = 0; i < 7; i++) await enqueue(lim, "announcement", "m-" + i);
  eq("the claim limit is respected", (await rows(lim, "select * from public.church_push_claim(3)")).length, 3);
  eq("a silly limit is clamped to at least one", (await rows(lim, "select * from public.church_push_claim(0)")).length, 1);
  // closed to API roles
  for (const [label, who, role] of [["the public", null, "anon"], ["a staff member", u.mgr1, "authenticated"], ["the owner", u.owner1, "authenticated"]]) {
    for (const call of [`select public.church_push_enqueue('${prof.c1}', 'announcement', 'zz', now(), '{}'::jsonb)`, "select * from public.church_push_claim(1)", `select * from public.church_push_recipients('${F.id("9", 1)}', 1)`, `select public.church_push_record('${F.id("9", 1)}', '${cu(1)}', true)`, `select public.church_push_finish('${F.id("9", 1)}', 'sent')`]) {
      let r = null;
      await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub','${who || ""}', false);`);
      try { await db.query(call); } catch (e) { r = e; }
      await db.exec("reset role; select set_config('request.jwt.claim.sub','', false);");
      check(`${label} cannot call ${call.slice(7, 32)}...`, !!r && r.code === "42501", r && r.message);
    }
  }
}

section = "D. who is notified: ";
{
  const db = await fresh();
  const a = await person(db, 1, { topics: ["announcements"], lang: "fr" });
  const b = await person(db, 2, { topics: ["events"] });
  const c = await person(db, 3, { topics: ["announcements", "events"], lang: "de" });
  const d = await person(db, 4, { topics: ["announcements"], status: "disconnected" });
  await person(db, 5, {});
  await enqueue(db, "announcement", "x1");
  const id = await outboxId(db, "announcement", "x1");
  const r = await recipients(db, id);
  eq("only people opted in to THAT topic and still connected", r.map((x) => x.customer_id).sort(), [a, c].sort());
  check("their language is French or English (anything else becomes English)", r.find((x) => x.customer_id === a).lang === "fr" && r.find((x) => x.customer_id === c).lang === "en");
  check("nothing but the visitor id, the language and the plan start comes back", Object.keys(r[0]).sort().join() === "customer_id,lang,start_date", Object.keys(r[0]).join());
  eq("the other topic reaches the other people", (await (async () => { await enqueue(db, "event", "e1"); return (await recipients(db, await outboxId(db, "event", "e1"))).map((x) => x.customer_id).sort(); })()), [b, c].sort());
  void d;
  // dedupe
  await F.svc(db, `select public.church_push_record('${id}', '${a}', true)`);
  await F.svc(db, `select public.church_push_record('${id}', '${a}', false)`);
  eq("a person already notified is not listed again", (await recipients(db, id)).map((x) => x.customer_id), [c]);
  eq("recording twice keeps the first note (one row)", (await rows(db, `select count(*)::int n from public.church_push_deliveries where outbox_id = '${id}' and customer_id = '${a}'`))[0].n, 1);
  // daily cap
  const cap = await fresh();
  const p = await person(cap, 1, { topics: ["announcements"] });
  for (let i = 0; i < 5; i++) { await enqueue(cap, "announcement", "cap-" + i); await F.svc(cap, `select public.church_push_record('${await outboxId(cap, "announcement", "cap-" + i)}', '${p}', true)`); }
  await enqueue(cap, "announcement", "cap-5");
  eq("after 5 church messages in a day the person is left alone", (await recipients(cap, await outboxId(cap, "announcement", "cap-5"))).length, 0);
  await cap.exec(`alter table public.church_push_deliveries disable trigger user; update public.church_push_deliveries set created_at = now() - interval '25 hours'; alter table public.church_push_deliveries enable trigger user;`);
  eq("a day later they are reachable again", (await recipients(cap, await outboxId(cap, "announcement", "cap-5"))).length, 1);
  // failed deliveries do not count toward the cap
  const nodev = await fresh();
  const q = await person(nodev, 1, { topics: ["announcements"] });
  for (let i = 0; i < 6; i++) { await enqueue(nodev, "announcement", "nd-" + i); await F.svc(nodev, `select public.church_push_record('${await outboxId(nodev, "announcement", "nd-" + i)}', '${q}', false)`); }
  await enqueue(nodev, "announcement", "nd-6");
  eq("notes of messages that did not go out do not count toward the cap", (await recipients(nodev, await outboxId(nodev, "announcement", "nd-6"))).length, 1);
  // limit
  const many = await fresh();
  for (let i = 1; i <= 7; i++) await person(many, i, { topics: ["announcements"] });
  await enqueue(many, "announcement", "l1");
  eq("the recipient limit is respected", (await rows(many, `select * from public.church_push_recipients('${await outboxId(many, "announcement", "l1")}', 3)`)).length, 3);
  eq("an unknown notification has no recipients", (await rows(many, `select * from public.church_push_recipients('${F.id("9", 55)}', 3)`)).length, 0);
}

section = "E. the daily Bible reading and group notices: ";
{
  const db = await fresh();
  const reader = await person(db, 1, { topics: ["bible_day"] });
  const nonReader = await person(db, 2, { topics: ["bible_day"] });
  const wrongTopic = await person(db, 3, { topics: ["events"] });
  await F.svc(db, `insert into public.bible_year_enrollments (customer_id, profile_id) values ('${reader}','${prof.c1}'), ('${wrongTopic}','${prof.c1}')`);
  await enqueue(db, "bible_day", "2027-01-10", { payload: { path: "/x/church/bible-year" } });
  const r = await recipients(db, await outboxId(db, "bible_day", "2027-01-10"));
  eq("only a reader who opted in to the daily reading", r.map((x) => x.customer_id), [reader]);
  check("the reader's plan start comes with them (so each gets their own day)", r[0].start_date !== null);
  void nonReader;
  await F.svc(db, `update public.bible_year_enrollments set ended_at = now() where customer_id = '${reader}'`);
  eq("a reader who left is not notified", (await recipients(db, await outboxId(db, "bible_day", "2027-01-10"))).length, 0);

  // group notices: a public group linked to a roster group; only active roster members with a visitor account
  const g = await fresh();
  const grp = await F.svc(g, `insert into public.church_public_groups (profile_id, kind, roster_group_id, is_published) values ('${prof.c1}','youths','${F.g.youthGrp}', true)`).then(() => rows(g, "select id from public.church_public_groups"));
  const gid = grp[0].id;
  const inGroup = await person(g, 1, { topics: ["groups"] });
  const outside = await person(g, 2, { topics: ["groups"] });
  const wrong = await person(g, 3, { topics: ["announcements"] });
  const inactive = await person(g, 4, { topics: ["groups"] });
  const memberOf = async (cust, status, memberId) => {
    await F.svc(g, `insert into public.church_members (id, profile_id, customer_id, full_name, status, age_group) values ('${memberId}','${prof.c1}','${cust}','M ${memberId.slice(-2)}','active','adult')`);
    await F.svc(g, `insert into public.church_group_members (profile_id, group_id, member_id, role) values ('${prof.c1}','${F.g.youthGrp}','${memberId}','member')`);
    if (status !== "active") await F.svc(g, `update public.church_members set status = '${status}' where id = '${memberId}'`);
  };
  await memberOf(inGroup, "active", F.id("e", 801));
  await memberOf(wrong, "active", F.id("e", 802));
  await memberOf(inactive, "inactive", F.id("e", 803));
  await enqueue(g, "group_announcement", "ga-1", { payload: { group_id: gid, path: "/x/church/groups/youths" } });
  const gr = await recipients(g, await outboxId(g, "group_announcement", "ga-1"));
  eq("a group notice reaches only opted-in ACTIVE roster members of that group", gr.map((x) => x.customer_id), [inGroup]);
  void outside;
  await enqueue(g, "group_announcement", "ga-2", { payload: { group_id: F.id("9", 77) } });
  eq("a group notice naming no real group reaches nobody", (await recipients(g, await outboxId(g, "group_announcement", "ga-2"))).length, 0);
  await F.svc(g, `update public.church_public_groups set is_published = false`);
  eq("a hidden group's notice reaches nobody", (await recipients(g, await outboxId(g, "group_announcement", "ga-1"))).length, 0);
  await enqueue(g, "group_announcement", "ga-3", { payload: {} });
  eq("a group notice with no group in it reaches nobody", (await recipients(g, await outboxId(g, "group_announcement", "ga-3"))).length, 0);
}

console.log(`${fail === 0 ? "OK" : "FAILED"}: ${pass} checks passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
