// Churches & Ministries Phase 4: the ministry_events / ministry_announcements migration, attacked OFFLINE.
// Loads the REAL Team migrations, the real permission-ceiling and Inbox guards, the REAL Phase 2A church migration, the Phase 3 daily_words migration and then the new
// 2026-12-29_ministry_events_announcements.sql into scratch in-memory PostgreSQL (PGlite), and attacks it the way a visitor or a signed-in user could: direct table access under the `anon` /
// `authenticated` roles with RLS on and auth.uid() = that user. It also runs the preflight, verify and rollback scripts against it. All data is synthetic. No Supabase, no network, no production
// data, no SQL against any real database.
//   Run:  node scripts/tests/ministryEvents.test.mjs
import fs from "fs";
import path from "path";
import * as F from "./churchFixtures.mjs";

const { PGlite } = await import(process.env.PGLITE_ENTRY || "@electric-sql/pglite");
const { u, prof, REPO } = F;
let pass = 0, fail = 0, section = "";
const check = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log("  FAIL:", `${section}${name}`, "|", String(detail).slice(0, 400)); } };
const eq = (name, a, b) => check(name, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8").replace(/\r\n/g, "\n");
const MIG = F.EV_MIG;
const SUP = "supabase/support/2026-12-29_ministry_events_announcements";
const PRE = read(`${SUP}.preflight.sql`), VER = read(`${SUP}.verify.sql`), ROLL = read(`${SUP}.rollback.sql`);

const U2 = (n) => F.id("c", 40 + n);
const ev = U2(1), em = U2(2), ep = U2(3), evm = U2(4), adminPub = U2(5);
const R2 = (n) => F.id("b", 40 + n);
const r = { view: R2(1), manage: R2(2), publish: R2(3), viewManage: R2(4), adminPub: R2(5) };

async function fresh({ withEv = true, extras = true } = {}) {
  const db = await F.newDb(PGlite, { dailyWords: true, events: withEv });
  await F.seed(db);
  if (extras) await F.svc(db, `
    insert into public.users (id, role, plan_id) values ('${ev}','user','${F.plan.free}'), ('${em}','user','${F.plan.free}'), ('${ep}','user','${F.plan.free}'), ('${evm}','user','${F.plan.free}'), ('${adminPub}','admin','${F.plan.free}');
    insert into public.organization_roles (id, profile_id, key, name, permissions) values
      ('${r.view}','${prof.c1}','eview','Events viewer','{church.events.view}'),
      ('${r.manage}','${prof.c1}','emanage','Events writer','{church.events.manage}'),
      ('${r.publish}','${prof.c1}','epublish','Events publisher','{church.events.publish}'),
      ('${r.viewManage}','${prof.c1}','evm','Events viewer and writer','{church.events.view,church.events.manage}'),
      ('${r.adminPub}','${prof.c1}','eadmin','Platform admin holding publish','{church.events.publish,church.events.view}');
    insert into public.organization_members (profile_id, user_id, role_id) values
      ('${prof.c1}','${ev}','${r.view}'), ('${prof.c1}','${em}','${r.manage}'), ('${prof.c1}','${ep}','${r.publish}'), ('${prof.c1}','${evm}','${r.viewManage}'), ('${prof.c1}','${adminPub}','${r.adminPub}');
  `);
  return db;
}
const rows = (db, sql) => F.svcQuery(db, sql);
const today = async (db) => (await rows(db, "select public.ministry_today()::text as d"))[0].d;
const shift = (d, n) => { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const S = (db, who) => F.sessionFor(db, who);
const Ev = (db, who) => S(db, who).from("ministry_events");
const An = (db, who) => S(db, who).from("ministry_announcements");
let n = 100;
const id = () => F.id("8", ++n);
const evRow = (o = {}) => ({ id: id(), profile_id: prof.c1, status: "draft", event_date: "2027-03-01", title_en: "Sunday service", ...o });
const anRow = (o = {}) => ({ id: id(), profile_id: prof.c1, status: "draft", title_en: "Notice", body_en: "Body", ...o });

const dbA = await fresh();
const D0 = await today(dbA);
const E = (k) => F.id("8", k);
await F.svc(dbA, `
  insert into public.ministry_events (id, profile_id, status, event_date, title_en, title_fr, description_en, venue) values
    ('${E(1)}','${prof.c1}','published','${shift(D0, 3)}','Upcoming service','Culte à venir','Join us','Main hall'),
    ('${E(2)}','${prof.c1}','published','${shift(D0, -30)}','Past service',null,null,null),
    ('${E(3)}','${prof.c1}','draft','${shift(D0, 5)}','Draft event',null,null,null),
    ('${E(4)}','${prof.c2}','published','${shift(D0, 2)}','Other church event',null,null,null),
    ('${E(5)}','${prof.c2}','draft','${shift(D0, 4)}','Other church draft',null,null,null);
  insert into public.ministry_announcements (id, profile_id, status, title_en, body_en, expires_on) values
    ('${E(11)}','${prof.c1}','published','Open notice','Body a',null),
    ('${E(12)}','${prof.c1}','published','Last day today','Body b','${D0}'),
    ('${E(13)}','${prof.c1}','published','Expired notice','Body c','${shift(D0, -1)}'),
    ('${E(14)}','${prof.c1}','draft','Draft notice','Body d',null),
    ('${E(15)}','${prof.c2}','published','Other church notice','Body e',null),
    ('${E(16)}','${prof.c2}','draft','Other church draft notice','Body f',null);
`);

// =================================================================================================================================================================
section = "A. structure, grants and the date function: ";
// =================================================================================================================================================================
{
  const db = dbA;
  const jsToday = new Date(Date.now() + 3600_000).toISOString().slice(0, 10);
  check("ministry_today() is the Africa/Douala (UTC+1) calendar date", [jsToday, shift(jsToday, 1), shift(jsToday, -1)].includes(D0), `${D0} vs ${jsToday}`);
  for (const t of ["ministry_events", "ministry_announcements"]) {
    for (const k of ["select", "insert", "update", "delete"]) check(`${t}: anon has no table-level ${k}`, (await rows(db, `select has_table_privilege('anon','public.${t}','${k}') as b`))[0].b === false);
    check(`${t}: PUBLIC has nothing`, (await rows(db, `select has_table_privilege('public','public.${t}','select') as a, has_table_privilege('public','public.${t}','insert') as b`)).every((x) => !x.a && !x.b));
    for (const c of ["created_by", "updated_by", "published_by"]) for (const k of ["select", "insert", "update"]) for (const rl of ["anon", "authenticated"]) {
      check(`${t}: ${rl} cannot ${k} ${c}`, (await rows(db, `select has_column_privilege('${rl}','public.${t}','${c}','${k}') as b`))[0].b === false);
    }
    check(`${t}: authenticated cannot truncate / reference / trigger`, (await rows(db, `select has_table_privilege('authenticated','public.${t}','truncate') as a, has_table_privilege('authenticated','public.${t}','references') as b, has_table_privilege('authenticated','public.${t}','trigger') as c`)).every((x) => !x.a && !x.b && !x.c));
    check(`${t}: profile_id cannot be changed by an update grant`, (await rows(db, `select has_column_privilege('authenticated','public.${t}','profile_id','update') as b`))[0].b === false);
    check(`${t}: row-level security is on`, (await rows(db, `select relrowsecurity as b from pg_class where oid = 'public.${t}'::regclass`))[0].b === true);
    check(`${t}: no policy applies to PUBLIC`, (await rows(db, `select count(*)::int as n from pg_policy where polrelid = 'public.${t}'::regclass and polroles = array[0::oid]`))[0].n === 0);
    const star = await S(db, null).from(t).select("*");
    check(`${t}: anon select * is refused (it would include audit columns)`, star.error && star.error.code === "42501", JSON.stringify(star.error));
    for (const who of [null, u.stranger, u.owner1]) {
      const a = await S(db, who).from(t).select("created_by");
      check(`${t}: nobody can read created_by through the API (${who || "anon"})`, a.error && a.error.code === "42501");
    }
  }
}

// =================================================================================================================================================================
section = "B. what the public, strangers and other churches can read: ";
// =================================================================================================================================================================
{
  const db = dbA;
  const titles = (res) => (res.data || []).map((x) => x.title_en).sort();
  const cols = "id, profile_id, status, title_en";
  let res = await S(db, null).from("ministry_events").select(cols);
  eq("anonymous events: published only, any date, both churches", titles(res), ["Other church event", "Past service", "Upcoming service"]);
  res = await S(db, u.stranger).from("ministry_events").select(cols);
  eq("a signed-in stranger sees exactly the public set", titles(res), ["Other church event", "Past service", "Upcoming service"]);
  res = await S(db, u.owner2).from("ministry_events").select(cols);
  eq("the other church's owner sees their own draft but none of church 1's drafts", titles(res), ["Other church draft", "Other church event", "Past service", "Upcoming service"]);
  res = await S(db, null).from("ministry_announcements").select(cols);
  eq("anonymous announcements: published and not past their last day", titles(res), ["Last day today", "Open notice", "Other church notice"]);
  res = await S(db, u.owner1).from("ministry_announcements").select(cols).eq("profile_id", prof.c1);
  eq("the owner reads every announcement of the church (drafts and expired ones included)", titles(res), ["Draft notice", "Expired notice", "Last day today", "Open notice"]);
  res = await S(db, u.owner1).from("ministry_events").select(cols).eq("profile_id", prof.c1);
  eq("the owner reads every event of the church", titles(res), ["Draft event", "Past service", "Upcoming service"]);
  for (const [who, tag] of [[ev, "events viewer"], [em, "events writer"], [ep, "events publisher"], [evm, "viewer+writer"]]) {
    res = await S(db, who).from("ministry_events").select(cols).eq("profile_id", prof.c1);
    eq(`${tag}: reads every event of the church, drafts included`, titles(res), ["Draft event", "Past service", "Upcoming service"]);
    res = await S(db, who).from("ministry_announcements").select(cols).eq("profile_id", prof.c1);
    eq(`${tag}: reads every announcement of the church`, titles(res), ["Draft notice", "Expired notice", "Last day today", "Open notice"]);
  }
  res = await S(db, u.plain1).from("ministry_events").select(cols).eq("profile_id", prof.c1);
  eq("staff without an events permission see only the public set", titles(res), ["Past service", "Upcoming service"]);
  res = await S(db, u.mgr1).from("ministry_announcements").select(cols).eq("profile_id", prof.c1);
  eq("a church administrator without an events permission reads no draft or expired notice", titles(res), ["Last day today", "Open notice"]);
  res = await S(db, u.admin).from("ministry_events").select(cols);
  eq("a platform admin with no relationship sees only the public set", titles(res), ["Other church event", "Past service", "Upcoming service"]);
  res = await S(db, adminPub).from("ministry_events").select(cols).eq("profile_id", prof.c1);
  eq("a platform admin who is a team member holding publish still reads no draft", titles(res), ["Past service", "Upcoming service"]);
  // an unpublished profile hides everything, even published rows
  const dbU = await fresh();
  await F.svc(dbU, `insert into public.ministry_events (id, profile_id, status, event_date, title_en) values ('${E(1)}','${prof.c1}','published','${shift(D0, 1)}','Live'); insert into public.ministry_announcements (id, profile_id, status, title_en, body_en) values ('${E(11)}','${prof.c1}','published','Live','Body');
    update public.profiles set published = false where id = '${prof.c1}'`);
  res = await S(dbU, null).from("ministry_events").select(cols);
  eq("an unpublished church profile has no public events", titles(res), []);
  res = await S(dbU, null).from("ministry_announcements").select(cols);
  eq("...and no public announcements", titles(res), []);
  res = await S(dbU, u.owner1).from("ministry_events").select(cols).eq("profile_id", prof.c1);
  eq("...but its owner still reads them", titles(res), ["Live"]);
  // a church profile without the category sees nothing planted
  const noCat = await Ev(db, u.ownerNC).insert(evRow({ profile_id: prof.nc }));
  check("a profile that is not a church cannot create an event (the guard refuses)", !!noCat.error, JSON.stringify(noCat.error));
  await dbU.close(); await dbA.close();
}

// =================================================================================================================================================================
section = "C. who may write: ";
// =================================================================================================================================================================
{
  const db = await fresh();
  const Evt = (who) => Ev(db, who), Ann = (who) => An(db, who);
  // owner
  let res = await Evt(u.owner1).insert(evRow({ id: E(1) }));
  check("owner: may create an event draft", !res.error, JSON.stringify(res.error));
  const stamp = (await rows(db, `select created_by::text as c, updated_by::text as u, published_at from public.ministry_events where id = '${E(1)}'`))[0];
  check("the creator is stamped from auth.uid()", stamp.c === u.owner1 && stamp.u === u.owner1 && stamp.published_at === null, JSON.stringify(stamp));
  res = await Evt(u.owner1).insert(evRow({ created_by: u.stranger }));
  check("a client-supplied created_by is refused (no column grant)", !!res.error && res.error.code === "42501", JSON.stringify(res.error));
  res = await Evt(u.owner1).insert(evRow({ published_at: "2020-01-01T00:00:00Z" }));
  check("a client-supplied published_at is refused (no column grant)", !!res.error && res.error.code === "42501");
  // manage: drafts only
  res = await Evt(em).insert(evRow({ id: E(2) }));
  check("manage: may create a draft", !res.error, JSON.stringify(res.error));
  res = await Evt(em).update({ title_en: "Edited by writer" }).eq("id", E(2)).select("id");
  check("manage: may edit a draft", !res.error && res.data.length === 1);
  res = await Evt(em).update({ status: "published" }).eq("id", E(2)).select("id");
  check("manage: CANNOT publish (the new row would be live)", !!res.error && res.error.code === "42501", JSON.stringify(res));
  res = await Evt(em).insert(evRow({ status: "published" }));
  check("manage: CANNOT insert an already-published event", !!res.error);
  res = await Ann(em).insert(anRow({ status: "published" }));
  check("manage: CANNOT insert an already-published announcement", !!res.error);
  check("manage: nothing was published", (await rows(db, `select count(*)::int as n from public.ministry_events where status = 'published'`))[0].n === 0);
  // publish: everything
  res = await Evt(ep).insert(evRow({ id: E(3) }));
  check("publish permission: may create a draft", !res.error);
  res = await Evt(ep).update({ status: "published" }).eq("id", E(3)).select("id");
  check("publish: may publish", !res.error && res.data.length === 1, JSON.stringify(res));
  const live = (await rows(db, `select status, published_at is not null as a, published_by::text as b from public.ministry_events where id = '${E(3)}'`))[0];
  check("publishing stamps published_at and published_by", live.status === "published" && live.a === true && live.b === ep, JSON.stringify(live));
  res = await Evt(em).update({ title_en: "Vandal" }).eq("id", E(3)).select("id");
  check("manage: editing a LIVE event touches nothing", !res.error && res.data.length === 0, JSON.stringify(res));
  res = await Evt(em).update({ status: "draft" }).eq("id", E(3)).select("id");
  check("manage: CANNOT unpublish", !res.error && res.data.length === 0);
  res = await Evt(em).delete().eq("id", E(3)).select("id");
  check("manage: CANNOT delete a live event", !res.error && res.data.length === 0);
  res = await Evt(em).update({ is_cancelled: true }).eq("id", E(3)).select("id");
  check("manage: CANNOT cancel a live event", !res.error && res.data.length === 0);
  res = await Evt(ep).update({ is_cancelled: true }).eq("id", E(3)).select("id");
  check("publish: may cancel a live event", !res.error && res.data.length === 1);
  check("the live event is untouched by the writer", (await rows(db, `select title_en, status from public.ministry_events where id = '${E(3)}'`))[0].title_en === "Sunday service");
  res = await Evt(ep).update({ status: "draft" }).eq("id", E(3)).select("id");
  check("publish: may unpublish; the publication stamps are cleared", !res.error && res.data.length === 1 && (await rows(db, `select published_at, published_by from public.ministry_events where id = '${E(3)}'`))[0].published_at === null);
  // view only
  res = await Evt(ev).insert(evRow());
  check("view only: cannot create", !!res.error);
  res = await Evt(ev).update({ title_en: "x" }).eq("id", E(2)).select("id");
  check("view only: cannot edit", !res.error && res.data.length === 0);
  res = await Evt(ev).delete().eq("id", E(2)).select("id");
  check("view only: cannot delete", !res.error && res.data.length === 0);
  res = await Ann(ev).insert(anRow());
  check("view only: cannot create an announcement", !!res.error);
  res = await Evt(em).delete().eq("id", E(2)).select("id");
  check("manage: may delete a draft", !res.error && res.data.length === 1);
  // no permission / stranger / anon
  for (const [who, tag] of [[u.plain1, "staff without the permission"], [u.stranger, "a stranger"], [u.mgr1, "a church administrator without the permission"]]) {
    res = await Evt(who).insert(evRow());
    check(`${tag}: cannot create`, !!res.error);
    res = await Ann(who).insert(anRow());
    check(`${tag}: cannot create an announcement`, !!res.error);
  }
  res = await Evt(null).insert(evRow());
  check("anon cannot insert", !!res.error && res.error.code === "42501");
  res = await Evt(null).update({ title_en: "x" }).eq("id", E(3)).select("id");
  check("anon cannot update", !!res.error && res.error.code === "42501");
  res = await Evt(null).delete().eq("id", E(3)).select("id");
  check("anon cannot delete", !!res.error && res.error.code === "42501");
  // platform admin holding publish: refused by the restrictive policies
  res = await Evt(adminPub).insert(evRow());
  check("a platform admin holding publish cannot create (restrictive policy)", !!res.error, JSON.stringify(res.error));
  res = await Ann(adminPub).update({ title_en: "x" }).eq("id", E(11)).select("id");
  check("...nor edit", !res.error && res.data.length === 0);
  // the owner of the church who is also an admin keeps working
  res = await Evt(u.adminOwner).insert(evRow({ profile_id: prof.c3 }));
  check("a platform admin who OWNS the church may write (owner exception)", !res.error, JSON.stringify(res.error));
  // tenant immutability and the other church
  res = await Evt(u.owner1).update({ profile_id: prof.c2 }).eq("id", E(1)).select("id");
  check("profile_id cannot be changed (no column privilege)", !!res.error && res.error.code === "42501");
  await F.svc(db, `insert into public.ministry_events (id, profile_id, status, event_date, title_en) values ('${E(40)}','${prof.c2}','draft','2027-01-01','Other draft')`);
  const tm = await F.svcErr(db, `update public.ministry_events set profile_id = '${prof.c1}' where id = '${E(40)}'`);
  check("the guard refuses to move an entry to another church even for the service role", !!tm && /ministry_tenant_immutable/.test(tm.msg), JSON.stringify(tm));
  res = await Evt(u.owner2).insert(evRow({ profile_id: prof.c1 }));
  check("another church's owner cannot plant an event", !!res.error);
  res = await Evt(u.owner2).update({ title_en: "Hijack" }).eq("id", E(1)).select("id");
  check("another church's owner cannot edit church 1's events", !res.error && res.data.length === 0);
  res = await Evt(u.owner2).delete().eq("id", E(1)).select("id");
  check("another church's owner cannot delete church 1's events", !res.error && res.data.length === 0);
  res = await Ann(u.owner2).insert(anRow({ profile_id: prof.c1 }));
  check("another church's owner cannot plant an announcement", !!res.error);
  await db.close();
}

// =================================================================================================================================================================
section = "D. data rules: ";
// =================================================================================================================================================================
{
  const db = await fresh();
  const own = (o) => Ev(db, u.owner1).insert(evRow(o));
  const bad = async (name, o, table = "ministry_events") => { const res = await (table === "ministry_events" ? Ev(db, u.owner1).insert(evRow(o)) : An(db, u.owner1).insert(anRow(o))); check(name, !!res.error && res.error.code === "23514", JSON.stringify(res.error)); };
  const good = async (name, o, table = "ministry_events") => { const res = await (table === "ministry_events" ? Ev(db, u.owner1).insert(evRow(o)) : An(db, u.owner1).insert(anRow(o))); check(name, !res.error, JSON.stringify(res.error)); };
  await bad("an event date before 2020 is refused", { event_date: "2019-12-31" });
  await bad("an event date after 2100 is refused", { event_date: "2101-01-01" });
  await bad("an event must start before it ends", { start_time: "10:00", end_time: "09:00" });
  await bad("an event cannot end when it starts", { start_time: "10:00", end_time: "10:00" });
  await good("an event with only a start time is fine", { start_time: "10:00" });
  await good("an event with only an end time is fine", { end_time: "10:00" });
  await good("an event with an ordered time range is fine", { start_time: "09:00", end_time: "11:30" });
  await bad("an empty title is refused", { title_en: "" });
  await bad("a title over 120 characters is refused", { title_en: "x".repeat(121) });
  await bad("a description over 2000 characters is refused", { description_en: "x".repeat(2001) });
  await bad("a venue over 160 characters is refused", { venue: "x".repeat(161) });
  await bad("an address over 240 characters is refused", { address: "x".repeat(241) });
  await bad("an unknown status is refused", { status: "scheduled" });
  const noTitle = await F.svcErr(db, `insert into public.ministry_events (profile_id, status, event_date) values ('${prof.c1}','published','2027-01-01')`);
  check("a published event without any title is refused", !!noTitle && /ministry_events_publish_content_check/.test(noTitle.msg), JSON.stringify(noTitle));
  await good("a draft without a title is fine", { title_en: null });
  const frOnly = await F.svcErr(db, `insert into public.ministry_events (profile_id, status, event_date, title_fr) values ('${prof.c1}','published','2027-01-01','Culte')`);
  check("a French-only published event is fine", frOnly === null, JSON.stringify(frOnly));
  for (const url of ["https://example.org/live", "https://live.church.cm/watch?v=1", "https://youtu.be/abc#t=1"]) await good(`online link accepted: ${url}`, { online_url: url });
  for (const url of ["http://example.org/live", "javascript:alert(1)", "https://user:pw@example.org/x", "https://exa mple.org", "https://localhost", "ftp://example.org", "//example.org", "https://", "data:text/html,x", "https://" + "a".repeat(500) + ".org"]) {
    await bad(`online link refused: ${url.slice(0, 40)}`, { online_url: url });
  }
  await bad("an announcement title over 120 characters is refused", { title_en: "x".repeat(121) }, "ministry_announcements");
  await bad("an announcement body over 2000 characters is refused", { body_en: "x".repeat(2001) }, "ministry_announcements");
  await bad("an announcement last day before 2020 is refused", { expires_on: "2019-01-01" }, "ministry_announcements");
  const annNoBody = await F.svcErr(db, `insert into public.ministry_announcements (profile_id, status, title_en) values ('${prof.c1}','published','Only a title')`);
  check("a published announcement needs a title AND a body", !!annNoBody && /ministry_announcements_publish_content_check/.test(annNoBody.msg), JSON.stringify(annNoBody));
  const annFr = await F.svcErr(db, `insert into public.ministry_announcements (profile_id, status, title_fr, body_fr) values ('${prof.c1}','published','Avis','Corps')`);
  check("a French-only published announcement is fine", annFr === null, JSON.stringify(annFr));
  await good("an announcement draft may be empty", { title_en: null, body_en: null }, "ministry_announcements");
  // published_at coherence cannot be forged, even by the service role
  const forged = await F.svcErr(db, `insert into public.ministry_events (profile_id, status, event_date, title_en, published_at) values ('${prof.c1}','draft','2027-01-01','x', now())`);
  check("the guard resets published_at on a draft", forged === null && (await rows(db, `select count(*)::int as n from public.ministry_events where status = 'draft' and published_at is not null`))[0].n === 0);
  // duplicates are allowed (no uniqueness): several events on one day, several notices
  await good("several events may share a date", { event_date: "2027-05-05", title_en: "Morning" });
  await good("...and another", { event_date: "2027-05-05", title_en: "Evening" });
  // updated_at advances on every update
  const before = (await rows(db, `select updated_at::text as t from public.ministry_events limit 1`))[0].t;
  await new Promise((r2) => setTimeout(r2, 15));
  const idRow = (await rows(db, `select id::text as i from public.ministry_events limit 1`))[0].i;
  await Ev(db, u.owner1).update({ venue: "Hall B" }).eq("id", idRow);
  const after = (await rows(db, `select updated_at::text as t from public.ministry_events where id = '${idRow}'`))[0].t;
  check("updated_at advances on every update (it is the concurrency token)", after > before, `${before} -> ${after}`);
  await db.close();
}

// =================================================================================================================================================================
section = "E. the Team grant guard covers the new permissions without any Phase 2A change: ";
// =================================================================================================================================================================
{
  const db = await fresh();
  const mk = (who, perms, k) => S(db, who).from("organization_roles").insert({ id: F.id("2", 600 + k), profile_id: prof.c1, key: `ev${k}`, name: `EV${k}`, permissions: `{${perms.join(",")}}` });
  let res = await mk(u.owner1, ["church.events.publish", "church.events.view"], 1);
  check("the owner can create a role holding the events permissions", !res.error, JSON.stringify(res.error));
  let k = 10;
  for (const p of ["church.events.view", "church.events.manage", "church.events.publish"]) {
    res = await mk(u.mgr1, [p], ++k);
    check(`a church administrator (staff.manage) cannot create a role with ${p}`, !!res.error, JSON.stringify(res.error));
  }
  res = await mk(u.admin, ["church.events.view"], 40);
  check("a platform admin cannot grant them", !!res.error, JSON.stringify(res.error));
  await db.close();
}

// =================================================================================================================================================================
section = "F. support scripts and re-runs: ";
// =================================================================================================================================================================
{
  const pre = await fresh({ withEv: false, extras: false });
  const p1 = (await pre.query(PRE)).rows;
  check("preflight: ten rows, all ok on a clean database", p1.length === 10 && p1.every((x) => x.ok === true), JSON.stringify(p1.filter((x) => x.ok !== true)));
  await pre.exec(MIG);
  const p2 = (await pre.query(PRE)).rows;
  check("preflight after applying: the 'does not exist yet' rows now fail (it is a BEFORE check)", p2.filter((x) => x.ok !== true).length >= 2);
  const v = (await pre.query(VER)).rows;
  check("verify: sixteen rows, all ok", v.length === 16 && v.every((x) => x.ok === true), JSON.stringify(v.filter((x) => x.ok !== true)));
  await F.svc(pre, `insert into public.ministry_events (profile_id, event_date, title_en) values ('${prof.c1}', '2027-02-01', 'Keep')`);
  await pre.exec(MIG);
  eq("re-running the migration keeps the data", (await rows(pre, "select count(*)::int as n from public.ministry_events"))[0].n, 1);
  check("verify still passes after a re-run", (await pre.query(VER)).rows.every((x) => x.ok === true));
  let err = null; try { await pre.exec(ROLL); } catch (e) { err = String(e.message); await pre.exec("rollback").catch(() => {}); }
  check("rollback refuses while a row exists", !!err && /rollback refused/.test(err), err);
  eq("...and nothing was dropped", (await rows(pre, "select count(*)::int as n from public.ministry_events"))[0].n, 1);
  const sig = async (d) => JSON.stringify(await rows(d, "select proname, md5(pg_get_functiondef(oid)) as d from pg_proc where pronamespace = 'public'::regnamespace and (proname like 'church\\_%' or proname like 'team\\_church\\_%' or proname like 'daily\\_word%') order by 1"));
  const sigBefore = await sig(pre);
  await pre.exec(ROLL.replace("begin;", "begin;\nselect set_config('ministry_events.allow_data_loss', 'yes', true);"));
  check("rollback with explicit confirmation drops both tables and both functions", (await rows(pre, "select to_regclass('public.ministry_events') is null and to_regclass('public.ministry_announcements') is null and (select count(*) from pg_proc where proname like 'ministry\\_%') = 0 as a"))[0].a === true);
  check("rollback left every Phase 2A / Phase 3 function byte-for-byte unchanged", sigBefore === (await sig(pre)));
  eq("rollback left the Phase 2A tables and their data alone", (await rows(pre, "select count(*)::int as n from public.church_members"))[0].n, 10);
  await pre.exec(ROLL);
  check("rollback is safe to run again", true);
  await pre.exec(MIG);
  check("the migration can be applied again after a rollback", (await rows(pre, "select to_regclass('public.ministry_events') is not null as a"))[0].a === true);
  await pre.close();

  const foreign = await F.newDb(PGlite);
  await F.seed(foreign);
  await foreign.exec("create table public.ministry_events (id int)");
  let e1 = null; try { await foreign.exec(MIG); } catch (e) { e1 = String(e.message); await foreign.exec("rollback").catch(() => {}); }
  check("the migration refuses to adopt an unmanaged table of the same name", !!e1 && /half-applied|not managed by this migration/.test(e1), e1);
  await foreign.close();
  const foreignFn = await F.newDb(PGlite);
  await F.seed(foreignFn);
  await foreignFn.exec("create function public.ministry_today() returns date language sql as $$ select current_date $$");
  let e2 = null; try { await foreignFn.exec(MIG); } catch (e) { e2 = String(e.message); await foreignFn.exec("rollback").catch(() => {}); }
  check("...and an unmanaged function of the same name", !!e2 && /already exists/.test(e2), e2);
  await foreignFn.close();
  const no2a = new PGlite();
  let e3 = null; try { await no2a.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin; create schema auth; create table public.profiles (id uuid primary key, published boolean); create table public.users (id uuid primary key); create function public.is_admin() returns boolean language sql as $$ select false $$;`); await no2a.exec(MIG); } catch (e) { e3 = String(e.message); await no2a.exec("rollback").catch(() => {}); }
  check("the migration refuses to run without Phase 2A", !!e3 && /Phase 2A|missing functions/.test(e3), e3);
  await no2a.close();

  const a = await F.newDb(PGlite, { dailyWords: true }); const b = await F.newDb(PGlite, { dailyWords: true, events: true });
  const fp = async (d) => JSON.stringify(await rows(d, `select (select jsonb_agg(proname || ':' || md5(pg_get_functiondef(oid)) order by proname) from pg_proc where pronamespace = 'public'::regnamespace and (proname like 'church\\_%' or proname like 'team\\_church\\_%' or proname like 'daily\\_word%' or proname in ('is_admin','has_org_permission','is_org_member'))) as f, (select jsonb_agg(polrelid::regclass::text || ':' || polname order by polrelid::regclass::text, polname) from pg_policy where polrelid::regclass::text in ('profiles','organization_roles','organization_members','church_members','church_groups','church_group_members','church_leadership','daily_words')) as p`));
  check("applying the migration changes no Phase 2A / Phase 3 / Team function and no other table's policy", (await fp(a)) === (await fp(b)));
  await a.close(); await b.close();
}

// =================================================================================================================================================================
section = "G. the migration text itself: ";
// =================================================================================================================================================================
{
  const code = MIG.replace(/--[^\n]*/g, "");
  const created = [...code.matchAll(/create (?:or replace )?(?:unique )?(table|function|trigger|index|policy)\s+(?:if not exists\s+)?(?:public\.)?([a-z_]+)/gi)].map((m) => m[2]);
  check("it creates only ministry_* objects", created.length > 0 && created.every((x) => /^ministry_/.test(x)), created.filter((x) => !/^ministry_/.test(x)).join());
  check("it never alters or drops an existing object", !/alter table public\.(?!ministry_)|drop (table|function|index) /i.test(code), "");
  check("it writes no row anywhere", !/(^|;)\s*(insert\s+into|update\s+public\.|delete\s+from)/im.test(code), "");
  check("the audit columns have no grant to anon or authenticated", !/grant [^;]*(created_by|updated_by|published_by)/i.test(code), "");
  check("there is no policy for PUBLIC and no grant to PUBLIC", !/grant[^;]*\sto\s+(?:[a-z_]+\s*,\s*)*public\s*[;,]/i.test(code) && !/for\s+(?:select|insert|update|delete|all)\s+to\s+(?:[a-z_]+\s*,\s*)*public\b/i.test(code));
  check("no church_ prefixed object is created (Phase 0 verify row 10)", !/create (table|index|function)[^\n]*\bchurch_/i.test(code));
  check("the three permissions are named exactly", /church\.events\.view/.test(MIG) && /church\.events\.manage/.test(MIG) && /church\.events\.publish/.test(MIG));
  check("it is wrapped in one transaction", /^begin;/m.test(MIG) && /^commit;/m.test(MIG));
  check("the public.events (ticketing) table is not referenced or changed", !/public\.events\b|\bon events\b/.test(code));
}

console.log(`\n${fail === 0 ? "OK" : "FAILED"}: ${pass} checks passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
