// Churches & Ministries Phase 5: the bible_* migration (programmes, sessions, private enrolments and progress), attacked OFFLINE.
// Loads the REAL Team migrations, the real permission-ceiling and Inbox guards, the REAL Phase 2A church migration, the Phase 3 and Phase 4 migrations and then the new 2026-12-30_bible_programs.sql into
// scratch in-memory PostgreSQL (PGlite), and attacks it the way a visitor, a participant or a signed-in user could: direct table access under the `anon` / `authenticated` roles with RLS on and
// auth.uid() = that user. It also runs the preflight, verify and rollback scripts. All data is synthetic. No Supabase, no network, no production data, no SQL against any real database.
//   Run:  node scripts/tests/bibleProgramsDb.test.mjs
import fs from "fs";
import path from "path";
import * as F from "./churchFixtures.mjs";

const { PGlite } = await import(process.env.PGLITE_ENTRY || "@electric-sql/pglite");
const { u, prof, REPO } = F;
let pass = 0, fail = 0, section = "";
const check = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log("  FAIL:", `${section}${name}`, "|", String(detail).slice(0, 400)); } };
const eq = (name, a, b) => check(name, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8").replace(/\r\n/g, "\n");
const MIG = F.BI_MIG;
const SUP = "supabase/support/2026-12-30_bible_programs";
const PRE = read(`${SUP}.preflight.sql`), VER = read(`${SUP}.verify.sql`), ROLL = read(`${SUP}.rollback.sql`);

const U2 = (n) => F.id("c", 80 + n);
const bv = U2(1), bm = U2(2), bp = U2(3), adminPub = U2(4);
const R2 = (n) => F.id("b", 80 + n);
const r = { view: R2(1), manage: R2(2), publish: R2(3), adminPub: R2(4) };
const P = (k) => F.id("8", 400 + k);
const SS = (k) => F.id("8", 500 + k);
const CU = (k) => F.id("c", 700 + k);

async function fresh({ withBi = true, extras = true } = {}) {
  const db = await F.newDb(PGlite, { dailyWords: true, events: true, bible: withBi });
  await F.seed(db);
  if (extras) await F.svc(db, `
    insert into public.users (id, role, plan_id) values ('${bv}','user','${F.plan.free}'), ('${bm}','user','${F.plan.free}'), ('${bp}','user','${F.plan.free}'), ('${adminPub}','admin','${F.plan.free}');
    insert into public.organization_roles (id, profile_id, key, name, permissions) values
      ('${r.view}','${prof.c1}','bview','Bible viewer','{church.bible.view}'),
      ('${r.manage}','${prof.c1}','bmanage','Bible writer','{church.bible.manage}'),
      ('${r.publish}','${prof.c1}','bpublish','Bible publisher','{church.bible.publish}'),
      ('${r.adminPub}','${prof.c1}','badmin','Platform admin holding publish','{church.bible.publish,church.bible.view}');
    insert into public.organization_members (profile_id, user_id, role_id) values ('${prof.c1}','${bv}','${r.view}'), ('${prof.c1}','${bm}','${r.manage}'), ('${prof.c1}','${bp}','${r.publish}'), ('${prof.c1}','${adminPub}','${r.adminPub}');
    insert into public.ringo_customers (id) values ('${CU(1)}'), ('${CU(2)}'), ('${CU(3)}'), ('${CU(4)}');
  `);
  return db;
}
const rows = (db, sql) => F.svcQuery(db, sql);
const S = (db, who) => F.sessionFor(db, who);
const Pr = (db, who) => S(db, who).from("bible_programs");
const Se = (db, who) => S(db, who).from("bible_program_sessions");
const prog = (o = {}) => ({ id: F.id("8", 900 + Math.floor(Math.random() * 90000)), profile_id: prof.c1, status: "draft", title_en: "Psalms in 30 days", ...o });
const ses = (programId, pos, o = {}) => ({ id: F.id("8", 600000 + Math.floor(Math.random() * 300000)), profile_id: prof.c1, program_id: programId, position: pos, title_en: `Day ${pos}`, scripture_ref_en: `Psalm ${pos}`, ...o });
/** A published programme of church 1 with 3 sessions, service-side. */
async function seedProgram(db, k, { status = "published", profile = prof.c1, sessions = 3 } = {}) {
  await F.svc(db, `insert into public.bible_programs (id, profile_id, status, title_en, title_fr, description_en) values ('${P(k)}','${profile}','draft','Programme ${k}','Programme ${k} fr','About');`);
  for (let i = 1; i <= sessions; i++) await F.svc(db, `insert into public.bible_program_sessions (id, profile_id, program_id, position, title_en, scripture_ref_en) values ('${SS(k * 10 + i)}','${profile}','${P(k)}',${i},'Day ${i}','Psalm ${i}')`);
  if (status === "published") await F.svc(db, `update public.bible_programs set status = 'published' where id = '${P(k)}'`);
}

// =================================================================================================================================================================
section = "A. structure and grants: ";
// =================================================================================================================================================================
{
  const db = await fresh();
  for (const t of ["bible_programs", "bible_program_sessions", "bible_enrollments", "bible_session_progress"]) {
    for (const k of ["select", "insert", "update", "delete", "truncate", "references", "trigger"]) {
      check(`${t}: PUBLIC has no ${k}`, (await rows(db, `select has_table_privilege('public','public.${t}','${k}') as b`))[0].b === false);
      check(`${t}: anon has no table-level ${k}`, (await rows(db, `select has_table_privilege('anon','public.${t}','${k}') as b`))[0].b === false);
    }
    for (const k of ["truncate", "references", "trigger"]) check(`${t}: authenticated cannot ${k}`, (await rows(db, `select has_table_privilege('authenticated','public.${t}','${k}') as b`))[0].b === false);
    check(`${t}: row-level security is on, no policy applies to PUBLIC`, (await rows(db, `select relrowsecurity as b from pg_class where oid = 'public.${t}'::regclass`))[0].b === true && (await rows(db, `select count(*)::int as n from pg_policy where polrelid = 'public.${t}'::regclass and polroles = array[0::oid]`))[0].n === 0);
  }
  for (const t of ["bible_programs", "bible_program_sessions"]) {
    for (const c of ["created_by", "updated_by", "published_by"]) for (const k of ["select", "insert", "update"]) for (const rl of ["anon", "authenticated"]) {
      const has = (await rows(db, `select exists (select 1 from pg_attribute where attrelid = 'public.${t}'::regclass and attname = '${c}') as e`))[0].e;
      if (has) check(`${t}: ${rl} cannot ${k} ${c}`, (await rows(db, `select has_column_privilege('${rl}','public.${t}','${c}','${k}') as b`))[0].b === false);
    }
    check(`${t}: anon reads content columns and writes nothing`, (await rows(db, `select has_column_privilege('anon','public.${t}','title_en','select') as r, has_any_column_privilege('anon','public.${t}','insert') as i, has_any_column_privilege('anon','public.${t}','update') as u`)).every((x) => x.r && !x.i && !x.u));
    check(`${t}: profile_id cannot be updated`, (await rows(db, `select has_column_privilege('authenticated','public.${t}','profile_id','update') as b`))[0].b === false);
    const star = await S(db, null).from(t).select("*");
    check(`${t}: anon select * is refused (it would include audit columns)`, star.error && star.error.code === "42501", JSON.stringify(star.error));
  }
  for (const t of ["bible_enrollments", "bible_session_progress"]) {
    eq(`${t}: no policy at all`, (await rows(db, `select count(*)::int as n from pg_policy where polrelid = 'public.${t}'::regclass`))[0].n, 0);
    for (const who of [null, u.owner1, u.stranger, u.admin]) {
      const a = await S(db, who).from(t).select("id");
      check(`${t}: nobody can read it through the API (${who || "anon"})`, !!a.error && a.error.code === "42501", JSON.stringify(a));
      const w = await S(db, who).from(t).insert({ id: F.id("1", 1) });
      check(`${t}: nobody can write it through the API (${who || "anon"})`, !!w.error && w.error.code === "42501");
    }
  }
  check("the stats and move functions are callable by signed-in users only", (await rows(db, `select has_function_privilege('authenticated','public.bible_program_stats(uuid)','execute') as a, has_function_privilege('anon','public.bible_program_stats(uuid)','execute') as b, has_function_privilege('anon','public.bible_session_move(uuid, text)','execute') as c, has_function_privilege('authenticated','public.bible_session_move(uuid, text)','execute') as d`)).every((x) => x.a && !x.b && !x.c && x.d));
  check("the guards are callable by nobody", (await rows(db, `select bool_or(has_function_privilege(r, p.oid, 'execute')) as b from pg_proc p, unnest(array['anon','authenticated','public']) r where p.proname in ('bible_program_guard','bible_session_guard','bible_enrollment_guard','bible_progress_guard')`))[0].b === false);
  const a = await S(db, null).rpc("bible_program_stats", { p_program_id: P(1) });
  check("anon cannot call the stats function (privilege error)", a.error && a.error.code === "42501", JSON.stringify(a));
  await db.close();
}

// =================================================================================================================================================================
section = "B. what the public, strangers and other churches can read: ";
// =================================================================================================================================================================
{
  const db = await fresh();
  await seedProgram(db, 1); // published, church 1
  await seedProgram(db, 2, { status: "draft" }); // draft, church 1
  await seedProgram(db, 3, { profile: prof.c2 }); // published, church 2
  await seedProgram(db, 4, { profile: prof.c2, status: "draft" });
  const titles = (res) => (res.data || []).map((x) => x.title_en).sort();
  let res = await Pr(db, null).select("id, title_en, status");
  eq("anonymous programmes: published only, both churches", titles(res), ["Programme 1", "Programme 3"]);
  res = await Se(db, null).select("id, title_en, program_id");
  eq("anonymous sessions: only those of published programmes (6, no draft programme's)", [(res.data || []).length, new Set((res.data || []).map((x) => x.program_id)).size], [6, 2]);
  res = await Pr(db, u.stranger).select("id, title_en");
  eq("a signed-in stranger sees exactly the public set", titles(res), ["Programme 1", "Programme 3"]);
  res = await Pr(db, u.owner1).select("id, title_en").eq("profile_id", prof.c1);
  eq("the owner reads every programme of the church", titles(res), ["Programme 1", "Programme 2"]);
  res = await Se(db, u.owner1).select("id").eq("profile_id", prof.c1);
  eq("...and every session", (res.data || []).length, 6);
  for (const [who, tag] of [[bv, "viewer"], [bm, "writer"], [bp, "publisher"]]) {
    res = await Pr(db, who).select("id, title_en").eq("profile_id", prof.c1);
    eq(`${tag}: reads every programme of the church, drafts included`, titles(res), ["Programme 1", "Programme 2"]);
  }
  res = await Pr(db, u.plain1).select("id, title_en").eq("profile_id", prof.c1);
  eq("staff without a Bible permission see only the public set", titles(res), ["Programme 1"]);
  res = await Pr(db, u.owner2).select("id, title_en");
  eq("the other church's owner sees their own draft but none of church 1's drafts", titles(res), ["Programme 1", "Programme 3", "Programme 4"]);
  res = await Pr(db, u.admin).select("id, title_en");
  eq("a platform admin with no relationship sees only the public set", titles(res), ["Programme 1", "Programme 3"]);
  res = await Pr(db, adminPub).select("id, title_en").eq("profile_id", prof.c1);
  eq("a platform admin who is a team member holding publish still reads no draft", titles(res), ["Programme 1"]);
  await F.svc(db, `update public.profiles set published = false where id = '${prof.c1}'`);
  res = await Pr(db, null).select("id, title_en");
  eq("an unpublished church profile has no public programme", titles(res), ["Programme 3"]);
  res = await Se(db, null).select("program_id");
  eq("...and none of its sessions are public", [...new Set((res.data || []).map((x) => x.program_id))], [P(3)]);
  res = await Pr(db, u.owner1).select("id, title_en").eq("profile_id", prof.c1);
  eq("...but its owner still reads them", titles(res), ["Programme 1", "Programme 2"]);
  await db.close();
}

// =================================================================================================================================================================
section = "C. who may write programmes and sessions: ";
// =================================================================================================================================================================
{
  const db = await fresh();
  const pid = P(10);
  let res = await Pr(db, u.owner1).insert(prog({ id: pid }));
  check("owner: creates a draft programme", !res.error, JSON.stringify(res.error));
  const stamp = (await rows(db, `select created_by::text as c, published_at from public.bible_programs where id = '${pid}'`))[0];
  check("the creator is stamped from auth.uid()", stamp.c === u.owner1 && stamp.published_at === null, JSON.stringify(stamp));
  res = await Pr(db, u.owner1).insert(prog({ created_by: u.stranger }));
  check("a client-supplied created_by is refused", !!res.error && res.error.code === "42501");
  res = await Se(db, u.owner1).insert(ses(pid, 1, { id: SS(1) }));
  check("owner: adds a session", !res.error, JSON.stringify(res.error));
  // manage: drafts only
  const mid = P(11);
  res = await Pr(db, bm).insert(prog({ id: mid, title_en: "By writer" }));
  check("manage: creates a draft programme", !res.error, JSON.stringify(res.error));
  res = await Se(db, bm).insert(ses(mid, 1, { id: SS(2) }));
  check("manage: adds a session to a draft programme", !res.error, JSON.stringify(res.error));
  res = await Se(db, bm).update({ title_en: "Edited" }).eq("id", SS(2)).select("id");
  check("manage: edits a session of a draft programme", !res.error && res.data.length === 1);
  res = await Pr(db, bm).update({ status: "published" }).eq("id", mid).select("id");
  check("manage: CANNOT publish", !!res.error && res.error.code === "42501", JSON.stringify(res));
  res = await Pr(db, bm).insert(prog({ status: "published" }));
  check("manage: CANNOT insert an already-published programme", !!res.error);
  res = await Se(db, bm).insert(ses(pid, 2, { id: SS(3) }));
  check("manage: adds a session to the owner's DRAFT programme as well", !res.error, JSON.stringify(res.error));
  // publish permission publishes
  res = await Pr(db, bp).update({ status: "published" }).eq("id", pid).select("id");
  check("publish: publishes a programme that has a session", !res.error && res.data.length === 1, JSON.stringify(res));
  const live = (await rows(db, `select status, published_at is not null as a, published_by::text as b from public.bible_programs where id = '${pid}'`))[0];
  check("publishing stamps published_at and published_by", live.status === "published" && live.a === true && live.b === bp, JSON.stringify(live));
  // a LIVE programme: manage touches nothing
  res = await Pr(db, bm).update({ title_en: "Vandal" }).eq("id", pid).select("id");
  check("manage: editing a LIVE programme touches nothing", !res.error && res.data.length === 0);
  res = await Pr(db, bm).update({ status: "draft" }).eq("id", pid).select("id");
  check("manage: CANNOT unpublish", !res.error && res.data.length === 0);
  res = await Pr(db, bm).delete().eq("id", pid).select("id");
  check("manage: CANNOT delete a live programme", !res.error && res.data.length === 0);
  res = await Se(db, bm).update({ title_en: "Vandal" }).eq("id", SS(1)).select("id");
  check("manage: editing a session of a LIVE programme touches nothing", !res.error && res.data.length === 0);
  res = await Se(db, bm).delete().eq("id", SS(1)).select("id");
  check("manage: CANNOT delete a session of a LIVE programme", !res.error && res.data.length === 0);
  res = await Se(db, bm).insert(ses(pid, 3, { id: SS(4) }));
  check("manage: CANNOT add a session to a LIVE programme", !!res.error, JSON.stringify(res.error));
  res = await Se(db, bp).insert(ses(pid, 3, { id: SS(5) }));
  check("publish: adds a session to a LIVE programme", !res.error, JSON.stringify(res.error));
  res = await Se(db, bp).update({ title_en: "Corrected" }).eq("id", SS(1)).select("id");
  check("publish: edits a session of a LIVE programme", !res.error && res.data.length === 1);
  res = await Se(db, bp).delete().eq("id", SS(5)).select("id");
  check("publish: deletes a session of a LIVE programme", !res.error && res.data.length === 1);
  res = await Pr(db, bp).update({ status: "draft" }).eq("id", pid).select("id");
  check("publish: unpublishes; the publication stamps are cleared", !res.error && res.data.length === 1 && (await rows(db, `select published_at from public.bible_programs where id = '${pid}'`))[0].published_at === null);
  res = await Se(db, bm).update({ title_en: "Draft again" }).eq("id", SS(1)).select("id");
  check("manage: edits sessions again once the programme is a draft", !res.error && res.data.length === 1);
  // view only / others
  res = await Pr(db, bv).insert(prog());
  check("view only: cannot create a programme", !!res.error);
  res = await Se(db, bv).insert(ses(pid, 9));
  check("view only: cannot add a session", !!res.error);
  res = await Se(db, bv).update({ title_en: "x" }).eq("id", SS(1)).select("id");
  check("view only: cannot edit a session", !res.error && res.data.length === 0);
  for (const [who, tag] of [[u.plain1, "staff without the permission"], [u.stranger, "a stranger"], [u.mgr1, "a church administrator without the permission"]]) {
    res = await Pr(db, who).insert(prog());
    check(`${tag}: cannot create a programme`, !!res.error);
    res = await Se(db, who).insert(ses(pid, 9));
    check(`${tag}: cannot add a session`, !!res.error);
  }
  res = await Pr(db, null).insert(prog());
  check("anon cannot insert", !!res.error && res.error.code === "42501");
  res = await Pr(db, adminPub).insert(prog());
  check("a platform admin holding publish as a team member cannot create (restrictive policy)", !!res.error, JSON.stringify(res.error));
  res = await Se(db, adminPub).update({ title_en: "x" }).eq("id", SS(1)).select("id");
  check("...nor edit a session", !res.error && res.data.length === 0);
  // tenant isolation
  res = await Pr(db, u.owner1).update({ profile_id: prof.c2 }).eq("id", pid).select("id");
  check("profile_id of a programme cannot be changed (no column privilege)", !!res.error && res.error.code === "42501");
  res = await Se(db, u.owner1).update({ program_id: mid }).eq("id", SS(1)).select("id");
  check("program_id of a session cannot be changed (no column privilege)", !!res.error && res.error.code === "42501");
  res = await Pr(db, u.owner2).insert(prog({ profile_id: prof.c1 }));
  check("another church's owner cannot plant a programme", !!res.error);
  res = await Se(db, u.owner2).insert(ses(pid, 9));
  check("another church's owner cannot plant a session (composite key and policy)", !!res.error);
  res = await Pr(db, u.owner2).update({ title_en: "Hijack" }).eq("id", pid).select("id");
  check("another church's owner cannot edit church 1's programmes", !res.error && res.data.length === 0);
  res = await Se(db, u.owner2).delete().eq("id", SS(1)).select("id");
  check("another church's owner cannot delete church 1's sessions", !res.error && res.data.length === 0);
  // a session of church 2 pointing at church 1's programme is impossible
  const cross = await F.svcErr(db, `insert into public.bible_program_sessions (profile_id, program_id, position, title_en) values ('${prof.c2}','${pid}', 50, 'x')`);
  check("a session cannot name another church's programme (composite foreign key)", !!cross && cross.code === "23503", JSON.stringify(cross));
  const notChurch = await F.svcErr(db, `insert into public.bible_programs (profile_id, title_en) values ('${prof.nc}','x')`);
  check("a programme cannot be created for a profile that is not a church", !!notChurch && /bible_profile_required/.test(notChurch.msg), JSON.stringify(notChurch));
  const move = await F.svcErr(db, `update public.bible_programs set profile_id = '${prof.c2}' where id = '${pid}'`);
  check("the guard refuses to move a programme to another church even for the service role", !!move && /bible_tenant_immutable/.test(move.msg), JSON.stringify(move));
  await db.close();
}

// =================================================================================================================================================================
section = "D. programme rules: ";
// =================================================================================================================================================================
{
  const db = await fresh();
  const pid = P(20);
  await F.svc(db, `insert into public.bible_programs (id, profile_id, title_en) values ('${pid}','${prof.c1}','Empty programme')`);
  let err = await F.svcErr(db, `update public.bible_programs set status = 'published' where id = '${pid}'`);
  check("a programme with no session cannot be published (even by the service role)", !!err && /bible_program_needs_sessions/.test(err.msg), JSON.stringify(err));
  err = await F.svcErr(db, `insert into public.bible_programs (profile_id, status, title_en) values ('${prof.c1}','published','Born published')`);
  check("a programme cannot be inserted already published", !!err && /bible_program_needs_sessions/.test(err.msg), JSON.stringify(err));
  await F.svc(db, `insert into public.bible_program_sessions (id, profile_id, program_id, position, title_en) values ('${SS(20)}','${prof.c1}','${pid}',1,'Day 1')`);
  err = await F.svcErr(db, `update public.bible_programs set status = 'published' where id = '${pid}'`);
  check("with a session it publishes", err === null, JSON.stringify(err));
  err = await F.svcErr(db, `update public.bible_programs set title_en = null, title_fr = null where id = '${pid}'`);
  check("a published programme needs a title in some language", !!err && /bible_programs_publish_content_check/.test(err.msg), JSON.stringify(err));
  err = await F.svcErr(db, `update public.bible_programs set title_en = null, title_fr = 'Programme' where id = '${pid}'`);
  check("a French-only published programme is fine", err === null, JSON.stringify(err));
  // sessions
  const sErr = (sql) => F.svcErr(db, sql);
  err = await sErr(`insert into public.bible_program_sessions (profile_id, program_id, position, title_en) values ('${prof.c1}','${pid}',1,'Duplicate position')`);
  check("two sessions cannot share a position", !!err && err.code === "23505" && /bible_program_sessions_position_key/.test(err.msg), JSON.stringify(err));
  err = await sErr(`insert into public.bible_program_sessions (profile_id, program_id, position) values ('${prof.c1}','${pid}',2)`);
  check("a session needs a title in some language", !!err && /bible_program_sessions_title_check/.test(err.msg), JSON.stringify(err));
  err = await sErr(`insert into public.bible_program_sessions (profile_id, program_id, position, title_fr) values ('${prof.c1}','${pid}',2,'Jour 2')`);
  check("a French-only session is fine", err === null, JSON.stringify(err));
  for (const [what, sql] of [
    ["position 0", `insert into public.bible_program_sessions (profile_id, program_id, position, title_en) values ('${prof.c1}','${pid}',0,'x')`],
    ["position 1001", `insert into public.bible_program_sessions (profile_id, program_id, position, title_en) values ('${prof.c1}','${pid}',1001,'x')`],
    ["a 121-character title", `insert into public.bible_program_sessions (profile_id, program_id, position, title_en) values ('${prof.c1}','${pid}',3,'${"x".repeat(121)}')`],
    ["a 121-character reference", `insert into public.bible_program_sessions (profile_id, program_id, position, title_en, scripture_ref_en) values ('${prof.c1}','${pid}',3,'x','${"x".repeat(121)}')`],
    ["a 1001-character note", `insert into public.bible_program_sessions (profile_id, program_id, position, title_en, note_en) values ('${prof.c1}','${pid}',3,'x','${"x".repeat(1001)}')`],
  ]) { err = await sErr(sql); check(`a session with ${what} is refused`, !!err && err.code === "23514", JSON.stringify(err)); }
  err = await F.svcErr(db, `insert into public.bible_programs (profile_id, title_en) values ('${prof.c1}','${"x".repeat(121)}')`);
  check("a 121-character programme title is refused", !!err && err.code === "23514");
  err = await F.svcErr(db, `insert into public.bible_programs (profile_id, title_en, description_en) values ('${prof.c1}','x','${"x".repeat(2001)}')`);
  check("a 2001-character description is refused", !!err && err.code === "23514");
  // the 400-session cap
  const big = P(21);
  await F.svc(db, `insert into public.bible_programs (id, profile_id, title_en) values ('${big}','${prof.c1}','Big')`);
  await F.svc(db, `insert into public.bible_program_sessions (profile_id, program_id, position, title_en) select '${prof.c1}', '${big}', g, 'Day ' || g from generate_series(1, 400) g`);
  err = await sErr(`insert into public.bible_program_sessions (profile_id, program_id, position, title_en) values ('${prof.c1}','${big}',401,'one too many')`);
  check("a programme holds at most 400 sessions", !!err && /bible_session_limit/.test(err.msg), JSON.stringify(err));
  eq("...and 400 are there", (await rows(db, `select count(*)::int as n from public.bible_program_sessions where program_id = '${big}'`))[0].n, 400);
  // moving sessions: one statement, as the caller
  const mv = P(22);
  await F.svc(db, `insert into public.bible_programs (id, profile_id, title_en) values ('${mv}','${prof.c1}','Move me'); insert into public.bible_program_sessions (id, profile_id, program_id, position, title_en) values ('${SS(221)}','${prof.c1}','${mv}',1,'A'), ('${SS(222)}','${prof.c1}','${mv}',2,'B'), ('${SS(223)}','${prof.c1}','${mv}',3,'C')`);
  const order = async () => (await rows(db, `select string_agg(title_en, '' order by position) as o from public.bible_program_sessions where program_id = '${mv}'`))[0].o;
  let res = await S(db, bm).rpc("bible_session_move", { p_session_id: SS(223), p_direction: "up" });
  check("manage: moves a session of a draft programme up", !res.error && res.data === true && (await order()) === "ACB", JSON.stringify(res));
  res = await S(db, bm).rpc("bible_session_move", { p_session_id: SS(221), p_direction: "down" });
  check("manage: moves one down (swaps with its neighbour)", !res.error && res.data === true && (await order()) === "CAB", JSON.stringify(res));
  res = await S(db, bm).rpc("bible_session_move", { p_session_id: SS(223), p_direction: "up" });
  check("moving the first session up does nothing (false)", !res.error && res.data === false && (await order()) === "CAB");
  res = await S(db, bm).rpc("bible_session_move", { p_session_id: SS(222), p_direction: "down" });
  check("moving the last session down does nothing (false)", !res.error && res.data === false && (await order()) === "CAB");
  res = await S(db, bm).rpc("bible_session_move", { p_session_id: SS(222), p_direction: "sideways" });
  check("a bad direction is refused", !!res.error);
  res = await S(db, bv).rpc("bible_session_move", { p_session_id: SS(222), p_direction: "up" });
  check("view only: the move changes nothing", !res.error && res.data === false && (await order()) === "CAB", JSON.stringify(res));
  res = await S(db, u.stranger).rpc("bible_session_move", { p_session_id: SS(222), p_direction: "up" });
  check("a stranger: the move changes nothing", !res.error && res.data === false && (await order()) === "CAB");
  res = await S(db, u.owner2).rpc("bible_session_move", { p_session_id: SS(222), p_direction: "up" });
  check("another church's owner: the move changes nothing", !res.error && res.data === false && (await order()) === "CAB");
  res = await S(db, adminPub).rpc("bible_session_move", { p_session_id: SS(222), p_direction: "up" });
  check("a platform admin holding publish: the move changes nothing", !res.error && res.data === false && (await order()) === "CAB");
  await F.svc(db, `update public.bible_programs set status = 'published' where id = '${mv}'`);
  res = await S(db, bm).rpc("bible_session_move", { p_session_id: SS(222), p_direction: "up" });
  check("manage: the move of a LIVE programme's sessions changes nothing", !res.error && res.data === false && (await order()) === "CAB");
  res = await S(db, bp).rpc("bible_session_move", { p_session_id: SS(222), p_direction: "up" });
  check("publish: moves a session of a LIVE programme", !res.error && res.data === true && (await order()) === "CBA", JSON.stringify(res));
  await db.close();
}

// =================================================================================================================================================================
section = "E. enrolments and progress (the private data): ";
// =================================================================================================================================================================
{
  const db = await fresh();
  await seedProgram(db, 1); // published, 3 sessions
  await seedProgram(db, 2, { status: "draft" });
  await seedProgram(db, 3, { profile: prof.c2 });
  const enroll = (cust, prog_ = 1, profile = prof.c1) => F.svcErr(db, `insert into public.bible_enrollments (profile_id, program_id, customer_id) values ('${profile}','${P(prog_)}','${CU(cust)}')`);
  let err = await enroll(1);
  check("a visitor joins a published programme", err === null, JSON.stringify(err));
  err = await enroll(1);
  check("...but only once", !!err && err.code === "23505" && /bible_enrollments_program_customer_key/.test(err.msg), JSON.stringify(err));
  err = await enroll(2, 2);
  check("a draft programme cannot be joined", !!err && /bible_program_unavailable/.test(err.msg), JSON.stringify(err));
  err = await enroll(2, 3, prof.c2);
  check("a programme of another church is joinable only through its own church", err === null, JSON.stringify(err));
  err = await enroll(3, 3, prof.c1);
  check("an enrolment cannot name another church's programme (the guard, then the composite foreign key)", !!err && (err.code === "23503" || /bible_program_unavailable/.test(err.msg)), JSON.stringify(err));
  await db.exec("alter table public.bible_enrollments disable trigger bible_enrollments_guard_trg");
  err = await F.svcErr(db, `insert into public.bible_enrollments (profile_id, program_id, customer_id) values ('${prof.c1}','${P(3)}','${CU(3)}')`);
  check("...even with the guard out of the way, the composite foreign key alone refuses it", !!err && err.code === "23503", JSON.stringify(err));
  await db.exec("alter table public.bible_enrollments enable trigger bible_enrollments_guard_trg");
  err = await F.svcErr(db, `insert into public.bible_enrollments (profile_id, program_id, customer_id) values ('${prof.c1}','${P(1)}','${F.id("c", 799)}')`);
  check("an enrolment needs a real visitor", !!err && err.code === "23503");
  await F.svc(db, `update public.profiles set published = false where id = '${prof.c1}'`);
  err = await enroll(3);
  check("a programme whose church page is unpublished cannot be joined", !!err && /bible_program_unavailable/.test(err.msg), JSON.stringify(err));
  await F.svc(db, `update public.profiles set published = true where id = '${prof.c1}'`);
  err = await F.svcErr(db, `update public.bible_enrollments set customer_id = '${CU(4)}' where customer_id = '${CU(1)}'`);
  check("an enrolment can never be edited", !!err && /bible_enrollment_immutable/.test(err.msg), JSON.stringify(err));
  // progress
  const enr = (await rows(db, `select id::text as i from public.bible_enrollments where customer_id = '${CU(1)}' and program_id = '${P(1)}'`))[0].i;
  const tick = (session, program = 1, enrollment = enr) => F.svcErr(db, `insert into public.bible_session_progress (enrollment_id, program_id, session_id) values ('${enrollment}','${P(program)}','${SS(session)}')`);
  err = await tick(11);
  check("a visitor ticks a session of their programme", err === null, JSON.stringify(err));
  err = await tick(11);
  check("...once", !!err && err.code === "23505" && /bible_session_progress_enrollment_session_key/.test(err.msg), JSON.stringify(err));
  err = await tick(12);
  check("...and another session", err === null);
  await seedProgram(db, 5);
  err = await F.svcErr(db, `insert into public.bible_session_progress (enrollment_id, program_id, session_id) values ('${enr}','${P(1)}','${SS(51)}')`);
  check("a session of ANOTHER programme cannot be ticked on this enrolment (composite foreign key)", !!err && err.code === "23503", JSON.stringify(err));
  err = await F.svcErr(db, `insert into public.bible_session_progress (enrollment_id, program_id, session_id) values ('${enr}','${P(5)}','${SS(51)}')`);
  check("an enrolment cannot tick under another programme's id (composite foreign key)", !!err && err.code === "23503", JSON.stringify(err));
  err = await F.svcErr(db, `update public.bible_session_progress set completed_at = now() where session_id = '${SS(11)}'`);
  check("a tick can never be edited", !!err && /bible_progress_immutable/.test(err.msg), JSON.stringify(err));
  await F.svc(db, `update public.bible_programs set status = 'draft' where id = '${P(1)}'`);
  err = await tick(13);
  check("progress cannot be recorded in a programme that is no longer published", !!err && /bible_program_unavailable/.test(err.msg), JSON.stringify(err));
  check("...but the earlier ticks are kept (nothing was deleted by unpublishing)", (await rows(db, "select count(*)::int as n from public.bible_session_progress"))[0].n === 2);
  await F.svc(db, `update public.bible_programs set status = 'published' where id = '${P(1)}'`);
  err = await tick(13);
  check("republished: progress works again", err === null, JSON.stringify(err));
  // a programme with participants cannot be deleted
  err = await F.svcErr(db, `delete from public.bible_programs where id = '${P(1)}'`);
  check("a programme that has participants cannot be deleted", !!err && err.code === "23503" && /bible_enrollments_program_fk/.test(err.msg), JSON.stringify(err));
  check("...and nothing of it was lost", (await rows(db, "select count(*)::int as n from public.bible_programs where id = '" + P(1) + "'"))[0].n === 1 && (await rows(db, "select count(*)::int as n from public.bible_session_progress"))[0].n === 3);
  // the participant leaves
  await F.svc(db, `delete from public.bible_enrollments where id = '${enr}'`);
  eq("leaving removes the enrolment and every tick with it", [(await rows(db, "select count(*)::int as n from public.bible_enrollments where program_id = '" + P(1) + "'"))[0].n, (await rows(db, "select count(*)::int as n from public.bible_session_progress"))[0].n], [0, 0]);
  // a session is deleted: its ticks go, the enrolment stays
  await enroll(1);
  const enr2 = (await rows(db, `select id::text as i from public.bible_enrollments where customer_id = '${CU(1)}' and program_id = '${P(1)}'`))[0].i;
  await tick(11, 1, enr2); await tick(12, 1, enr2);
  await F.svc(db, `delete from public.bible_program_sessions where id = '${SS(11)}'`);
  eq("deleting a session removes its ticks, not the enrolment", [(await rows(db, "select count(*)::int as n from public.bible_session_progress"))[0].n, (await rows(db, "select count(*)::int as n from public.bible_enrollments where program_id = '" + P(1) + "'"))[0].n], [1, 1]);
  // erasing the visitor erases their data
  await F.svc(db, `delete from public.ringo_customers where id = '${CU(1)}'`);
  eq("deleting a visitor identity deletes their enrolments and progress", [(await rows(db, "select count(*)::int as n from public.bible_enrollments where customer_id = '" + CU(1) + "'"))[0].n, (await rows(db, "select count(*)::int as n from public.bible_session_progress"))[0].n], [0, 0]);
  // deleting the whole church works even with participants
  await enroll(2);
  const whole = await F.svcErr(db, `delete from public.profiles where id = '${prof.c1}'`);
  check("deleting the whole church profile still works (cascades; NO ACTION is checked afterwards)", whole === null, JSON.stringify(whole));
  eq("...and leaves no programme, session, enrolment or tick of it behind", (await rows(db, `select (select count(*) from public.bible_programs where profile_id = '${prof.c1}')::int + (select count(*) from public.bible_program_sessions where profile_id = '${prof.c1}')::int + (select count(*) from public.bible_enrollments where profile_id = '${prof.c1}')::int as n`))[0].n, 0);
  await db.close();
}

// =================================================================================================================================================================
section = "F. what staff may learn about participation (counts only): ";
// =================================================================================================================================================================
{
  const db = await fresh();
  await seedProgram(db, 1);
  const stats = (who) => S(db, who).rpc("bible_program_stats", { p_program_id: P(1) });
  let res = await stats(u.owner1);
  check("owner: zero participants", !res.error && res.data.enrolled === 0 && res.data.detailed === false && res.data.sessions.length === 3 && res.data.sessions.every((x) => x.completed === null), JSON.stringify(res));
  const join = async (c) => { await F.svc(db, `insert into public.bible_enrollments (profile_id, program_id, customer_id) values ('${prof.c1}','${P(1)}','${CU(c)}')`); return (await rows(db, `select id::text as i from public.bible_enrollments where customer_id = '${CU(c)}'`))[0].i; };
  const e1 = await join(1);
  await F.svc(db, `insert into public.bible_session_progress (enrollment_id, program_id, session_id) values ('${e1}','${P(1)}','${SS(11)}')`);
  res = await stats(u.owner1);
  check("one participant: the number enrolled is shown, the per-session numbers are WITHHELD (a cohort of 1 would identify them)", res.data.enrolled === 1 && res.data.detailed === false && res.data.sessions.every((x) => x.completed === null), JSON.stringify(res.data));
  const e2 = await join(2);
  res = await stats(u.owner1);
  check("two participants: still withheld", res.data.enrolled === 2 && res.data.sessions.every((x) => x.completed === null));
  const e3 = await join(3);
  await F.svc(db, `insert into public.bible_session_progress (enrollment_id, program_id, session_id) values ('${e2}','${P(1)}','${SS(11)}'), ('${e3}','${P(1)}','${SS(11)}'), ('${e3}','${P(1)}','${SS(12)}')`);
  res = await stats(u.owner1);
  eq("three participants: the numbers per session, in order, and nothing that names anyone", res.data.sessions.map((x) => [x.position, x.completed]), [[1, 3], [2, 1], [3, 0]]);
  check("...the answer holds no customer, enrolment or profile identifier", !/customer|enrollment|email|name/i.test(JSON.stringify(res.data)) && Object.keys(res.data).sort().join() === "detailed,enrolled,sessions");
  for (const [who, tag] of [[bv, "viewer"], [bm, "writer"], [bp, "publisher"]]) { res = await stats(who); check(`${tag}: gets the counts`, !res.error && res.data && res.data.enrolled === 3); }
  for (const [who, tag] of [[u.plain1, "staff without a Bible permission"], [u.mgr1, "a church administrator without the permission"], [u.stranger, "a stranger"], [u.owner2, "another church's owner"], [u.admin, "a platform admin with no relationship"], [adminPub, "a platform admin holding publish as a team member"], [u.viewer1, "a People viewer"]]) {
    res = await stats(who);
    check(`${tag}: gets nothing (null)`, !res.error && res.data === null, JSON.stringify(res));
  }
  res = await S(db, u.owner1).rpc("bible_program_stats", { p_program_id: F.id("8", 998) });
  check("an unknown programme gives null", !res.error && res.data === null);
  await db.close();
}

// =================================================================================================================================================================
section = "G. the Team grant guard covers the new permissions without any Phase 2A change: ";
// =================================================================================================================================================================
{
  const db = await fresh();
  const mk = (who, perms, k) => S(db, who).from("organization_roles").insert({ id: F.id("2", 800 + k), profile_id: prof.c1, key: `bb${k}`, name: `BB${k}`, permissions: `{${perms.join(",")}}` });
  let res = await mk(u.owner1, ["church.bible.publish", "church.bible.view"], 1);
  check("the owner can create a role holding the Bible permissions", !res.error, JSON.stringify(res.error));
  let k = 10;
  for (const p of ["church.bible.view", "church.bible.manage", "church.bible.publish"]) {
    res = await mk(u.mgr1, [p], ++k);
    check(`a church administrator (staff.manage) cannot create a role with ${p}`, !!res.error, JSON.stringify(res.error));
  }
  res = await mk(u.admin, ["church.bible.view"], 40);
  check("a platform admin cannot grant them", !!res.error, JSON.stringify(res.error));
  await db.close();
}

// =================================================================================================================================================================
section = "H. support scripts and re-runs: ";
// =================================================================================================================================================================
{
  const pre = await fresh({ withBi: false, extras: false });
  const p1 = (await pre.query(PRE)).rows;
  check("preflight: ten rows, all ok on a clean database", p1.length === 10 && p1.every((x) => x.ok === true), JSON.stringify(p1.filter((x) => x.ok !== true)));
  await pre.exec(MIG);
  const p2 = (await pre.query(PRE)).rows;
  check("preflight after applying: the 'does not exist yet' rows now fail (it is a BEFORE check)", p2.filter((x) => x.ok !== true).length >= 2);
  const v = (await pre.query(VER)).rows;
  check("verify: sixteen rows, all ok", v.length === 16 && v.every((x) => x.ok === true), JSON.stringify(v.filter((x) => x.ok !== true)));
  await F.svc(pre, `insert into public.bible_programs (id, profile_id, title_en) values ('${P(1)}','${prof.c1}','Keep'); insert into public.bible_program_sessions (profile_id, program_id, position, title_en) values ('${prof.c1}','${P(1)}',1,'Day 1')`);
  await pre.exec(MIG);
  eq("re-running the migration keeps the data", (await rows(pre, "select count(*)::int as n from public.bible_programs"))[0].n, 1);
  check("verify still passes after a re-run", (await pre.query(VER)).rows.every((x) => x.ok === true));
  let err = null; try { await pre.exec(ROLL); } catch (e) { err = String(e.message); await pre.exec("rollback").catch(() => {}); }
  check("rollback refuses while a row exists", !!err && /rollback refused/.test(err), err);
  eq("...and nothing was dropped", (await rows(pre, "select count(*)::int as n from public.bible_programs"))[0].n, 1);
  const sig = async (d) => JSON.stringify(await rows(d, "select proname, md5(pg_get_functiondef(oid)) as d from pg_proc where pronamespace = 'public'::regnamespace and (proname like 'church\\_%' or proname like 'team\\_church\\_%' or proname like 'daily\\_word%' or proname like 'ministry\\_%') order by 1"));
  const sigBefore = await sig(pre);
  await pre.exec(ROLL.replace("begin;", "begin;\nselect set_config('bible_programs.allow_data_loss', 'yes', true);"));
  check("rollback with explicit confirmation drops the four tables and the six functions", (await rows(pre, "select not exists (select 1 from pg_class where relname like 'bible\\_%' and relkind = 'r') and not exists (select 1 from pg_proc where proname like 'bible\\_%') as a"))[0].a === true);
  check("rollback left every Phase 2A / 3 / 4 function byte-for-byte unchanged", sigBefore === (await sig(pre)));
  eq("rollback left the roster and the visitors alone", [(await rows(pre, "select count(*)::int as n from public.church_members"))[0].n, (await rows(pre, "select count(*)::int as n from public.profiles"))[0].n], [10, 4]);
  await pre.exec(ROLL);
  check("rollback is safe to run again", true);
  await pre.exec(MIG);
  check("the migration can be applied again after a rollback", (await rows(pre, "select to_regclass('public.bible_programs') is not null as a"))[0].a === true);
  await pre.close();

  const foreign = await fresh({ withBi: false, extras: false });
  await foreign.exec("create table public.bible_programs (id int)");
  let e1 = null; try { await foreign.exec(MIG); } catch (e) { e1 = String(e.message); await foreign.exec("rollback").catch(() => {}); }
  check("the migration refuses to adopt an unmanaged table of the same name", !!e1 && /half-applied|not managed by this migration|already exist/.test(e1), e1);
  await foreign.close();
  const foreignFn = await fresh({ withBi: false, extras: false });
  await foreignFn.exec("create function public.bible_program_stats(uuid) returns jsonb language sql as $$ select null::jsonb $$");
  let e2 = null; try { await foreignFn.exec(MIG); } catch (e) { e2 = String(e.message); await foreignFn.exec("rollback").catch(() => {}); }
  check("...and an unmanaged function of the same name", !!e2 && /already exists/.test(e2), e2);
  await foreignFn.close();
  const no2a = new PGlite();
  let e3 = null; try { await no2a.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin; create schema auth; create table public.profiles (id uuid primary key, published boolean); create table public.users (id uuid primary key); create table public.ringo_customers (id uuid primary key); create function public.is_admin() returns boolean language sql as $$ select false $$;`); await no2a.exec(MIG); } catch (e) { e3 = String(e.message); await no2a.exec("rollback").catch(() => {}); }
  check("the migration refuses to run without Phase 2A", !!e3 && /Phase 2A|missing functions/.test(e3), e3);
  await no2a.close();

  const a = await fresh({ withBi: false, extras: false }); const b = await fresh({ extras: false });
  const fp = async (d) => JSON.stringify(await rows(d, `select (select jsonb_agg(proname || ':' || md5(pg_get_functiondef(oid)) order by proname) from pg_proc where pronamespace = 'public'::regnamespace and (proname like 'church\\_%' or proname like 'team\\_church\\_%' or proname like 'daily\\_word%' or proname like 'ministry\\_%' or proname in ('is_admin','has_org_permission','is_org_member'))) as f, (select jsonb_agg(polrelid::regclass::text || ':' || polname order by polrelid::regclass::text, polname) from pg_policy where polrelid::regclass::text in ('profiles','organization_roles','organization_members','ringo_customers','church_members','church_groups','church_group_members','church_leadership','daily_words','ministry_events','ministry_announcements')) as p`));
  check("applying the migration changes no Phase 2A / 3 / 4 / Team function and no other table's policy", (await fp(a)) === (await fp(b)));
  await a.close(); await b.close();
}

// =================================================================================================================================================================
section = "I. the migration text itself: ";
// =================================================================================================================================================================
{
  const code = MIG.replace(/--[^\n]*/g, "");
  const created = [...code.matchAll(/create (?:or replace )?(?:unique )?(table|function|trigger|index|policy)\s+(?:if not exists\s+)?(?:public\.)?([a-z_]+)/gi)].map((mm) => mm[2]);
  check("it creates only bible_* objects", created.length > 0 && created.every((x) => /^bible_/.test(x)), created.filter((x) => !/^bible_/.test(x)).join());
  check("it never alters or drops an existing object", !/alter table public\.(?!bible_)|drop (table|function|index) /i.test(code), "");
  check("it writes no row anywhere", !/(^|;)\s*(insert\s+into|update\s+public\.|delete\s+from)/im.test(code.replace(/update public\.bible_program_sessions set position[^;]*;/i, "")), "");
  check("the audit columns have no grant to anon or authenticated", !/grant [^;]*(created_by|updated_by|published_by)/i.test(code), "");
  check("the private tables are granted to the service role only", !/grant [^;]*on public\.(bible_enrollments|bible_session_progress) to (?!service_role)/i.test(code) && /grant all on public\.bible_enrollments to service_role/.test(code) && /grant all on public\.bible_session_progress to service_role/.test(code));
  check("no policy is created on the private tables", [...code.matchAll(/create policy \w+ on public\.(\w+)/gi)].every((m2) => ["bible_programs", "bible_program_sessions"].includes(m2[1])) && [...code.matchAll(/create policy/gi)].length === 16);
  check("there is no policy for PUBLIC and no grant to PUBLIC", ![...code.matchAll(/\bgrant\b[^;]*?\sto\s+([a-z_, ]+);/gi)].some((g) => /\bpublic\b/i.test(g[1])) && [...code.matchAll(/\bfor\s+(?:select|insert|update|delete)\s+to\s+([^\n]+)/gi)].every((p) => ["authenticated", "anon, authenticated"].includes(p[1].trim())));
  check("no church_ prefixed object is created (Phase 0 verify row 10)", !/create (table|index|function)[^\n]*\bchurch_/i.test(code));
  check("the three permissions are named exactly", /church\.bible\.view/.test(MIG) && /church\.bible\.manage/.test(MIG) && /church\.bible\.publish/.test(MIG));
  check("no Bible text is stored: only a typed reference column", !/scripture_text|verse|body_en/i.test(code));
  check("the visitor foreign key cascades (erasing a visitor erases their data)", /customer_id uuid not null references public\.ringo_customers\(id\) on delete cascade/.test(code));
  check("it is wrapped in one transaction", /^begin;/m.test(MIG) && /^commit;/m.test(MIG));
}

console.log(`\n${fail === 0 ? "OK" : "FAILED"}: ${pass} checks passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
