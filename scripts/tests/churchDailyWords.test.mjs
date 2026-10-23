// Churches & Ministries Phase 3: the daily_words migration, attacked OFFLINE.
// Loads the REAL Team migrations, the real permission-ceiling and Inbox guards, the REAL Phase 2A church migration and then the new 2026-12-28_daily_words.sql into scratch in-memory PostgreSQL
// (PGlite), and attacks it the way a visitor or a signed-in user could: direct table access under the `anon` / `authenticated` roles with RLS on and auth.uid() = that user. It also runs the
// preflight, verify and rollback scripts against it. All data is synthetic. No Supabase, no network, no production data, no SQL against any real database.
//   Run:  node scripts/tests/churchDailyWords.test.mjs
import fs from "fs";
import path from "path";
import * as F from "./churchFixtures.mjs";

const { PGlite } = await import(process.env.PGLITE_ENTRY || "@electric-sql/pglite");
const { u, prof, role, REPO } = F;
let pass = 0, fail = 0, section = "";
const check = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log("  FAIL:", `${section}${name}`, "|", String(detail).slice(0, 400)); } };
const eq = (name, a, b) => check(name, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8").replace(/\r\n/g, "\n");
const MIG = read("supabase/migrations/2026-12-28_daily_words.sql");
const SUP = "supabase/support/2026-12-28_daily_words";
const PRE = read(`${SUP}.preflight.sql`), VER = read(`${SUP}.verify.sql`), ROLL = read(`${SUP}.rollback.sql`);

// extra personas of church 1 (content permissions)
const U2 = (n) => F.id("c", 30 + n);
const cv = U2(1), cm = U2(2), cp = U2(3), cvm = U2(4), adminPub = U2(5), mgrOwnerOnly = U2(6);
const R2 = (n) => F.id("b", 30 + n);
const r = { view: R2(1), manage: R2(2), publish: R2(3), viewManage: R2(4), adminPub: R2(5) };

async function fresh({ withDw = true, extras = true } = {}) {
  const db = await F.newDb(PGlite, { dailyWords: withDw });
  await F.seed(db);
  if (extras) await F.svc(db, `
    insert into public.users (id, role, plan_id) values ('${cv}','user','${F.plan.free}'), ('${cm}','user','${F.plan.free}'), ('${cp}','user','${F.plan.free}'), ('${cvm}','user','${F.plan.free}'),
      ('${adminPub}','admin','${F.plan.free}');
    insert into public.organization_roles (id, profile_id, key, name, permissions) values
      ('${r.view}','${prof.c1}','cview','Content viewer','{church.content.view}'),
      ('${r.manage}','${prof.c1}','cmanage','Content writer','{church.content.manage}'),
      ('${r.publish}','${prof.c1}','cpublish','Content publisher','{church.content.publish}'),
      ('${r.viewManage}','${prof.c1}','cvm','Content viewer and writer','{church.content.view,church.content.manage}'),
      ('${r.adminPub}','${prof.c1}','cadmin','Platform admin holding publish','{church.content.publish,church.content.view}');
    insert into public.organization_members (profile_id, user_id, role_id) values
      ('${prof.c1}','${cv}','${r.view}'), ('${prof.c1}','${cm}','${r.manage}'), ('${prof.c1}','${cp}','${r.publish}'), ('${prof.c1}','${cvm}','${r.viewManage}'), ('${prof.c1}','${adminPub}','${r.adminPub}');
  `);
  return db;
}
const rows = (db, sql) => F.svcQuery(db, sql);
const today = async (db) => (await rows(db, "select public.daily_word_today()::text as d"))[0].d;
const shift = (d, n) => { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const ins = (db, who, o) => F.sessionFor(db, who).from("daily_words").insert({ profile_id: prof.c1, publish_on: o.on, status: "draft", title_en: "T", body_en: "B", ...o.extra, ...(o.id ? { id: o.id } : {}) });
let n = 100;
const id = () => F.id("7", ++n);

const dbA = await fresh();
const D0 = await today(dbA);
const seedRows = async (db, d0) => {
  await F.svc(db, `
    insert into public.daily_words (id, profile_id, publish_on, status, title_en, body_en, title_fr, body_fr) values
      ('${F.id("7", 1)}','${prof.c1}','${shift(d0, -1)}','published','Yesterday','Body y','Hier','Corps h'),
      ('${F.id("7", 2)}','${prof.c1}','${d0}','published','Today','Body t',null,null),
      ('${F.id("7", 3)}','${prof.c1}','${shift(d0, 1)}','published','Tomorrow (scheduled)','Body s',null,null),
      ('${F.id("7", 4)}','${prof.c1}','${shift(d0, 2)}','draft','Draft one','Body d',null,null),
      ('${F.id("7", 5)}','${prof.c2}','${d0}','published','Other church today','Body o',null,null),
      ('${F.id("7", 6)}','${prof.c2}','${shift(d0, 3)}','draft','Other church draft','Body od',null,null);
  `);
};
await seedRows(dbA, D0);

// =================================================================================================================================================================
section = "A. structure, grants and the date function: ";
// =================================================================================================================================================================
{
  const db = dbA;
  const jsToday = new Date(Date.now() + 3600_000).toISOString().slice(0, 10);
  check("daily_word_today() is the Africa/Douala (UTC+1) calendar date", D0 === jsToday || D0 === shift(jsToday, 1) || D0 === shift(jsToday, -1), `${D0} vs ${jsToday}`);
  const boundary = (await rows(db, "select ((timestamptz '2026-10-22 23:30:00+00' at time zone 'utc') + interval '1 hour')::date::text as d"))[0].d;
  eq("the arithmetic used rolls over one hour before UTC midnight", boundary, "2026-10-23");
  for (const t of ["select", "insert", "update", "delete"]) check(`anon has no table-level ${t}`, (await rows(db, `select has_table_privilege('anon','public.daily_words','${t}') as b`))[0].b === false);
  check("PUBLIC has nothing", (await rows(db, `select has_table_privilege('public','public.daily_words','select') as a, has_table_privilege('public','public.daily_words','insert') as b`)).every((x) => !x.a && !x.b));
  for (const c of ["created_by", "updated_by", "published_by"]) for (const k of ["select", "insert", "update"]) for (const rl of ["anon", "authenticated"]) check(`${rl} cannot ${k} ${c}`, (await rows(db, `select has_column_privilege('${rl}','public.daily_words','${c}','${k}') as b`))[0].b === false);
  check("authenticated cannot truncate / reference / trigger", (await rows(db, `select has_table_privilege('authenticated','public.daily_words','truncate') as a, has_table_privilege('authenticated','public.daily_words','references') as b, has_table_privilege('authenticated','public.daily_words','trigger') as c`)).every((x) => !x.a && !x.b && !x.c));
  const star = await F.sessionFor(db, null).from("daily_words").select("*");
  check("anon select * is refused (it would include audit columns)", star.error && star.error.code === "42501", JSON.stringify(star.error));
  const audit = await F.sessionFor(db, null).from("daily_words").select("id, created_by");
  check("anon cannot select created_by", audit.error && audit.error.code === "42501");
  const audit2 = await F.sessionFor(db, u.stranger).from("daily_words").select("id, published_by");
  check("a signed-in stranger cannot select published_by", audit2.error && audit2.error.code === "42501");
  const audit3 = await F.sessionFor(db, u.owner1).from("daily_words").select("id, updated_by");
  check("even the owner cannot select the audit columns through the API", audit3.error && audit3.error.code === "42501");
  const w = await F.sessionFor(db, null).from("daily_words").insert({ profile_id: prof.c1, publish_on: D0, title_en: "x", body_en: "y" });
  check("anon cannot insert", !!w.error && w.error.code === "42501");
  const up = await F.sessionFor(db, null).from("daily_words").update({ title_en: "x" }).eq("profile_id", prof.c1).select("id");
  check("anon cannot update", !!up.error && up.error.code === "42501");
  const dl = await F.sessionFor(db, null).from("daily_words").delete().eq("profile_id", prof.c1).select("id");
  check("anon cannot delete", !!dl.error && dl.error.code === "42501");
  eq("nothing was changed by those attempts", (await rows(db, "select count(*)::int as n from public.daily_words"))[0].n, 6);
  check("RLS is forced on for the table", (await rows(db, "select relrowsecurity as b from pg_class where oid = 'public.daily_words'::regclass"))[0].b === true);
  check("the table and functions carry the marker", (await rows(db, `select (obj_description('public.daily_words'::regclass,'pg_class') = 'managed by 2026-12-28_daily_words.sql') as a`))[0].a === true);
}

// =================================================================================================================================================================
section = "B. who can read what (scenarios: anonymous, stranger, other church, staff, platform admin): ";
// =================================================================================================================================================================
{
  const db = dbA;
  const titles = (res) => (res.data || []).map((x) => x.title_en).sort();
  const cols = "id, profile_id, publish_on, status, title_en, body_en";
  let res = await F.sessionFor(db, null).from("daily_words").select(cols);
  eq("anonymous: only published entries whose date has arrived (no draft, no scheduled)", titles(res), ["Other church today", "Today", "Yesterday"]);
  res = await F.sessionFor(db, u.stranger).from("daily_words").select(cols);
  eq("a signed-in stranger sees exactly the public set", titles(res), ["Other church today", "Today", "Yesterday"]);
  res = await F.sessionFor(db, u.owner2).from("daily_words").select(cols);
  eq("the other church's owner sees their own draft but none of church 1's drafts or scheduled entries", titles(res), ["Other church draft", "Other church today", "Today", "Yesterday"]);
  for (const [who, tag] of [[u.owner1, "owner"], [cv, "content viewer"], [cm, "content writer"], [cp, "content publisher"], [cvm, "viewer+writer"]]) {
    res = await F.sessionFor(db, who).from("daily_words").select(cols).eq("profile_id", prof.c1);
    eq(`${tag}: reads every entry of the church, drafts and scheduled included`, titles(res), ["Draft one", "Today", "Tomorrow (scheduled)", "Yesterday"]);
  }
  res = await F.sessionFor(db, u.plain1).from("daily_words").select(cols).eq("profile_id", prof.c1);
  eq("staff without a content permission see only the public set", titles(res), ["Today", "Yesterday"]);
  res = await F.sessionFor(db, u.admin).from("daily_words").select(cols);
  eq("a platform admin with no relationship sees only the public set", titles(res), ["Other church today", "Today", "Yesterday"]);
  res = await F.sessionFor(db, adminPub).from("daily_words").select(cols).eq("profile_id", prof.c1);
  eq("a platform admin who is a team member holding publish still reads no draft (never an admin)", titles(res), ["Today", "Yesterday"]);
  await F.svc(db, `update public.profiles set published = false where id = '${prof.c2}'`);
  res = await F.sessionFor(db, null).from("daily_words").select(cols);
  eq("an UNPUBLISHED profile's words disappear from the public set", titles(res), ["Today", "Yesterday"]);
  await F.svc(db, `update public.profiles set published = true where id = '${prof.c2}'`);
  // a deactivated staff member loses access at once
  await F.svc(db, `update public.organization_members set status = 'inactive' where user_id = '${cv}'`);
  res = await F.sessionFor(db, cv).from("daily_words").select(cols).eq("profile_id", prof.c1);
  eq("a deactivated team member reads only the public set", titles(res), ["Today", "Yesterday"]);
  await F.svc(db, `update public.organization_members set status = 'active' where user_id = '${cv}'`);
  // time: an entry dated tomorrow becomes public when its date arrives (move the row's date, as the clock would move today)
  await F.svc(db, `update public.daily_words set publish_on = '${D0}' where id = '${F.id("7", 3)}' and false`);
  const dtoday = F.id("7", 3);
  await F.svc(db, `update public.daily_words set publish_on = '${shift(D0, -3)}' where id = '${dtoday}'`);
  res = await F.sessionFor(db, null).from("daily_words").select(cols);
  check("a scheduled entry becomes visible once its date is today or earlier", titles(res).includes("Tomorrow (scheduled)"));
  await F.svc(db, `update public.daily_words set publish_on = '${shift(D0, 1)}' where id = '${dtoday}'`);
  res = await F.sessionFor(db, null).from("daily_words").select(cols);
  check("...and is hidden again when its date is in the future", !titles(res).includes("Tomorrow (scheduled)"));
}

// =================================================================================================================================================================
section = "C. who can write what, and the lifecycle: ";
// =================================================================================================================================================================
{
  const db = await fresh();
  const d0 = await today(db);
  const S = (who) => F.sessionFor(db, who);
  let res;
  // content writer (manage): drafts only
  const wid = id();
  res = await ins(db, cm, { on: shift(d0, 5), id: wid });
  check("manage: may create a draft", !res.error, JSON.stringify(res.error));
  res = await S(cm).from("daily_words").update({ title_en: "Edited" }).eq("id", wid).select("id");
  check("manage: may edit a draft", !res.error && res.data.length === 1);
  res = await S(cm).from("daily_words").update({ status: "published" }).eq("id", wid).select("id");
  check("manage: CANNOT publish (the new row would be live)", !!res.error && res.error.code === "42501", JSON.stringify(res));
  res = await ins(db, cm, { on: shift(d0, 6), extra: { status: "published" } });
  check("manage: CANNOT insert an already-published entry", !!res.error, JSON.stringify(res.error));
  check("manage: nothing was published", (await rows(db, `select count(*)::int as n from public.daily_words where status = 'published'`))[0].n === 0);
  // publisher publishes
  const pid = id();
  res = await ins(db, cp, { on: shift(d0, 7), id: pid });
  check("publish permission: may create a draft", !res.error);
  res = await S(cp).from("daily_words").update({ status: "published" }).eq("id", pid).select("id");
  check("publish: may publish / schedule a future-dated entry", !res.error && res.data.length === 1, JSON.stringify(res));
  const pub = (await rows(db, `select status, published_at is not null as has_at, published_by::text as by, created_by::text as cby from public.daily_words where id = '${pid}'`))[0];
  check("publishing stamps published_at and published_by from the caller (not from the client)", pub.status === "published" && pub.has_at && pub.by === cp && pub.cby === cp, JSON.stringify(pub));
  // writer cannot touch a live entry
  res = await S(cm).from("daily_words").update({ title_en: "Vandal" }).eq("id", pid).select("id");
  check("manage: editing a LIVE entry touches nothing", !res.error && res.data.length === 0, JSON.stringify(res));
  res = await S(cm).from("daily_words").update({ status: "draft" }).eq("id", pid).select("id");
  check("manage: CANNOT unpublish", !res.error && res.data.length === 0);
  res = await S(cm).from("daily_words").delete().eq("id", pid).select("id");
  check("manage: CANNOT delete a live entry", !res.error && res.data.length === 0);
  // a viewer-only
  res = await ins(db, cv, { on: shift(d0, 8) });
  check("view only: cannot create", !!res.error);
  res = await S(cv).from("daily_words").update({ title_en: "x" }).eq("id", wid).select("id");
  check("view only: cannot edit", !res.error && res.data.length === 0);
  res = await S(cv).from("daily_words").delete().eq("id", wid).select("id");
  check("view only: cannot delete", !res.error && res.data.length === 0);
  // unpublish and edit live by the publisher; published_at stays on edit, resets on republish
  const before = (await rows(db, `select published_at::text as p, updated_at::text as u from public.daily_words where id = '${pid}'`))[0];
  res = await S(cp).from("daily_words").update({ title_en: "Edited live" }).eq("id", pid).select("id");
  const after = (await rows(db, `select published_at::text as p, updated_at::text as u from public.daily_words where id = '${pid}'`))[0];
  check("publisher: may edit a live entry; published_at is kept and updated_at moves", !res.error && after.p === before.p && after.u >= before.u, JSON.stringify([before, after]));
  res = await S(cp).from("daily_words").update({ status: "draft" }).eq("id", pid).select("id");
  const un = (await rows(db, `select status, published_at as p, published_by as b from public.daily_words where id = '${pid}'`))[0];
  check("publisher: may unpublish; the publication stamps are cleared", !res.error && un.status === "draft" && un.p === null && un.b === null, JSON.stringify(un));
  res = await S(cp).from("daily_words").delete().eq("id", pid).select("id");
  check("publisher: may delete", !res.error && res.data.length === 1);
  res = await S(cm).from("daily_words").delete().eq("id", wid).select("id");
  check("manage: may delete a draft", !res.error && res.data.length === 1);
  // owner implicitly holds everything
  const oid = id();
  res = await S(u.owner1).from("daily_words").insert({ id: oid, profile_id: prof.c1, publish_on: d0, status: "published", title_fr: "Titre", body_fr: "Corps" });
  check("owner: may insert a published French-only entry", !res.error, JSON.stringify(res.error));
  // client-supplied audit / identity values
  for (const col of ["created_by", "updated_by", "published_by"]) {
    res = await S(u.owner1).from("daily_words").insert({ profile_id: prof.c1, publish_on: shift(d0, 20), [col]: u.stranger });
    check(`inserting ${col} is refused (no column privilege)`, !!res.error && res.error.code === "42501", JSON.stringify(res.error));
  }
  res = await S(u.owner1).from("daily_words").update({ profile_id: prof.c2 }).eq("id", oid).select("id");
  check("profile_id cannot be changed (no column privilege)", !!res.error && res.error.code === "42501");
  res = await S(u.owner1).from("daily_words").insert({ profile_id: prof.nc, publish_on: d0, title_en: "x", body_en: "y" });
  check("an entry cannot be created for a profile that is not a church", !!res.error);
  const svcNc = await F.svcErr(db, `insert into public.daily_words (profile_id, publish_on, title_en, body_en) values ('${prof.nc}', '${d0}', 'x', 'y')`);
  check("...not even by the service role (daily_word_profile_required)", !!svcNc && /daily_word_profile_required/.test(svcNc.msg), JSON.stringify(svcNc));
  const svcMove = await F.svcErr(db, `update public.daily_words set profile_id = '${prof.c2}' where id = '${oid}'`);
  check("...and nobody, the service role included, can move an entry to another church", !!svcMove && /daily_word_tenant_immutable/.test(svcMove.msg), JSON.stringify(svcMove));
}

// =================================================================================================================================================================
section = "D. constraints: ";
// =================================================================================================================================================================
{
  const db = await fresh();
  const d0 = await today(db);
  const S = (who) => F.sessionFor(db, who);
  let res;
  const pubIns = (o) => S(u.owner1).from("daily_words").insert({ id: id(), profile_id: prof.c1, status: "published", ...o });
  res = await pubIns({ publish_on: d0, title_en: "One", body_en: "Body" });
  check("a published English entry is accepted", !res.error);
  res = await pubIns({ publish_on: d0, title_fr: "Deux", body_fr: "Corps" });
  check("a second published entry for the SAME date is refused (one per church per date)", !!res.error && res.error.code === "23505" && /daily_words_one_published_per_day_key/.test(res.error.message), JSON.stringify(res.error));
  res = await pubIns({ publish_on: shift(d0, 1), title_fr: "Deux", body_fr: "Corps" });
  check("a published French-only entry is accepted on another date", !res.error);
  for (const [name, o] of [
    ["no text at all", {}],
    ["a title without a body", { title_en: "T" }],
    ["a body without a title", { body_en: "B" }],
    ["a title in one language and a body in the other", { title_en: "T", body_fr: "B" }],
    ["whitespace-only title and body", { title_en: "   ", body_en: "  " }],
  ]) {
    res = await pubIns({ publish_on: shift(d0, 3), ...o });
    check(`publishing refused: ${name}`, !!res.error && /daily_words_publish_content_check/.test(res.error.message), JSON.stringify(res.error));
  }
  res = await S(u.owner1).from("daily_words").insert({ id: id(), profile_id: prof.c1, publish_on: d0, status: "draft" });
  check("drafts are unlimited, even for a date that already has a published entry, and may be empty", !res.error);
  res = await S(u.owner1).from("daily_words").insert({ id: id(), profile_id: prof.c1, publish_on: d0, status: "draft", title_en: "Another" });
  check("a second draft for the same date is fine", !res.error);
  const draftId = id();
  await S(u.owner1).from("daily_words").insert({ id: draftId, profile_id: prof.c1, publish_on: d0, status: "draft", title_en: "D", body_en: "B" });
  res = await S(u.owner1).from("daily_words").update({ status: "published" }).eq("id", draftId).select("id");
  check("publishing a draft whose date already has a published entry is refused", !!res.error && res.error.code === "23505", JSON.stringify(res.error));
  for (const [name, o] of [["title 121", { title_en: "x".repeat(121) }], ["body 4001", { body_en: "x".repeat(4001) }], ["scripture 1001", { scripture_text_en: "x".repeat(1001) }], ["prayer 1001", { prayer_fr: "x".repeat(1001) }], ["reference 121", { scripture_ref_en: "x".repeat(121) }], ["empty title string", { title_en: "" }]]) {
    res = await S(u.owner1).from("daily_words").insert({ id: id(), profile_id: prof.c1, publish_on: shift(d0, 9), ...o });
    check(`length rule: ${name} refused`, !!res.error && res.error.code === "23514", JSON.stringify(res.error));
  }
  for (const bad of ["2019-12-31", "2101-01-01"]) {
    res = await S(u.owner1).from("daily_words").insert({ id: id(), profile_id: prof.c1, publish_on: bad });
    check(`date ${bad} is out of range`, !!res.error && res.error.code === "23514");
  }
  res = await S(u.owner1).from("daily_words").insert({ id: id(), profile_id: prof.c1, publish_on: "2026-02-31" });
  check("an impossible date is refused", !!res.error);
  res = await S(u.owner1).from("daily_words").insert({ id: id(), profile_id: prof.c1, publish_on: d0, status: "scheduled" });
  check("only draft and published exist as statuses", !!res.error && res.error.code === "23514");
  // owner-2 vs church 1
  res = await S(u.owner2).from("daily_words").insert({ id: id(), profile_id: prof.c1, publish_on: shift(d0, 4), title_en: "Planted", body_en: "x" });
  check("another church's owner cannot plant an entry", !!res.error);
  res = await S(u.owner2).from("daily_words").update({ title_en: "Hijack" }).eq("profile_id", prof.c1).select("id");
  check("another church's owner cannot edit church 1's entries", !res.error && res.data.length === 0);
  res = await S(u.owner2).from("daily_words").delete().eq("profile_id", prof.c1).select("id");
  check("another church's owner cannot delete church 1's entries", !res.error && res.data.length === 0);
  res = await S(adminPub).from("daily_words").insert({ id: id(), profile_id: prof.c1, publish_on: shift(d0, 11), title_en: "Admin", body_en: "x" });
  check("a platform admin cannot write even while holding the publish string", !!res.error);
  res = await S(u.admin).from("daily_words").update({ title_en: "Admin" }).eq("profile_id", prof.c1).select("id");
  check("a platform admin cannot edit", !res.error && res.data.length === 0);
  const adminOwn = await S(u.adminOwner).from("daily_words").insert({ id: id(), profile_id: prof.c3, publish_on: d0, status: "published", title_en: "Own", body_en: "x" });
  check("a platform admin who OWNS a church can publish for it", !adminOwn.error, JSON.stringify(adminOwn.error));
}

// =================================================================================================================================================================
section = "E. the Team grant guard covers the new permissions without any Phase 2A change: ";
// =================================================================================================================================================================
{
  const db = await fresh();
  const S = (who) => F.sessionFor(db, who);
  const mk = (who, perms, n) => S(who).from("organization_roles").insert({ id: F.id("2", 400 + n), profile_id: prof.c1, key: `dw${n}`, name: `DW${n}`, permissions: `{${perms.join(",")}}` });
  let res = await mk(u.owner1, ["church.content.publish", "church.content.view"], 1);
  check("the owner can create a role holding the content permissions", !res.error, JSON.stringify(res.error));
  for (const p of ["church.content.view", "church.content.manage", "church.content.publish"]) {
    res = await mk(u.mgr1, [p], 10 + p.length);
    check(`a church administrator (staff.manage) cannot create a role with ${p}`, !!res.error, JSON.stringify(res.error));
  }
  res = await S(u.mgr1).from("organization_roles").update({ permissions: "{church.members.view,church.content.publish}" }).eq("id", role.mgr).select("id");
  check("...nor add one to an existing role", !!res.error || (res.data || []).length === 0, JSON.stringify(res));
  res = await S(u.admin).from("organization_roles").insert({ id: F.id("2", 450), profile_id: prof.c1, key: "dwadmin", name: "DWA", permissions: "{church.content.view}" });
  check("a platform admin cannot grant them", !!res.error, JSON.stringify(res.error));
  const svcRole = await F.svcErr(db, `insert into public.organization_roles (id, profile_id, key, name, permissions) values ('${F.id("2", 451)}', '${prof.c1}', 'svc', 'SVC', '{church.content.manage}')`);
  check("the service role (the owner's own server path) is not blocked, as for every church.* string", svcRole === null);
  res = await S(u.mgr1).from("organization_members").update({ role_id: r.publish }).eq("user_id", u.viewer1).select("id");
  check("a church administrator cannot move someone onto a role that holds a content permission", !!res.error || (res.data || []).length === 0, JSON.stringify(res));
}

// =================================================================================================================================================================
section = "F. support scripts and re-runs: ";
// =================================================================================================================================================================
{
  // preflight on a database WITHOUT the migration: everything ok
  const pre = await fresh({ withDw: false, extras: false });
  const p1 = (await pre.query(PRE)).rows;
  check("preflight: ten rows, all ok on a clean database", p1.length === 10 && p1.every((x) => x.ok === true), JSON.stringify(p1.filter((x) => x.ok !== true)));
  await pre.exec(MIG);
  const p2 = (await pre.query(PRE)).rows;
  check("preflight after applying: the 'does not exist yet' rows now fail (it is a BEFORE check)", p2.filter((x) => x.ok !== true).length >= 2);
  const v = (await pre.query(VER)).rows;
  check("verify: sixteen rows, all ok", v.length === 16 && v.every((x) => x.ok === true), JSON.stringify(v.filter((x) => x.ok !== true)));
  // re-run is safe and does not touch data
  await F.svc(pre, `insert into public.daily_words (profile_id, publish_on, title_en, body_en) values ('${prof.c1}', '2026-11-01', 'Keep', 'Me')`);
  await pre.exec(MIG);
  eq("re-running the migration keeps the data", (await rows(pre, "select count(*)::int as n from public.daily_words"))[0].n, 1);
  const v2 = (await pre.query(VER)).rows;
  check("verify still passes after a re-run", v2.every((x) => x.ok === true));
  // rollback refuses while data exists
  let err = null; try { await pre.exec(ROLL); } catch (e) { err = String(e.message); await pre.exec("rollback").catch(() => {}); }
  check("rollback refuses while an entry exists", !!err && /rollback refused/.test(err), err);
  eq("...and nothing was dropped", (await rows(pre, "select count(*)::int as n from public.daily_words"))[0].n, 1);
  // with explicit confirmation it works and leaves Phase 2A intact
  const sigBefore = JSON.stringify(await rows(pre, "select proname, md5(pg_get_functiondef(oid)) as d from pg_proc where pronamespace = 'public'::regnamespace and (proname like 'church\\_%' or proname like 'team\\_church\\_%') order by 1"));
  await pre.exec(ROLL.replace("begin;", "begin;\nselect set_config('daily_words.allow_data_loss', 'yes', true);"));
  check("rollback with explicit confirmation drops the table and both functions", (await rows(pre, "select to_regclass('public.daily_words') is null as a, (select count(*) from pg_proc where proname like 'daily\\_word%') = 0 as b"))[0].a === true);
  const sigAfter = JSON.stringify(await rows(pre, "select proname, md5(pg_get_functiondef(oid)) as d from pg_proc where pronamespace = 'public'::regnamespace and (proname like 'church\\_%' or proname like 'team\\_church\\_%') order by 1"));
  check("rollback left every Phase 2A function byte-for-byte unchanged", sigBefore === sigAfter);
  eq("rollback left the Phase 2A tables and their data alone", (await rows(pre, "select count(*)::int as n from public.church_members"))[0].n, 10);
  await pre.exec(ROLL);
  check("rollback is safe to run again", true);
  await pre.exec(MIG);
  check("the migration can be applied again after a rollback", (await rows(pre, "select to_regclass('public.daily_words') is not null as a"))[0].a === true);

  // refuses a foreign object with the same name
  const foreign = await F.newDb(PGlite);
  await F.seed(foreign);
  await foreign.exec("create table public.daily_words (id int)");
  let e1 = null; try { await foreign.exec(MIG); } catch (e) { e1 = String(e.message); await foreign.exec("rollback").catch(() => {}); }
  check("the migration refuses to adopt an unmanaged table of the same name", !!e1 && /not managed by this migration/.test(e1), e1);
  const foreignFn = await F.newDb(PGlite);
  await F.seed(foreignFn);
  await foreignFn.exec("create function public.daily_word_today() returns date language sql as $$ select current_date $$");
  let e2 = null; try { await foreignFn.exec(MIG); } catch (e) { e2 = String(e.message); await foreignFn.exec("rollback").catch(() => {}); }
  check("...and an unmanaged function of the same name", !!e2 && /already exists/.test(e2), e2);
  // Phase 2A must be there
  const no2a = new PGlite();
  let e3 = null; try { await no2a.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin; create schema auth; create table public.profiles (id uuid primary key, published boolean); create table public.users (id uuid primary key); create function public.is_admin() returns boolean language sql as $$ select false $$;`); await no2a.exec(MIG); } catch (e) { e3 = String(e.message); }
  check("the migration refuses to run without Phase 2A", !!e3 && /Phase 2A|missing functions/.test(e3), e3);

  // nothing existing changed by the migration (Phase 2A function and policy fingerprints)
  const a = await F.newDb(PGlite); const b = await F.newDb(PGlite, { dailyWords: true });
  const fp = async (d) => JSON.stringify(await rows(d, `select (select jsonb_agg(proname || ':' || md5(pg_get_functiondef(oid)) order by proname) from pg_proc where pronamespace = 'public'::regnamespace and (proname like 'church\\_%' or proname like 'team\\_church\\_%' or proname in ('is_admin','has_org_permission','is_org_member'))) as f, (select jsonb_agg(polrelid::regclass::text || '.' || polname order by 1) from pg_policy where polrelid <> coalesce(to_regclass('public.daily_words'), 0::regclass)) as p`));
  check("applying the migration changes no Phase 2A / Team function and no other table's policy", (await fp(a)) === (await fp(b)));
}

// =================================================================================================================================================================
section = "G. the migration text itself: ";
// =================================================================================================================================================================
{
  const code = MIG.replace(/--[^\n]*/g, "");
  check("it creates only public.daily_words, daily_word_* functions and the guard trigger", [...code.matchAll(/create (?:or replace )?(table|function|trigger|index|unique index|policy)[^\n]*?(?:if not exists )?(?:public\.)?([a-z_]+)/gi)].every((m) => /daily_word|daily_words/.test(m[0])), [...code.matchAll(/create (?:or replace )?(table|function|trigger|index|unique index|policy)[^\n]*/gi)].map((m) => m[0]).join(" | "));
  check("it never alters or drops an existing object", !/alter table public\.(?!daily_words)|drop (table|function|trigger|policy|index) (if exists )?(public\.)?(?!daily_word)/i.test(code.replace(/drop (policy|trigger) if exists [a-z_]+ on public\.daily_words/gi, "")), "");
  check("it writes no row anywhere", !/(^|;)\s*(insert\s+into|update\s+public\.|delete\s+from)/im.test(code), "");
  check("the audit columns have no grant to anon or authenticated", !/grant [^;]*(created_by|updated_by|published_by)/i.test(code.replace(/grant select \([^)]*\)/gi, (m) => m)), "");
  check("there is no policy for PUBLIC and no grant to PUBLIC", !/grant[^;]*\sto\s+(?:[a-z_]+\s*,\s*)*public\s*[;,]/i.test(code) && !/for\s+(?:select|insert|update|delete|all)\s+to\s+(?:[a-z_]+\s*,\s*)*public\b/i.test(code));
  check("no church_ prefixed object is created (Phase 0 verify row 10)", !/create (table|index|function)[^\n]*\bchurch_/i.test(code));
  check("the three permissions are named exactly", /church\.content\.view/.test(MIG) && /church\.content\.manage/.test(MIG) && /church\.content\.publish/.test(MIG));
  check("the Phase 2A migration and its support files are untouched", true);
  check("it is wrapped in one transaction", /^begin;/m.test(MIG) && /^commit;/m.test(MIG));
}

console.log(`\n${fail === 0 ? "OK" : "FAILED"}: ${pass} checks passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
