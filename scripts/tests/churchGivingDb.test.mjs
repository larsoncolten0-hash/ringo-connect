// Churches & Ministries expansion, Phase 7: the 2027-01-10_church_giving migration (giving and care fund DEFINITIONS, no money), attacked OFFLINE (PGlite, synthetic data, no Supabase, no network).
//   * the preflight is all-true before, the verify all-true after, the migration is re-runnable, and the rollback refuses while funds exist;
//   * collection is closed in the database itself: no fund can be "open" while church_giving_collection_open() is false;
//   * only the owner and holders of church.giving.manage write funds; the public reads a fund only when it is published AND giving is switched on; platform admins and other churches see nothing;
//   * the church and the kind never change, the closing time comes from the database, and the table holds no money received, donor or payment column.
//   Run:  node scripts/tests/churchGivingDb.test.mjs
import fs from "fs";
import path from "path";
import * as F from "./churchFixtures.mjs";

const { PGlite } = await import(process.env.PGLITE_ENTRY || "@electric-sql/pglite");
const { u, prof, REPO } = F;
let pass = 0, fail = 0, section = "";
const check = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log("  FAIL:", `${section}${name}`, "|", String(detail).slice(0, 400)); } };
const eq = (name, a, b) => check(name, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8").replace(/\r\n/g, "\n");
const MIG = F.GV_MIG;
const SUP = "supabase/support/2027-01-10_church_giving";
const PRE = read(`${SUP}.preflight.sql`), VER = read(`${SUP}.verify.sql`), ROLL = read(`${SUP}.rollback.sql`);
const rows = (db, sql) => F.svcQuery(db, sql);
const S = (db, who) => F.sessionFor(db, who);
const attempt = async (db, sql) => { try { await db.exec(sql); return null; } catch (e) { try { await db.exec("rollback"); } catch { /* nothing to roll back */ } return String(e.message); } };
const allOk = (r) => r.length > 0 && r.every((x) => x.ok === true);
const MANAGER = F.id("c", 731), VIEWER = F.id("c", 732);
const R = { manage: F.id("b", 731), other: F.id("b", 732) };
const BASE_MIGS = { dailyWords: true, events: true, attendance: true, bible: true, music: true, care: true, testimonies: true, landing: true, groupsPastors: true, customers: true, bibleYear: true, counselling: true };

async function fresh({ giving = true } = {}) {
  const db = await F.newDb(PGlite, { ...BASE_MIGS, giving });
  await F.seed(db);
  await F.svc(db, `insert into public.users (id, role, plan_id) values ('${MANAGER}','user','${F.plan.free}'), ('${VIEWER}','user','${F.plan.free}');
    insert into public.organization_roles (id, profile_id, key, name, permissions) values ('${R.manage}','${prof.c1}','gmanage','Giving manager','{church.giving.manage}'), ('${R.other}','${prof.c1}','gother','Members','{church.members.view,church.members.manage,church.care.manage}');
    insert into public.organization_members (profile_id, user_id, role_id) values ('${prof.c1}','${MANAGER}','${R.manage}'), ('${prof.c1}','${VIEWER}','${R.other}')`);
  return db;
}
async function fund(db, o = {}) {
  const id = o.id ?? F.id("4", 700 + (o.n ?? 1));
  await F.svc(db, `insert into public.church_giving_funds (id, profile_id, kind, title_en, title_fr, description_en, goal_xaf, is_published) values ('${id}','${o.profile ?? prof.c1}','${o.kind ?? "giving"}','Building fund','Fonds de construction','Help us build.',${o.goal ?? 500000},${o.published ?? false})`);
  return id;
}

section = "A. preflight, apply, verify, re-run, rollback: ";
{
  const before = await fresh({ giving: false });
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
  await fund(db);
  const refused = await attempt(db, ROLL);
  check("the rollback REFUSES while a fund exists", refused !== null && /rollback refused/.test(refused), refused);
  check("a refused rollback changed nothing", (await rows(db, "select count(*)::int n from public.church_giving_funds"))[0].n === 1);
  check("the rollback runs once the loss is confirmed", (await attempt(db, ROLL.replace("begin;", "begin;\nselect set_config('church_giving.allow_data_loss', 'yes', true);"))) === null);
  check("the rollback leaves no table, function or trigger behind", (await rows(db, "select (select count(*) from information_schema.tables where table_schema='public' and table_name = 'church_giving_funds') + (select count(*) from pg_proc where proname like 'church_giving_%') as n"))[0].n === 0);
  const empty = await fresh();
  check("an empty install rolls back without confirmation, and applies again", (await attempt(empty, ROLL)) === null && (await attempt(empty, MIG)) === null);
  check("the migration does not touch the Shop ledger or the platform settings (static)", !/commerce_sale_earnings|customer_payments|product_orders|commerce_payouts|platform_settings|fapshi/i.test(MIG.replace(/^--.*$/gm, "")));
}

section = "B. the shape of a fund: ";
{
  const db = await fresh();
  const ins = (o) => {
    const v = { kind: "giving", en: "Building fund", fr: "Fonds de construction", goal: 100000, ...o };
    return F.svcErr(db, `insert into public.church_giving_funds (profile_id, kind, title_en, title_fr, goal_xaf) values ('${o.profile ?? prof.c1}','${v.kind}',${F.q(v.en)},${F.q(v.fr)},${v.goal === null ? "null" : v.goal})`);
  };
  check("a giving fund is accepted", (await ins({})) === null);
  check("a care fund is accepted, with no goal", (await ins({ kind: "care", en: "Care fund", fr: "Fonds d'entraide", goal: null })) === null);
  const stored = (await rows(db, "select status, closed_at, is_published from public.church_giving_funds order by created_at limit 1"))[0];
  check("a fund starts as a private draft", stored.status === "draft" && stored.closed_at === null && stored.is_published === false);
  for (const [label, o] of [["another kind", { kind: "loan" }], ["an empty English title", { en: " " }], ["a 121-character French title", { fr: "x".repeat(121) }], ["a goal under 1000 XAF", { goal: 500 }], ["a goal over a billion XAF", { goal: 1000000001 }]]) {
    const e = await ins(o);
    check(`${label} is refused`, e && e.code === "23514", JSON.stringify(e));
  }
  const nc = await ins({ profile: prof.nc });
  check("a page that is not a church takes no fund", nc && nc.code === "23514", JSON.stringify(nc));
  const open = await F.svcErr(db, `insert into public.church_giving_funds (profile_id, kind, title_en, title_fr, status) values ('${prof.c1}','giving','Open now','Ouvert','open')`);
  check("a fund cannot be created already open", open && open.code === "23514" && /not_available/.test(open.msg), JSON.stringify(open));
}

section = "C. collection is closed in the database: ";
{
  const db = await fresh();
  const id = await fund(db);
  const open = await F.svcErr(db, `update public.church_giving_funds set status = 'open' where id = '${id}'`);
  check("even the server cannot open a fund (the switch function says false)", open && open.code === "23514" && /giving_collection_not_available|not available/.test(open.msg), JSON.stringify(open));
  const asOwner = await S(db, u.owner1).from("church_giving_funds").update({ status: "open" }).eq("id", id).select("id");
  check("the church owner cannot open a fund either", !!asOwner.error || (asOwner.data || []).length === 0, JSON.stringify(asOwner));
  eq("the fund is still a draft", (await rows(db, `select status from public.church_giving_funds where id = '${id}'`))[0].status, "draft");
  eq("the switch function answers false", (await rows(db, "select public.church_giving_collection_open() as v"))[0].v, false);
  const anon = await S(db, null).rpc("church_giving_collection_open");
  check("no API role can call the switch function or the guard", !!anon.error);
  const closed = await S(db, MANAGER).from("church_giving_funds").update({ status: "closed" }).eq("id", id).select("status, closed_at");
  check("a fund can be closed, and the database stamps the closing time", !closed.error && closed.data.length === 1 && closed.data[0].status === "closed" && closed.data[0].closed_at, JSON.stringify(closed));
  const again = await S(db, MANAGER).from("church_giving_funds").update({ status: "draft" }).eq("id", id).select("status, closed_at");
  check("putting it back to draft clears the closing time", !again.error && again.data[0].status === "draft" && again.data[0].closed_at === null, JSON.stringify(again));
}

section = "D. who can read: ";
{
  const db = await fresh();
  const draft = await fund(db, { n: 1 });
  const pub = await fund(db, { n: 2, published: true });
  const cols = "id, title_en, status, is_published";
  for (const [label, who, expect] of [["the church owner", u.owner1, 2], ["a giving manager", MANAGER, 2], ["a members manager (no giving right)", VIEWER, 0], ["a stranger", u.stranger, 0], ["the owner of ANOTHER church", u.owner2, 0], ["a platform admin who is not the owner", u.admin, 0], ["the public", null, 0]]) {
    const r = await S(db, who).from("church_giving_funds").select(cols);
    check(`${label} reads ${expect} fund(s) while giving is OFF`, !r.error && (r.data || []).length === expect, JSON.stringify(r.error || r.data));
  }
  await F.svc(db, `insert into public.church_features (profile_id, giving) values ('${prof.c1}', true)`);
  for (const [label, who] of [["the public", null], ["a stranger", u.stranger], ["a members manager", VIEWER], ["the owner of another church", u.owner2]]) {
    const r = await S(db, who).from("church_giving_funds").select(cols);
    check(`${label} reads ONLY the published fund once giving is on`, !r.error && (r.data || []).length === 1 && r.data[0].id === pub, JSON.stringify(r.error || r.data));
  }
  const hidden = await S(db, null).from("church_giving_funds").select("id").eq("id", draft);
  check("the draft stays hidden from the public", !hidden.error && hidden.data.length === 0);
  await F.svc(db, `update public.church_features set giving = false where profile_id = '${prof.c1}'`);
  const off = await S(db, null).from("church_giving_funds").select("id");
  check("switching giving off hides every fund from the public again", !off.error && off.data.length === 0);
}

section = "E. who can write: ";
{
  const db = await fresh();
  const id = await fund(db);
  for (const [label, who] of [["the public", null], ["a signed-in stranger", u.stranger], ["a members manager", VIEWER], ["the owner of another church", u.owner2], ["a platform admin who is not the owner", u.admin]]) {
    const ins = await S(db, who).from("church_giving_funds").insert({ profile_id: prof.c1, kind: "giving", title_en: "Forged", title_fr: "Faux" });
    check(`${label} cannot create a fund`, !!ins.error, JSON.stringify(ins.error));
    const up = await S(db, who).from("church_giving_funds").update({ title_en: "Changed" }).eq("id", id).select("id");
    check(`${label} cannot edit a fund`, !!up.error || (up.data || []).length === 0);
    const del = await S(db, who).from("church_giving_funds").delete().eq("id", id).select("id");
    check(`${label} cannot delete a fund`, !!del.error || (del.data || []).length === 0);
  }
  const mk = await S(db, MANAGER).from("church_giving_funds").insert({ profile_id: prof.c1, kind: "care", title_en: "Care fund", title_fr: "Fonds d'entraide", is_published: false }).select("id");
  check("a giving manager creates a fund", !mk.error && mk.data.length === 1, JSON.stringify(mk.error));
  const ow = await S(db, u.owner1).from("church_giving_funds").update({ title_en: "Renamed", goal_xaf: 250000 }).eq("id", id).select("title_en, goal_xaf");
  check("the owner edits a fund", !ow.error && ow.data[0].title_en === "Renamed" && ow.data[0].goal_xaf === 250000, JSON.stringify(ow.error));
  for (const patch of [{ kind: "care" }, { profile_id: prof.c2 }, { closed_at: "2000-01-01T00:00:00Z" }, { id: F.id("4", 999) }]) {
    const r = await S(db, u.owner1).from("church_giving_funds").update(patch).eq("id", id).select("id");
    check(`nobody signed in can edit ${Object.keys(patch)[0]}`, !!r.error || (r.data || []).length === 0, JSON.stringify(r.error || r.data));
  }
  const svc = await F.svcErr(db, `update public.church_giving_funds set kind = 'care' where id = '${id}'`);
  check("even the server cannot change the kind", svc && svc.code === "42501", JSON.stringify(svc));
  const del = await S(db, MANAGER).from("church_giving_funds").delete().eq("id", id).select("id");
  check("a giving manager deletes a fund", !del.error && del.data.length === 1);
}

section = "F. nothing about money or people: ";
{
  const db = await fresh();
  check("the table has no money-received, donor, payment, receipt or contact column", (await rows(db, "select count(*)::int n from information_schema.columns where table_name = 'church_giving_funds' and column_name ~* '(received|raised|donor|donation|payment|payout|refund|receipt|balance|fee|commission|customer|phone|email|user)'"))[0].n === 0);
  check("goal_xaf is the only amount column", JSON.stringify((await rows(db, "select column_name from information_schema.columns where table_name = 'church_giving_funds' and column_name ~* '(xaf|amount|price|currency)'")).map((r) => r.column_name)) === JSON.stringify(["goal_xaf"]));
  check("the shop ledger tables, if present in the scratch database, were not altered by the migration", (await rows(db, "select count(*)::int n from information_schema.tables where table_name in ('commerce_sale_earnings','customer_payments','product_orders','commerce_payouts')"))[0].n === 0);
}

console.log(`${fail === 0 ? "OK" : "FAILED"}: ${pass} checks passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
