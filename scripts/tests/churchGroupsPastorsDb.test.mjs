// Churches & Ministries Phase 3: the 2027-01-05_church_groups_pastors migration (public groups, group photos, group-only announcements, pastors, about), attacked OFFLINE
// (PGlite, synthetic data, no Supabase, no network).
//   * the preflight is all-true before, the verify all-true after, the migration is re-runnable, and the rollback refuses while rows exist;
//   * the public reads only PUBLISHED rows of a PUBLISHED church and only the display columns (never the roster link, never an audit column), and writes nothing;
//   * a children group can carry photos but never a caption; a group shows at most 12 photos; a church has one group of each kind and its kind never changes;
//   * a group-only announcement must name a public group of the SAME church;
//   * writes need church.groups.manage (groups, photos) or church.pastors.manage (pastors, about); a platform admin who does not own the church is refused; another church is untouchable.
//   Run:  node scripts/tests/churchGroupsPastorsDb.test.mjs
import fs from "fs";
import path from "path";
import * as F from "./churchFixtures.mjs";

const { PGlite } = await import(process.env.PGLITE_ENTRY || "@electric-sql/pglite");
const { u, prof, REPO, g } = F;
let pass = 0, fail = 0, section = "";
const check = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log("  FAIL:", `${section}${name}`, "|", String(detail).slice(0, 400)); } };
const eq = (name, a, b) => check(name, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8").replace(/\r\n/g, "\n");
const MIG = F.GP_MIG;
const SUP = "supabase/support/2027-01-05_church_groups_pastors";
const PRE = read(`${SUP}.preflight.sql`), VER = read(`${SUP}.verify.sql`), ROLL = read(`${SUP}.rollback.sql`);

const rows = (db, sql) => F.svcQuery(db, sql);
const S = (db, who) => F.sessionFor(db, who);
const code = (x) => x && x.error && x.error.code;
const attempt = async (db, sql) => { try { await db.exec(sql); return null; } catch (e) { try { await db.exec("rollback"); } catch { /* nothing to roll back */ } return String(e.message); } };
const allOk = (r) => r.length > 0 && r.every((x) => x.ok === true);
const IMG = "https://example.supabase.co/storage/v1/object/public/uploads/u1/church/a1b2c3.jpg";
const PASTOR_ROLE = "d1000000-0000-4000-8000-000000000001", PASTOR_USER = "c1000000-0000-4000-8000-000000000001";

async function fresh({ groupsPastors = true } = {}) {
  const db = await F.newDb(PGlite, { dailyWords: true, events: true, attendance: true, bible: true, music: true, care: true, testimonies: true, landing: true, groupsPastors });
  await F.seed(db);
  // a pastor-page manager: the permission is owner-only to GRANT, so the fixture writes the role as the database owner would after the church owner granted it
  await F.svc(db, `insert into public.users (id, role, plan_id) values ('${PASTOR_USER}','user','${F.plan.free}');
    insert into public.organization_roles (id, profile_id, key, name, permissions) values ('${PASTOR_ROLE}','${prof.c1}','pastormgr','Pastor page manager','{church.pastors.manage}');
    insert into public.organization_members (profile_id, user_id, role_id) values ('${prof.c1}','${PASTOR_USER}','${PASTOR_ROLE}')`);
  return db;
}
const addGroup = async (db, kind, o = {}) => {
  const r = await F.svc(db, `insert into public.church_public_groups (profile_id, kind, leader_name, description_en, is_published) values ('${o.profile || prof.c1}','${kind}','Pastor Joy','Welcome','${o.published === false ? "false" : "true"}') returning id`);
  return (await rows(db, `select id from public.church_public_groups where profile_id = '${o.profile || prof.c1}' and kind = '${kind}'`))[0].id;
};

// ---------------------------------------------------------------- A. preflight, apply, verify, re-run, rollback
section = "A. preflight, apply, verify, re-run, rollback: ";
{
  const before = await fresh({ groupsPastors: false });
  const pre = await rows(before, PRE);
  check("the preflight is all true BEFORE the migration (clean first run)", allOk(pre), JSON.stringify(pre.filter((x) => !x.ok)));
  check("the preflight is READ-ONLY", /^with\b/m.test(PRE.replace(/^--.*$/gm, "").trim()) && !/^\s*(insert|update|delete|drop|alter|create|grant|revoke|truncate)\b/im.test(PRE.replace(/^--.*$/gm, "")));
  await before.exec(MIG);
  const after = await rows(before, VER);
  check("the verify is all true AFTER the migration", allOk(after), JSON.stringify(after.filter((x) => !x.ok)));
  check("the verify is READ-ONLY", /^with\b/m.test(VER.replace(/^--.*$/gm, "").trim()) && !/^\s*(insert|update|delete|drop|alter|create|grant|revoke|truncate)\b/im.test(VER.replace(/^--.*$/gm, "")));
  const reRun = await attempt(before, MIG);
  check("the migration is re-runnable", reRun === null, reRun);
  check("the verify is still all true after the re-run", allOk(await rows(before, VER)));
  check("the preflight now reports the objects as present", (await rows(before, PRE)).some((x) => !x.ok));
  const broken = await fresh({ groupsPastors: false });
  await broken.exec("alter table public.church_groups rename to church_groups_gone");
  check("the migration refuses when an earlier table is missing", (await attempt(broken, MIG)) !== null);
  const noImg = await fresh({ groupsPastors: false });
  await noImg.exec("alter table public.ministry_announcements drop column image_url");
  check("the migration refuses when Phase 2 was not applied", (await attempt(noImg, MIG)) !== null);

  // rollback: refuses with data, runs without, and leaves the earlier phases intact
  const db = await fresh();
  const gid = await addGroup(db, "men");
  const refused = await attempt(db, ROLL);
  check("the rollback REFUSES while a row exists", refused !== null && /rollback refused/.test(refused), refused);
  check("a refused rollback changed nothing", (await rows(db, "select count(*)::int n from public.church_public_groups"))[0].n === 1);
  const forced = await attempt(db, ROLL.replace("begin;", "begin;\nselect set_config('church_phase3.allow_data_loss', 'yes', true);"));
  check("the rollback runs once the loss is confirmed", forced === null, forced);
  check("the rollback leaves no table, column or function behind",
    (await rows(db, "select count(*)::int n from information_schema.tables where table_schema='public' and table_name in ('church_public_groups','church_group_photos','church_pastors','church_about')"))[0].n === 0
    && (await rows(db, "select count(*)::int n from information_schema.columns where table_name='ministry_announcements' and column_name='public_group_id'"))[0].n === 0);
  check("the earlier phases still work after the rollback (announcements readable)", (await rows(db, "select count(*)::int n from public.ministry_announcements"))[0].n >= 0);
  const empty = await fresh();
  check("the rollback runs without confirmation when nothing was stored", (await attempt(empty, ROLL)) === null);
  check("the migration can be applied again after a rollback", (await attempt(empty, MIG)) === null);
  void gid;
}

// ---------------------------------------------------------------- B. what the public can and cannot do
section = "B. public access: ";
{
  const db = await fresh();
  const men = await addGroup(db, "men"), women = await addGroup(db, "women", { published: false });
  await F.svc(db, `insert into public.church_group_photos (profile_id, public_group_id, image_url, caption_en) values ('${prof.c1}','${men}','${IMG}','Retreat'), ('${prof.c1}','${women}','${IMG}','Hidden')`);
  await F.svc(db, `insert into public.church_pastors (profile_id, name, is_published, bio_en) values ('${prof.c1}','Pastor Pub',true,'Bio'), ('${prof.c1}','Pastor Draft',false,'Bio')`);
  await F.svc(db, `insert into public.church_about (profile_id, vision_en, is_published) values ('${prof.c1}','Our vision',true)`);
  const anon = S(db, null);
  eq("anon sees the published group and not the hidden one", ((await anon.from("church_public_groups").select("kind")).data || []).map((r) => r.kind), ["men"]);
  eq("anon sees the photos of the published group only", ((await anon.from("church_group_photos").select("caption_en")).data || []).map((r) => r.caption_en), ["Retreat"]);
  eq("anon sees the published pastor and not the draft", ((await anon.from("church_pastors").select("name")).data || []).map((r) => r.name), ["Pastor Pub"]);
  eq("anon sees the published vision", ((await anon.from("church_about").select("vision_en")).data || []).map((r) => r.vision_en), ["Our vision"]);
  for (const [t, c] of [["church_public_groups", "roster_group_id"], ["church_public_groups", "created_by"], ["church_group_photos", "created_by"], ["church_pastors", "created_by"], ["church_about", "updated_by"]]) {
    const r = await anon.from(t).select(c);
    check(`anon CANNOT read ${t}.${c}`, !!r.error && code(r) === "42501", JSON.stringify(r));
  }
  for (const [t, patch, idCol, idVal] of [["church_public_groups", { leader_name: "Evil" }, "id", men], ["church_pastors", { name: "Evil" }, "name", "Pastor Pub"], ["church_about", { vision_en: "Evil" }, "is_published", true]]) {
    const w = await anon.from(t).update(patch).eq(idCol, idVal);
    const after = await rows(db, `select count(*)::int n from public.${t} where ${Object.keys(patch)[0]} = 'Evil'`);
    check(`anon cannot change ${t}`, !!w.error || after[0].n === 0);
  }
  const ins = await anon.from("church_pastors").insert({ profile_id: prof.c1, name: "Intruder" });
  check("anon cannot insert a pastor", !!ins.error);
  await F.svc(db, `update public.profiles set published = false where id = '${prof.c1}'`);
  eq("when the church page is unpublished NOTHING is public", [
    ((await anon.from("church_public_groups").select("kind")).data || []).length, ((await anon.from("church_group_photos").select("id")).data || []).length,
    ((await anon.from("church_pastors").select("id")).data || []).length, ((await anon.from("church_about").select("profile_id")).data || []).length], [0, 0, 0, 0]);
}

// ---------------------------------------------------------------- C. integrity rules
section = "C. integrity: ";
{
  const db = await fresh();
  const kids = await addGroup(db, "children"), men = await addGroup(db, "men");
  const dup = await F.svcErr(db, `insert into public.church_public_groups (profile_id, kind) values ('${prof.c1}','men')`);
  check("a church has only one group of each kind", dup && dup.code === "23505", JSON.stringify(dup));
  const bad = await F.svcErr(db, `insert into public.church_public_groups (profile_id, kind) values ('${prof.c1}','elders')`);
  check("only the four kinds exist", bad && bad.code === "23514", JSON.stringify(bad));
  const kindChange = await F.svcErr(db, `update public.church_public_groups set kind = 'women' where id = '${men}'`);
  check("the kind of a group never changes", kindChange && kindChange.code === "23514", JSON.stringify(kindChange));
  const move = await F.svcErr(db, `update public.church_public_groups set profile_id = '${prof.c2}' where id = '${men}'`);
  check("a group cannot be moved to another church", move && move.code === "42501", JSON.stringify(move));
  const nonChurch = await F.svcErr(db, `insert into public.church_pastors (profile_id, name) values ('${prof.nc}','X')`);
  check("rows cannot be created for a profile that is not a church", nonChurch && nonChurch.code === "23514", JSON.stringify(nonChurch));
  const capt = await F.svcErr(db, `insert into public.church_group_photos (profile_id, public_group_id, image_url, caption_en) values ('${prof.c1}','${kids}','${IMG}','Little Sam')`);
  check("a photo of the CHILDREN group cannot carry a caption", capt && capt.code === "23514", JSON.stringify(capt));
  const captFr = await F.svcErr(db, `insert into public.church_group_photos (profile_id, public_group_id, image_url, caption_fr) values ('${prof.c1}','${kids}','${IMG}','Petit Sam')`);
  check("...in French either", captFr && captFr.code === "23514", JSON.stringify(captFr));
  check("a children photo WITHOUT a caption is fine", (await F.svcErr(db, `insert into public.church_group_photos (profile_id, public_group_id, image_url) values ('${prof.c1}','${kids}','${IMG}')`)) === null);
  const addCaptionLater = await F.svcErr(db, `update public.church_group_photos set caption_en = 'Name' where public_group_id = '${kids}'`);
  check("a caption cannot be added to a children photo later", addCaptionLater && addCaptionLater.code === "23514", JSON.stringify(addCaptionLater));
  for (let i = 0; i < 12; i++) await F.svc(db, `insert into public.church_group_photos (profile_id, public_group_id, image_url) values ('${prof.c1}','${men}','${IMG}')`);
  const over = await F.svcErr(db, `insert into public.church_group_photos (profile_id, public_group_id, image_url) values ('${prof.c1}','${men}','${IMG}')`);
  check("a group shows at most 12 photos", over && over.code === "23514", JSON.stringify(over));
  const crossPhoto = await F.svcErr(db, `insert into public.church_group_photos (profile_id, public_group_id, image_url) values ('${prof.c2}','${men}','${IMG}')`);
  check("a photo cannot attach to another church's group", !!crossPhoto, JSON.stringify(crossPhoto));
  for (const bad of ["http://example.com/a.jpg", "javascript:alert(1)", "https://x", "https://exa mple.com/a.jpg"]) {
    const e = await F.svcErr(db, `insert into public.church_pastors (profile_id, name, photo_url) values ('${prof.c1}','P','${bad}')`);
    check(`a pastor photo address of the wrong shape is refused (${bad})`, e && e.code === "23514", JSON.stringify(e));
  }
  const long = await F.svcErr(db, `insert into public.church_pastors (profile_id, name, bio_en) values ('${prof.c1}','P','${"x".repeat(3001)}')`);
  check("a biography has a size limit", long && long.code === "23514");
  // announcements addressed to a group
  const own = await F.svcErr(db, `insert into public.ministry_announcements (profile_id, status, title_en, body_en, public_group_id) values ('${prof.c1}','published','T','B','${men}')`);
  check("a group-only announcement of the same church is accepted", own === null, JSON.stringify(own));
  const c2g = await addGroup(db, "men", { profile: prof.c2 }).catch(() => null);
  void c2g;
  const cross = await F.svcErr(db, `insert into public.ministry_announcements (profile_id, status, title_en, body_en, public_group_id) values ('${prof.c1}','draft','T','B','${(await rows(db, `select id from public.church_public_groups where profile_id = '${prof.c2}' limit 1`))[0]?.id || "00000000-0000-4000-8000-000000000000"}')`);
  check("a group-only announcement cannot name another church's group", !!cross, JSON.stringify(cross));
  const published = (await rows(db, `select id from public.ministry_announcements where public_group_id = '${men}'`))[0].id;
  const moveLive = await F.svcErr(db, `update public.ministry_announcements set public_group_id = null where id = '${published}'`);
  check("a LIVE notice cannot be moved to another audience", moveLive && moveLive.code === "23514", JSON.stringify(moveLive));
  await F.svc(db, `delete from public.church_public_groups where id = '${men}'`);
  check("deleting a group deletes the notices addressed to it (never turns them church-wide)", (await rows(db, "select count(*)::int n from public.ministry_announcements where public_group_id is null and title_en = 'T'"))[0].n === 0);
}

// ---------------------------------------------------------------- D. who may write
section = "D. permissions: ";
{
  const db = await fresh();
  const men = await addGroup(db, "men");
  const owner = S(db, u.owner1), grpMgr = S(db, u.grpMgr1), viewer = S(db, u.viewer1), stranger = S(db, u.stranger), pastorMgr = S(db, PASTOR_USER), admin = S(db, u.admin), owner2 = S(db, u.owner2);
  const ok = async (label, p) => { const r = await p; check(label, !r.error, JSON.stringify(r.error)); return r; };
  await ok("the owner creates a public group", owner.from("church_public_groups").insert({ profile_id: prof.c1, kind: "women", leader_name: "Mama Ruth", description_en: "Hello" }));
  await ok("a groups manager edits a public group", grpMgr.from("church_public_groups").update({ leader_name: "Mama Ruth 2" }).eq("kind", "women"));
  eq("...and the change is stored", (await rows(db, "select leader_name from public.church_public_groups where kind = 'women' and profile_id = '" + prof.c1 + "'"))[0].leader_name, "Mama Ruth 2");
  await ok("a groups manager adds a photo", grpMgr.from("church_group_photos").insert({ profile_id: prof.c1, public_group_id: men, image_url: IMG }));
  const v = await viewer.from("church_public_groups").update({ leader_name: "No" }).eq("kind", "women");
  check("a members-only viewer cannot edit a public group", (await rows(db, "select leader_name from public.church_public_groups where kind='women'"))[0].leader_name !== "No");
  void v;
  check("a groups manager cannot write a pastor (different permission)", !!(await grpMgr.from("church_pastors").insert({ profile_id: prof.c1, name: "No" })).error);
  await ok("a pastor-page manager writes a pastor", pastorMgr.from("church_pastors").insert({ profile_id: prof.c1, name: "Pastor Sam", bio_en: "Bio" }));
  await ok("...and the vision/mission", pastorMgr.from("church_about").insert({ profile_id: prof.c1, vision_en: "V", mission_en: "M", is_published: true }));
  check("a pastor-page manager cannot touch the public groups", !!(await pastorMgr.from("church_public_groups").insert({ profile_id: prof.c1, kind: "youths" })).error);
  check("a stranger writes nothing anywhere", [await stranger.from("church_pastors").insert({ profile_id: prof.c1, name: "No" }), await stranger.from("church_public_groups").insert({ profile_id: prof.c1, kind: "youths" }), await stranger.from("church_about").insert({ profile_id: prof.c1, vision_en: "No" })].every((r) => !!r.error));
  check("the owner of ANOTHER church cannot write into this church", [await owner2.from("church_pastors").insert({ profile_id: prof.c1, name: "No" }), await owner2.from("church_group_photos").insert({ profile_id: prof.c1, public_group_id: men, image_url: IMG })].every((r) => !!r.error));
  check("a stranger cannot READ draft pastors or hidden groups", ((await stranger.from("church_pastors").select("name").eq("name", "Pastor Sam")).data || []).length === 0);
  eq("the pastor-page manager reads the draft pastor", ((await pastorMgr.from("church_pastors").select("name")).data || []).map((r) => r.name), ["Pastor Sam"]);
  check("a platform admin who does not own the church is refused", [await admin.from("church_pastors").insert({ profile_id: prof.c1, name: "No" }), await admin.from("church_public_groups").insert({ profile_id: prof.c1, kind: "youths" })].every((r) => !!r.error));
  check("a stranger cannot delete a pastor", (await stranger.from("church_pastors").delete().eq("name", "Pastor Sam")).error !== undefined && (await rows(db, "select count(*)::int n from public.church_pastors"))[0].n === 1);
  const stamp = await rows(db, "select created_by, updated_by from public.church_pastors where name = 'Pastor Sam'");
  check("the audit columns come from the signed-in caller, not the request", stamp[0].created_by === PASTOR_USER && stamp[0].updated_by === PASTOR_USER, JSON.stringify(stamp));
  const forge = await pastorMgr.from("church_pastors").insert({ profile_id: prof.c1, name: "Forge", created_by: u.owner1 });
  check("a client cannot write the audit columns at all", !!forge.error);
  await ok("the owner deletes a pastor", owner.from("church_pastors").delete().eq("name", "Pastor Sam"));
  check("the privacy columns are not in the public tables (no phone, no email, no birth date)", (await rows(db, "select count(*)::int n from information_schema.columns where table_schema='public' and table_name in ('church_public_groups','church_group_photos','church_pastors','church_about') and column_name ~* '(phone|email|birth|guardian|(^|_)age($|_))'"))[0].n === 0);
  check("no table of this phase has a link to a roster MEMBER or a child (only the optional group link)", (await rows(db, "select count(*)::int n from information_schema.columns where table_schema='public' and table_name in ('church_public_groups','church_group_photos','church_pastors','church_about') and column_name ~* '(member|child)'"))[0].n === 0);
  const link = await F.svc(db, `update public.church_public_groups set roster_group_id = '${g.choir}' where id = '${men}'`).then(() => null).catch((e) => e);
  check("a public group can link to a roster group of the SAME church", link === null, String(link));
  const bad = await F.svcErr(db, `update public.church_public_groups set roster_group_id = '${g.c2grp}' where id = '${men}'`);
  check("...and never to another church's roster group", !!bad, JSON.stringify(bad));
}

console.log(`${fail === 0 ? "OK" : "FAILED"}: ${pass} checks passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
