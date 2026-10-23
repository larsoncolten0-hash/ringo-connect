// Churches & Ministries Phase 8: the ministry_music_links migration, attacked OFFLINE (PGlite, synthetic data, no Supabase, no network).
//   Run:  node scripts/tests/ministryMusicDb.test.mjs
import fs from "fs";
import path from "path";
import * as F from "./churchFixtures.mjs";

const { PGlite } = await import(process.env.PGLITE_ENTRY || "@electric-sql/pglite");
const { u, prof, REPO } = F;
let pass = 0, fail = 0, section = "";
const check = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log("  FAIL:", `${section}${name}`, "|", String(detail).slice(0, 400)); } };
const eq = (name, a, b) => check(name, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8").replace(/\r\n/g, "\n");
const MIG = F.MU_MIG;
const SUP = "supabase/support/2027-01-01_ministry_music_links";
const PRE = read(`${SUP}.preflight.sql`), VER = read(`${SUP}.verify.sql`), ROLL = read(`${SUP}.rollback.sql`);

const U2 = (n) => F.id("c", 80 + n);
const mu = U2(1), viewOnly = U2(2), adminMgr = U2(3);
const R2 = (n) => F.id("b", 80 + n);
const r = { manage: R2(1), other: R2(2), adminMgr: R2(3) };
const L = (k) => F.id("6", 300 + k);

async function fresh({ withMu = true, extras = true } = {}) {
  const db = await F.newDb(PGlite, { music: withMu });
  await F.seed(db);
  if (extras) await F.svc(db, `
    insert into public.users (id, role, plan_id) values ('${mu}','user','${F.plan.free}'), ('${viewOnly}','user','${F.plan.free}'), ('${adminMgr}','admin','${F.plan.free}');
    insert into public.organization_roles (id, profile_id, key, name, permissions) values
      ('${r.manage}','${prof.c1}','mmanage','Music manager','{church.music.manage}'),
      ('${r.other}','${prof.c1}','mother','Members viewer','{church.members.view}'),
      ('${r.adminMgr}','${prof.c1}','madmin','Platform admin holding music','{church.music.manage}');
    insert into public.organization_members (profile_id, user_id, role_id) values ('${prof.c1}','${mu}','${r.manage}'), ('${prof.c1}','${viewOnly}','${r.other}'), ('${prof.c1}','${adminMgr}','${r.adminMgr}');
  `);
  return db;
}
const rows = (db, sql) => F.svcQuery(db, sql);
const S = (db, who) => F.sessionFor(db, who);
const Ml = (db, who) => S(db, who).from("ministry_music_links");
let n = 0;
const link = (o = {}) => ({ id: F.id("6", 400 + ++n), profile_id: prof.c1, platform: "spotify", title: "Sunday worship", url: `https://open.spotify.com/playlist/${n}`, ...o });
const code = (x) => x && x.error && x.error.code;

section = "A. structure and grants: ";
{
  const db = await fresh();
  for (const k of ["select", "insert", "update", "delete", "truncate", "references", "trigger"]) {
    check(`anon has no table-level ${k}`, (await rows(db, `select has_table_privilege('anon','public.ministry_music_links','${k}') as b`))[0].b === false);
    check(`PUBLIC has no ${k}`, (await rows(db, `select has_table_privilege('public','public.ministry_music_links','${k}') as b`))[0].b === false);
  }
  for (const k of ["insert", "update"]) check(`anon has no column-level ${k}`, (await rows(db, `select has_any_column_privilege('anon','public.ministry_music_links','${k}') as b`))[0].b === false);
  for (const c of ["created_by", "updated_by"]) for (const k of ["select", "insert", "update"]) {
    check(`authenticated cannot ${k} ${c}`, (await rows(db, `select has_column_privilege('authenticated','public.ministry_music_links','${c}','${k}') as b`))[0].b === false);
    check(`anon cannot ${k} ${c}`, (await rows(db, `select has_column_privilege('anon','public.ministry_music_links','${c}','${k}') as b`))[0].b === false);
  }
  check("authenticated cannot update profile_id", (await rows(db, `select has_column_privilege('authenticated','public.ministry_music_links','profile_id','update') as b`))[0].b === false);
  for (const k of ["truncate", "references", "trigger"]) check(`authenticated cannot ${k}`, (await rows(db, `select has_table_privilege('authenticated','public.ministry_music_links','${k}') as b`))[0].b === false);
  check("row-level security is on and no policy is for PUBLIC", (await rows(db, `select relrowsecurity as b from pg_class where oid = 'public.ministry_music_links'::regclass`))[0].b === true && (await rows(db, `select count(*)::int as n from pg_policy where polrelid = 'public.ministry_music_links'::regclass and polroles = array[0::oid]`))[0].n === 0);
  eq("5 permissive + 3 restrictive policies", (await rows(db, `select count(*) filter (where polpermissive)::int as p, count(*) filter (where not polpermissive)::int as r from pg_policy where polrelid = 'public.ministry_music_links'::regclass`))[0], { p: 5, r: 3 });
  check("the guard function is not callable by anon / authenticated / PUBLIC", (await rows(db, `select (has_function_privilege('anon','public.ministry_music_link_guard()','execute') or has_function_privilege('authenticated','public.ministry_music_link_guard()','execute') or has_function_privilege('public','public.ministry_music_link_guard()','execute')) as b`))[0].b === false);
  const sel = await Ml(db, u.owner1).select("created_by");
  check("even the owner cannot read created_by through the API", code(sel) === "42501", JSON.stringify(sel.error));
  await db.close();
}

section = "B. staff access: ";
{
  const db = await fresh();
  const own = await Ml(db, u.owner1).insert(link({ id: L(1) }));
  check("the owner can add a link", !own.error, JSON.stringify(own.error));
  const mg = await Ml(db, mu).insert(link({ id: L(2), platform: "youtube", url: "https://www.youtube.com/@choir" }));
  check("a member holding church.music.manage can add a link", !mg.error, JSON.stringify(mg.error));
  const vo = await Ml(db, viewOnly).insert(link());
  check("a member without the permission cannot add (RLS)", !!vo.error && code(vo) === "42501", JSON.stringify(vo.error));
  const st = await Ml(db, u.stranger).insert(link());
  check("a stranger cannot add", !!st.error);
  const an = await Ml(db, null).insert(link());
  check("anon cannot add", !!an.error);
  const adm = await Ml(db, adminMgr).insert(link());
  check("a platform admin who is not the owner cannot add, even holding the role", !!adm.error, JSON.stringify(adm.error));
  const other = await Ml(db, u.owner2).insert(link({ profile_id: prof.c1 }));
  check("another church's owner cannot add to this church", !!other.error);
  const mine = await Ml(db, mu).select("id");
  eq("the manager sees exactly this church's links", (mine.data || []).map((x) => x.id).sort(), [L(1), L(2)].sort());
  const upd = await Ml(db, mu).update({ title: "Renamed" }).eq("id", L(1)).select("id");
  eq("the manager can edit a link", (upd.data || []).length, 1);
  const updV = await Ml(db, viewOnly).update({ title: "Hacked" }).eq("id", L(1)).select("id");
  eq("a member without the permission edits nothing", (updV.data || []).length, 0);
  const updA = await Ml(db, adminMgr).update({ title: "Hacked" }).eq("id", L(1)).select("id");
  eq("a non-owner platform admin edits nothing", (updA.data || []).length, 0);
  const delV = await Ml(db, viewOnly).delete().eq("id", L(1)).select("id");
  eq("a member without the permission deletes nothing", (delV.data || []).length, 0);
  const del = await Ml(db, mu).delete().eq("id", L(2)).select("id");
  eq("the manager can delete a link", (del.data || []).length, 1);
  const mv = await Ml(db, u.owner1).update({ profile_id: prof.c3 }).eq("id", L(1));
  check("profile_id cannot be updated through the API", !!mv.error, JSON.stringify(mv.error));
  const aud = await Ml(db, u.owner1).insert(link({ created_by: u.stranger }));
  check("created_by cannot be supplied by a client", !!aud.error);
  eq("the audit columns came from the caller", (await rows(db, `select created_by, updated_by from public.ministry_music_links where id = '${L(1)}'`))[0], { created_by: u.owner1, updated_by: mu });
  await db.close();
}

section = "C. public read: ";
{
  const db = await fresh();
  await F.svc(db, `
    insert into public.ministry_music_links (id, profile_id, platform, title, url, is_visible) values
      ('${L(11)}','${prof.c1}','spotify','Visible','https://open.spotify.com/a', true),
      ('${L(12)}','${prof.c1}','spotify','Hidden','https://open.spotify.com/b', false);
    update public.profiles set published = false where id = '${prof.c3}';
    insert into public.ministry_music_links (id, profile_id, platform, title, url, is_visible) values ('${L(13)}','${prof.c3}','spotify','Unpublished church','https://open.spotify.com/c', true);`);
  const anon = await Ml(db, null).select("id,title,url");
  eq("anon sees only the visible link of a published church", (anon.data || []).map((x) => x.id), [L(11)]);
  const anonHidden = await Ml(db, null).select("id").eq("id", L(12));
  eq("a hidden link is never public", (anonHidden.data || []).length, 0);
  const stranger = await Ml(db, u.stranger).select("id");
  eq("a signed-in stranger sees the same public set", (stranger.data || []).map((x) => x.id), [L(11)]);
  const mgr = await Ml(db, mu).select("id");
  eq("the manager also sees the hidden link", (mgr.data || []).map((x) => x.id).sort(), [L(11), L(12)].sort());
  const star = await Ml(db, null).select("*");
  check("select * for anon is refused (audit columns have no grant)", code(star) === "42501", JSON.stringify(star.error));
  await db.close();
}

section = "D. data rules: ";
{
  const db = await fresh();
  const bad = async (name, o) => { const x = await Ml(db, u.owner1).insert(link(o)); check(name, !!x.error && ["23514", "23505"].includes(code(x)), JSON.stringify(x.error)); };
  await bad("http (not https) is refused", { url: "http://open.spotify.com/x" });
  await bad("javascript: is refused", { url: "javascript:alert(1)" });
  await bad("data: is refused", { url: "data:text/html;base64,AAAA" });
  await bad("credentials in the address are refused", { url: "https://user:pw@open.spotify.com/x" });
  await bad("a space is refused", { url: "https://open.spotify.com/a b" });
  await bad("no dot in the host is refused", { url: "https://localhost/x" });
  await bad("over 500 characters is refused", { url: "https://open.spotify.com/" + "a".repeat(500) });
  await bad("an unknown platform is refused", { platform: "napster" });
  await bad("an empty label is refused", { title: "   " });
  await bad("a label over 80 characters is refused", { title: "x".repeat(81) });
  await bad("sort_order out of range is refused", { sort_order: 5000 });
  const ok1 = await Ml(db, u.owner1).insert(link({ id: L(21), url: "https://open.spotify.com/Same" }));
  check("a valid link is accepted", !ok1.error, JSON.stringify(ok1.error));
  await bad("the same address twice (case-insensitive) is refused", { url: "https://OPEN.spotify.com/same" });
  const nc = await Ml(db, u.ownerNC).insert(link({ profile_id: prof.nc }));
  check("a profile that is not a church cannot hold links", !!nc.error, JSON.stringify(nc.error));
  await F.svc(db, `delete from public.ministry_music_links where profile_id = '${prof.c1}'`);
  for (let i = 0; i < 20; i++) await F.svc(db, `insert into public.ministry_music_links (profile_id, platform, title, url) values ('${prof.c1}','website','L${i}','https://example.org/${i}')`);
  const over = await F.svcErr(db, `insert into public.ministry_music_links (profile_id, platform, title, url) values ('${prof.c1}','website','L21','https://example.org/21')`);
  check("the 21st link is refused, even for the service role", !!over && /music_link_limit/.test(over.msg), JSON.stringify(over));
  const move = await F.svcErr(db, `update public.ministry_music_links set profile_id = '${prof.c3}' where profile_id = '${prof.c1}'`);
  check("a link cannot be moved to another church, even by the service role", !!move && /music_tenant_immutable/.test(move.msg), JSON.stringify(move));
  await db.close();
}

section = "E. cascade and isolation: ";
{
  const db = await fresh();
  await F.svc(db, `insert into public.ministry_music_links (id, profile_id, platform, title, url) values ('${L(31)}','${prof.c1}','website','A','https://example.org/a'), ('${L(32)}','${prof.c2}','website','B','https://example.org/b')`);
  const o2 = await Ml(db, u.owner2).select("id");
  eq("each owner sees only their own church's links (plus public ones)", (o2.data || []).map((x) => x.id).sort(), [L(31), L(32)].sort());
  const cross = await Ml(db, u.owner2).update({ title: "x" }).eq("id", L(31)).select("id");
  eq("owner 2 cannot edit church 1's link", (cross.data || []).length, 0);
  await F.svc(db, `delete from public.profiles where id = '${prof.c2}'`);
  eq("deleting a profile removes its links", (await rows(db, `select count(*)::int as n from public.ministry_music_links where profile_id = '${prof.c2}'`))[0].n, 0);
  await db.close();
}

section = "F. support scripts and re-runs: ";
{
  const pre = await fresh({ withMu: false, extras: false });
  const p1 = (await pre.query(PRE)).rows;
  check("preflight: ten rows, all ok before the migration", p1.length === 10 && p1.every((x) => x.ok === true), JSON.stringify(p1.filter((x) => x.ok !== true)));
  await pre.exec(MIG);
  check("preflight after applying: the 'does not exist yet' rows fail (it is a BEFORE check)", (await pre.query(PRE)).rows.filter((x) => x.ok !== true).length >= 2);
  const v = (await pre.query(VER)).rows;
  check("verify: fifteen rows, all ok", v.length === 15 && v.every((x) => x.ok === true), JSON.stringify(v.filter((x) => x.ok !== true)));
  await F.svc(pre, `insert into public.ministry_music_links (profile_id, platform, title, url) values ('${prof.c1}','website','A','https://example.org/a')`);
  await pre.exec(MIG);
  eq("re-running the migration keeps the data", (await rows(pre, "select count(*)::int as n from public.ministry_music_links"))[0].n, 1);
  check("verify still passes after a re-run", (await pre.query(VER)).rows.every((x) => x.ok === true));
  let err = null; try { await pre.exec(ROLL); } catch (e) { err = String(e.message); await pre.exec("rollback").catch(() => {}); }
  check("rollback refuses while a row exists", !!err && /rollback refused/.test(err), err);
  eq("...and nothing was dropped", (await rows(pre, "select count(*)::int as n from public.ministry_music_links"))[0].n, 1);
  await pre.exec(ROLL.replace("begin;", "begin;\nselect set_config('ministry_music.allow_data_loss', 'yes', true);"));
  check("rollback with explicit confirmation drops the table and the function", (await rows(pre, "select to_regclass('public.ministry_music_links') is null and (select count(*) from pg_proc where proname like 'ministry\\_music%') = 0 as a"))[0].a === true);
  await pre.exec(ROLL);
  check("rollback is safe to run again", true);
  await pre.exec(MIG);
  check("the migration can be applied again after a rollback", (await rows(pre, "select to_regclass('public.ministry_music_links') is not null as a"))[0].a === true);
  await pre.close();

  const a = await fresh({ withMu: false, extras: false }); const b = await fresh({ extras: false });
  const fp = async (d) => JSON.stringify(await rows(d, `select (select jsonb_agg(proname || ':' || md5(pg_get_functiondef(oid)) order by proname) from pg_proc where pronamespace = 'public'::regnamespace and (proname like 'church\\_%' or proname like 'team\\_church\\_%' or proname in ('is_admin','has_org_permission','is_org_member'))) as f, (select jsonb_agg(polrelid::regclass::text || ':' || polname order by polrelid::regclass::text, polname) from pg_policy where polrelid::regclass::text in ('profiles','organization_roles','organization_members','church_members','church_groups','church_group_members','church_leadership')) as p`));
  check("applying the migration changes no Phase 2A / Team function and no other table's policy", (await fp(a)) === (await fp(b)));
  await a.close(); await b.close();

  const foreign = await fresh({ withMu: false, extras: false });
  await foreign.exec(`create table public.ministry_music_links (id uuid primary key)`);
  let e4 = null; try { await foreign.exec(MIG); } catch (e) { e4 = String(e.message); await foreign.exec("rollback").catch(() => {}); }
  check("the migration refuses to adopt a same-named table it does not manage", !!e4 && /not managed by this migration/.test(e4), e4);
  await foreign.close();
}

section = "G. the migration text itself: ";
{
  const c = MIG.replace(/--[^\n]*/g, "");
  const created = [...c.matchAll(/create (?:or replace )?(?:unique )?(table|function|trigger|index|policy)\s+(?:if not exists\s+)?(?:public\.)?([a-z_]+)/gi)].map((mm) => mm[2]);
  check("it creates only ministry_music* objects", created.length > 0 && created.every((x) => /^ministry_music/.test(x)), created.filter((x) => !/^ministry_music/.test(x)).join());
  check("it never alters or drops an existing object", !/alter table public\.(?!ministry_music)|drop (table|function|index) /i.test(c));
  check("it writes no row anywhere", !/(^|;)\s*(insert\s+into|update\s+public\.|delete\s+from)/im.test(c));
  check("created_by / updated_by have no grant", !/grant [^;]*(created_by|updated_by)/i.test(c));
  check("the permission is named exactly", /church\.music\.manage/.test(MIG));
  check("it is wrapped in one transaction", /^begin;/m.test(MIG) && /^commit;/m.test(MIG));
}

console.log(`\n${fail === 0 ? "OK" : "FAILED"}: ${pass} checks passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
