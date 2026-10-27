// Churches & Ministries expansion, Phase 7 follow-up: the 2027-01-11_church_giving_lock migration, attacked OFFLINE (PGlite, synthetic data, no Supabase, no network).
//   * the preflight is all-true before, the verify all-true after, the migration is re-runnable, and the rollback removes exactly what it added and touches no data;
//   * the church owner, a staff member, the service role and a direct SQL write are ALL refused when they try to switch giving ON (insert or update);
//   * switching giving OFF, and saving the other switches, keep working; the earlier guard on church_features is untouched;
//   * the migration refuses to apply while any church already has giving on.
//   Run:  node scripts/tests/churchGivingLockDb.test.mjs
import fs from "fs";
import path from "path";
import * as F from "./churchFixtures.mjs";

const { PGlite } = await import(process.env.PGLITE_ENTRY || "@electric-sql/pglite");
const { u, prof, REPO } = F;
let pass = 0, fail = 0, section = "";
const check = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log("  FAIL:", `${section}${name}`, "|", String(detail).slice(0, 400)); } };
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8").replace(/\r\n/g, "\n");
const MIG = F.GL_MIG;
const SUP = "supabase/support/2027-01-11_church_giving_lock";
const PRE = read(`${SUP}.preflight.sql`), VER = read(`${SUP}.verify.sql`), ROLL = read(`${SUP}.rollback.sql`);
const rows = (db, sql) => F.svcQuery(db, sql);
const S = (db, who) => F.sessionFor(db, who);
const attempt = async (db, sql) => { try { await db.exec(sql); return null; } catch (e) { try { await db.exec("rollback"); } catch { /* nothing to roll back */ } return String(e.message); } };
const allOk = (r) => r.length > 0 && r.every((x) => x.ok === true);
const BASE = { dailyWords: true, events: true, attendance: true, bible: true, music: true, care: true, testimonies: true, landing: true, groupsPastors: true, customers: true, bibleYear: true, counselling: true };
const fresh = async (o = {}) => { const db = await F.newDb(PGlite, { ...BASE, ...o }); await F.seed(db); return db; };

section = "A. preflight, apply, verify, re-run, rollback: ";
{
  const before = await fresh({ giving: true });
  const pre = await rows(before, PRE);
  check("the preflight is all true BEFORE the migration", allOk(pre), JSON.stringify(pre.filter((x) => !x.ok)));
  check("the preflight is READ-ONLY", /^with\b/m.test(PRE.replace(/^--.*$/gm, "").trim()) && !/^\s*(insert|update|delete|drop|alter|create|grant|revoke|truncate)\b/im.test(PRE.replace(/^--.*$/gm, "")));
  await before.exec(MIG);
  const after = await rows(before, VER);
  check("the verify is all true AFTER the migration", allOk(after), JSON.stringify(after.filter((x) => !x.ok)));
  check("the verify is READ-ONLY", /^with\b/m.test(VER.replace(/^--.*$/gm, "").trim()) && !/^\s*(insert|update|delete|drop|alter|create|grant|revoke|truncate)\b/im.test(VER.replace(/^--.*$/gm, "")));
  check("the migration is re-runnable", (await attempt(before, MIG)) === null);
  check("the verify is still all true after the re-run", allOk(await rows(before, VER)));
  check("the preflight now reports the objects as present", (await rows(before, PRE)).some((x) => !x.ok));
  await F.svc(before, `insert into public.church_features (profile_id, bible_year) values ('${prof.c1}', true)`);
  check("the rollback runs, touches no data, and removes the lock", (await attempt(before, ROLL)) === null && (await rows(before, "select count(*)::int n from public.church_features"))[0].n === 1 && (await rows(before, "select count(*)::int n from pg_trigger where tgname = 'church_features_giving_lock_trg'"))[0].n === 0);
  check("the earlier church_features objects survive the rollback", (await rows(before, "select count(*)::int n from pg_trigger t join pg_proc p on p.oid = t.tgfoid where not t.tgisinternal and p.proname = 'church_features_guard'"))[0].n === 1);
  const db = await fresh({ giving: true });
  await F.svc(db, `insert into public.church_features (profile_id, giving) values ('${prof.c1}', true)`);
  const refused = await attempt(db, MIG);
  check("the migration REFUSES to apply while a church already has giving on", refused !== null && /precondition failed/.test(refused), refused);
  check("the migration does not touch the Shop ledger or platform settings (static)", !/commerce_|customer_payments|product_orders|platform_settings|fapshi/i.test(MIG.replace(/^--.*$/gm, "")));
}

section = "B. nobody can switch giving ON: ";
{
  const db = await fresh({ givingLock: true });
  const ins = await S(db, u.owner1).from("church_features").insert({ profile_id: prof.c1, giving: true });
  check("the church owner cannot insert giving = true through their own session", !!ins.error, JSON.stringify(ins));
  const svcIns = await F.svcErr(db, `insert into public.church_features (profile_id, giving) values ('${prof.c1}', true)`);
  check("the service role cannot insert giving = true", svcIns && svcIns.code === "23514" && /giving_collection_not_available/.test(svcIns.msg), JSON.stringify(svcIns));
  const okIns = await S(db, u.owner1).from("church_features").insert({ profile_id: prof.c1, bible_year: true, counselling: true }).select("giving");
  check("saving the other switches still works (giving stays off)", !okIns.error && okIns.data[0].giving === false, JSON.stringify(okIns));
  const up = await S(db, u.owner1).from("church_features").update({ giving: true }).eq("profile_id", prof.c1).select("giving");
  check("the church owner cannot update giving to true", !!up.error || (up.data || []).length === 0, JSON.stringify(up));
  const svcUp = await F.svcErr(db, `update public.church_features set giving = true where profile_id = '${prof.c1}'`);
  check("the service role cannot update giving to true", svcUp && svcUp.code === "23514", JSON.stringify(svcUp));
  const bulk = await F.svcErr(db, "update public.church_features set giving = true");
  check("a bulk update cannot switch it on either", bulk && bulk.code === "23514");
  const other = await S(db, u.owner1).from("church_features").update({ counselling: false }).eq("profile_id", prof.c1).select("counselling, giving");
  check("changing another switch works and giving is still off", !other.error && other.data.length === 1 && other.data[0].counselling === false && other.data[0].giving === false, JSON.stringify(other));
  const off = await S(db, u.owner1).from("church_features").update({ giving: false }).eq("profile_id", prof.c1).select("giving");
  check("switching giving OFF is always allowed", !off.error && off.data.length === 1 && off.data[0].giving === false, JSON.stringify(off));
  check("no row has giving on", (await rows(db, "select count(*)::int n from public.church_features where giving"))[0].n === 0);
  const staff = await S(db, u.mgr1).from("church_features").update({ giving: true }).eq("profile_id", prof.c1).select("giving");
  check("a staff member cannot do it either", !!staff.error || (staff.data || []).length === 0);
  const anon = await S(db, null).rpc("church_features_giving_lock");
  check("no API role can call the lock function", !!anon.error);
}

console.log(`${fail === 0 ? "OK" : "FAILED"}: ${pass} checks passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
