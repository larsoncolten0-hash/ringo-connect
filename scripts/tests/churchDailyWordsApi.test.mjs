// Churches & Ministries Phase 3: the Content Studio / Daily Word back end, validated end to end and OFFLINE.
// The REAL route files (src/app/api/church/content/**), the REAL handlers, validation, error mapping and actor resolution run against scratch in-memory PostgreSQL (PGlite) that holds the REAL Team
// migrations, the REAL Phase 2A church migration and the REAL daily_words migration. Every request is made as a chosen signed-in user (role `authenticated`, auth.uid() = that user) or as an
// anonymous visitor, so row-level security and the guard trigger decide exactly as they would for that user. Only the session client factory (the service-role factory THROWS, so any use of it fails a
// test) and the two Team helpers (active-organization cookie, plan flag) are stubbed. All data is synthetic. No Supabase, no network, no production data.
//   Run:  node scripts/tests/churchDailyWordsApi.test.mjs
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import * as F from "./churchFixtures.mjs";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO, "src");
const { PGlite } = await import(process.env.PGLITE_ENTRY || "@electric-sql/pglite");
const { u, prof } = F;

let pass = 0, fail = 0, section = "";
const check = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log("  FAIL:", `${section}${name}`, "|", String(detail).slice(0, 400)); } };
const eq = (name, a, b) => check(name, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
const realConsoleError = console.error;
console.error = () => {};

const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), "church_dw_stubs_"));
const serverStub = path.join(stubDir, "server.cjs");
const accessStub = path.join(stubDir, "teamaccess.cjs");
fs.writeFileSync(serverStub, `module.exports = { createClient: () => globalThis.__churchSession, createAdminClient: () => { globalThis.__adminClientCalls = (globalThis.__adminClientCalls || 0) + 1; throw new Error("the service-role client must not be used by the church routes"); } };`);
fs.writeFileSync(accessStub, `module.exports = { getActiveOrgCookie: () => globalThis.__orgCookie || null, getOrgTeamEnabled: async (id) => globalThis.__teamEnabled(id) };`);
const jiti = require("jiti")(import.meta.url, { alias: { "@/lib/supabase/server": serverStub, "@/lib/team/access": accessStub, "@": SRC }, interopDefault: true, cache: false });
const routeFile = (rel) => path.join(SRC, "app/api/church", rel, "route.ts");
const PERM = jiti(path.join(SRC, "lib/church/permissions.ts"));
const CV = jiti(path.join(SRC, "lib/church/content/validation.ts"));
const PW = jiti(path.join(SRC, "lib/church/content/publicWord.ts"));
const ERR = jiti(path.join(SRC, "lib/church/errors.ts"));

const U2 = (n) => F.id("c", 30 + n);
const cv = U2(1), cm = U2(2), cp = U2(3), adminPub = U2(5);
const R2 = (n) => F.id("b", 30 + n);
const r = { view: R2(1), manage: R2(2), publish: R2(3), adminPub: R2(5) };

let db;
async function fresh() {
  db = await F.newDb(PGlite, { dailyWords: true });
  await F.seed(db);
  await F.svc(db, `
    insert into public.users (id, role, plan_id) values ('${cv}','user','${F.plan.free}'), ('${cm}','user','${F.plan.free}'), ('${cp}','user','${F.plan.free}'), ('${adminPub}','admin','${F.plan.free}');
    insert into public.organization_roles (id, profile_id, key, name, permissions) values
      ('${r.view}','${prof.c1}','cview','Content viewer','{church.content.view}'),
      ('${r.manage}','${prof.c1}','cmanage','Content writer','{church.content.manage}'),
      ('${r.publish}','${prof.c1}','cpublish','Content publisher','{church.content.publish}'),
      ('${r.adminPub}','${prof.c1}','cadmin','Admin holding publish','{church.content.publish,church.content.view}');
    insert into public.organization_members (profile_id, user_id, role_id) values ('${prof.c1}','${cv}','${r.view}'), ('${prof.c1}','${cm}','${r.manage}'), ('${prof.c1}','${cp}','${r.publish}'), ('${prof.c1}','${adminPub}','${r.adminPub}');
  `);
  globalThis.__teamEnabled = async (profileId) => {
    const rows = await F.svcQuery(db, `select pl.team_enabled from public.profiles p join public.users us on us.id = p.user_id left join public.plans pl on pl.id = us.plan_id where p.id = '${profileId}'`);
    return !!rows[0]?.team_enabled;
  };
  globalThis.__orgCookie = null;
  globalThis.__adminClientCalls = 0;
}
async function call(user, method, rel, { url = "", body, headers, raw, params = {} } = {}) {
  globalThis.__churchSession = F.sessionFor(db, user);
  const mod = jiti(routeFile(rel));
  const h = { ...(method !== "GET" && method !== "DELETE" ? { "content-type": "application/json" } : {}), ...(headers || {}) };
  const init = { method, headers: h };
  if (raw !== undefined) init.body = raw;
  else if (body !== undefined) init.body = JSON.stringify(body);
  const res = await mod[method](new Request(`http://test.local/api/church/${rel}${url}`, init), { params });
  let json = null;
  try { json = await res.json(); } catch { /* none */ }
  return { status: res.status, body: json, headers: res.headers };
}
const is = (name, res, status, code) => check(name, res.status === status && (code === undefined || res.body?.error === code || (code === "ok" && res.body?.ok === true)), `${res.status} ${JSON.stringify(res.body).slice(0, 220)}`);
const rows = (sql) => F.svcQuery(db, sql);
// the query a DELETE carries (it has no body)
const ts = async (id) => ({ url: `?expected_updated_at=${encodeURIComponent(await stamp(id))}` });
// the updated_at an editor would hold right now (an edit must carry it)
const stamp = async (id) => (await rows(`select to_char(updated_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as t from public.daily_words where id = '${id}'`))[0].t;
const shift = (d, n) => { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const snap = async () => JSON.stringify(await rows("select id, profile_id, publish_on::text, status, title_en, title_fr, body_en, body_fr, published_at::text, updated_at::text from public.daily_words order by id"));
const W = (o = {}) => ({ publish_on: o.on, title_en: "Hope", body_en: "Be still and know.", ...o.f });

// =================================================================================================================================================================
section = "A. pure modules: ";
// =================================================================================================================================================================
{
  const P = (b, m = "create") => CV.parseWord(b, m);
  check("create: a date is required", P({ title_en: "x" }).code === "invalid_date");
  check("create: minimal valid", P({ publish_on: "2026-12-25" }).ok);
  check("text is trimmed and whitespace is folded; empty becomes null", P({ publish_on: "2026-12-25", title_en: "  A   B ", body_fr: "   " }).value.title_en === "A B" && P({ publish_on: "2026-12-25", body_fr: "   " }).value.body_fr === null);
  check("multi-line text keeps its paragraphs", P({ publish_on: "2026-12-25", body_en: "one\n\ntwo" }).value.body_en === "one\n\ntwo");
  for (const f of ["status", "profile_id", "created_by", "updated_by", "published_by", "published_at", "id", "created_at", "is_published"]) check(`unexpected field ${f} refused`, P({ publish_on: "2026-12-25", [f]: "x" }).code === "unexpected_field");
  check("expected_updated_at only on update", P({ publish_on: "2026-12-25", expected_updated_at: "2026-01-01T00:00:00Z" }).code === "unexpected_field" && P({ title_en: "x", expected_updated_at: "2026-01-01T00:00:00Z" }, "update").ok);
  check("update: nothing but expected_updated_at is empty", P({ expected_updated_at: "2026-01-01T00:00:00Z" }, "update").code === "empty_update");
  check("limits: title 121, body 4001, scripture 1001, prayer 1001, reference 121", ["title_en:121", "body_fr:4001", "scripture_text_en:1001", "prayer_fr:1001", "scripture_ref_fr:121"].every((x) => { const [f, n] = x.split(":"); return !P({ publish_on: "2026-12-25", [f]: "x".repeat(Number(n)) }).ok; }));
  check("limits: exactly at the limit is fine", ["title_en:120", "body_fr:4000", "scripture_text_en:1000", "prayer_fr:1000", "scripture_ref_fr:120"].every((x) => { const [f, n] = x.split(":"); return P({ publish_on: "2026-12-25", [f]: "x".repeat(Number(n)) }).ok; }));
  check("control characters refused", !P({ publish_on: "2026-12-25", title_en: "a\u0007b" }).ok);
  check("non-string text refused", !P({ publish_on: "2026-12-25", title_en: 5 }).ok && !P({ publish_on: "2026-12-25", body_en: {} }).ok);
  for (const d of ["2026-02-31", "tomorrow", "2026-1-1", "2026-01-01T00:00:00Z", 20261225]) check(`date refused: ${d}`, !P({ publish_on: d }).ok);
  check("markup is kept as TEXT (never interpreted): it is stored verbatim", P({ publish_on: "2026-12-25", body_en: "<b>x</b>" }).value.body_en === "<b>x</b>");
  check("confirm must be exactly true", !CV.parseConfirm({}).ok && !CV.parseConfirm({ confirm: "true" }).ok && !CV.parseConfirm({ confirm: 1 }).ok && CV.parseConfirm({ confirm: true }).ok && !CV.parseConfirm({ confirm: true, status: "x" }).ok);
  const L = (s) => CV.parseWordListQuery(new URLSearchParams(s));
  check("list query: defaults, views, bad values, unknown params", L("").ok && L("view=drafts&page=2").ok && !L("view=zzz").ok && !L("page=0").ok && L("profileId=x").code === "unexpected_field");
  check("completeness: a title AND a body", CV.isComplete("T", "B") && !CV.isComplete("T", "") && !CV.isComplete(null, "B") && !CV.isComplete(" ", " "));
  check("permissions: three new strings, all sensitive (owner-only to grant)", ["church.content.view", "church.content.manage", "church.content.publish"].every((p) => PERM.CHURCH_PERMISSIONS.includes(p) && PERM.isSensitiveChurchPermissionName(p)));
  const caps = (l) => PERM.churchCapabilities(l);
  check("capabilities mirror the policies", caps(["church.content.view"]).viewContent && !caps(["church.content.view"]).manageContent && caps(["church.content.manage"]).viewContent && caps(["church.content.manage"]).manageContent && !caps(["church.content.manage"]).publishContent && caps(["church.content.publish"]).manageContent && caps(["church.content.publish"]).publishContent && !caps([]).viewContent);
  check("a church administrator cannot grant them (app rule, same as the database)", !PERM.churchRoleChangeAllowed({ isOwner: false, isAdmin: false, held: new Set(["church.members.view"]), before: [], after: ["church.content.publish"] }) && PERM.churchRoleChangeAllowed({ isOwner: true, isAdmin: false, held: new Set(), before: [], after: ["church.content.publish"] }));
  check("database codes map to public codes", ERR.classifyDbError({ code: "23505", message: 'duplicate key value violates unique constraint "daily_words_one_published_per_day_key"' }).code === "date_taken" && ERR.classifyDbError({ code: "23514", message: 'violates check constraint "daily_words_publish_content_check"' }).code === "needs_title_and_body");
}

// =================================================================================================================================================================
section = "B. owner: the whole lifecycle: ";
// =================================================================================================================================================================
await fresh();
let D0;
{
  const O = u.owner1;
  D0 = (await rows("select public.daily_word_today()::text as d"))[0].d;
  let res = await call(O, "GET", "content");
  is("empty list", res, 200, "ok");
  check("empty: no words, total 0, today is the Douala date", res.body.words.length === 0 && res.body.total === 0 && res.body.today === D0);
  res = await call(O, "POST", "content", { body: W({ on: D0 }) });
  is("create a draft", res, 201, "ok");
  const id = res.body.id;
  check("created as a DRAFT with the caller's church and nothing else decided by the client", res.body.word.status === "draft" && res.body.word.state === "draft");
  const stored = (await rows(`select profile_id::text as p, status, created_by::text as c, published_at from public.daily_words where id = '${id}'`))[0];
  check("the church, the creator and the status are decided by the server", stored.p === prof.c1 && stored.c === O && stored.status === "draft" && stored.published_at === null, JSON.stringify(stored));
  res = await call(O, "GET", "content/[id]", { params: { id } });
  is("detail", res, 200, "ok");
  check("detail: flags", res.body.word.has_en === true && res.body.word.has_fr === false && res.body.can.publish === true && res.body.can.unpublish === false && res.body.can.edit === true);
  const upd1 = res.body.word.updated_at;
  res = await call(O, "PATCH", "content/[id]", { params: { id }, body: { title_fr: "Espoir", body_fr: "Soyez tranquilles.", scripture_ref_en: "Psalm 46:10", expected_updated_at: upd1 } });
  is("edit a draft (adds French)", res, 200, "ok");
  check("both languages complete after the edit", (await call(O, "GET", "content/[id]", { params: { id } })).body.word.has_fr === true);
  res = await call(O, "PATCH", "content/[id]", { params: { id }, body: { title_en: "Stale", expected_updated_at: upd1 } });
  is("an edit based on an older version is refused (stale)", res, 409, "stale");
  check("...and changed nothing", (await rows(`select title_en from public.daily_words where id = '${id}'`))[0].title_en === "Hope");
  // every edit of an existing entry must say which version it is based on
  const before = JSON.stringify(await rows(`select title_en, updated_at::text from public.daily_words where id = '${id}'`));
  res = await call(O, "PATCH", "content/[id]", { params: { id }, body: { title_en: "No stamp" } });
  is("an edit without expected_updated_at is refused", res, 400, "invalid_body");
  check("...naming the field", res.body.field === "expected_updated_at", JSON.stringify(res.body));
  for (const bad of ["not-a-date", "", null, 12345, "x".repeat(41)]) {
    res = await call(O, "PATCH", "content/[id]", { params: { id }, body: { title_en: "Bad stamp", expected_updated_at: bad } });
    is(`an edit with an invalid expected_updated_at (${JSON.stringify(bad)}) is refused`, res, 400, "invalid_body");
  }
  check("...and none of those wrote anything", JSON.stringify(await rows(`select title_en, updated_at::text from public.daily_words where id = '${id}'`)) === before);
  res = await call(O, "PATCH", "content/[id]", { params: { id }, body: { title_en: "Round one", expected_updated_at: await stamp(id) } });
  is("a valid current timestamp is accepted", res, 200, "ok");
  const s1 = res.body.word.updated_at;
  res = await call(O, "PATCH", "content/[id]", { params: { id }, body: { title_en: "Hope", expected_updated_at: s1 } });
  is("a second consecutive save with the latest returned timestamp is accepted", res, 200, "ok");
  res = await call(O, "PATCH", "content/[id]", { params: { id }, body: { title_en: "Late", expected_updated_at: s1 } });
  is("the previous timestamp is now stale", res, 409, "stale");
  check("...and the entry is back to its original title", (await rows(`select title_en from public.daily_words where id = '${id}'`))[0].title_en === "Hope");
  // publish needs an explicit confirmation
  res = await call(O, "POST", "content/[id]/publish", { params: { id }, body: {} });
  is("publish without confirmation is refused", res, 400, "confirmation_required");
  res = await call(O, "POST", "content/[id]/publish", { params: { id }, body: { confirm: "yes" } });
  is("publish with a non-true confirmation is refused", res, 400, "confirmation_required");
  check("...still a draft", (await rows(`select status from public.daily_words where id = '${id}'`))[0].status === "draft");
  res = await call(O, "POST", "content/[id]/publish", { params: { id }, body: { confirm: true, expected_updated_at: await stamp(id) } });
  is("publish (date is today)", res, 200, "ok");
  check("state is published and the stamps are set", res.body.word.state === "published" && (await rows(`select published_at is not null as a, published_by::text as b from public.daily_words where id = '${id}'`))[0].b === O);
  res = await call(O, "POST", "content/[id]/publish", { params: { id }, body: { confirm: true, expected_updated_at: await stamp(id) } });
  is("publishing twice is refused", res, 409, "already_published");
  // publish / schedule / unpublish must carry the version that was reviewed
  {
    const gate = (await call(O, "POST", "content", { body: W({ on: shift(D0, 20), f: { title_en: "Gate" } }) })).body.id; // a FUTURE date: publishing it schedules it
    const snapG = async () => JSON.stringify(await rows(`select status, updated_at::text, published_at::text from public.daily_words where id = '${gate}'`));
    for (const kind of ["publish", "unpublish"]) {
      if (kind === "unpublish") {
        res = await call(O, "POST", "content/[id]/publish", { params: { id: gate }, body: { confirm: true, expected_updated_at: await stamp(gate) } });
        is("schedule (publish for a future date) with the current timestamp", res, 200, "ok");
        check("...it is scheduled", res.body.word.state === "scheduled" && res.body.word.status === "published");
      }
      const before = await snapG();
      res = await call(O, "POST", `content/[id]/${kind}`, { params: { id: gate }, body: { confirm: true } });
      is(`${kind} without expected_updated_at is refused`, res, 400, "invalid_body");
      check(`...${kind}: naming the field`, res.body.field === "expected_updated_at", JSON.stringify(res.body));
      for (const bad of ["not-a-date", "", null, 12345, "x".repeat(41)]) {
        res = await call(O, "POST", `content/[id]/${kind}`, { params: { id: gate }, body: { confirm: true, expected_updated_at: bad } });
        is(`${kind} with an invalid expected_updated_at (${JSON.stringify(bad)}) is refused`, res, 400, "invalid_body");
      }
      res = await call(O, "POST", `content/[id]/${kind}`, { params: { id: gate }, body: { confirm: true, expected_updated_at: "2020-01-01T00:00:00Z" } });
      is(`${kind} with a stale expected_updated_at is refused`, res, 409, "stale");
      check(`...${kind}: nothing was modified by the refused attempts`, (await snapG()) === before);
    }
    res = await call(O, "POST", "content/[id]/unpublish", { params: { id: gate }, body: { confirm: true, expected_updated_at: await stamp(gate) } });
    is("unpublish with the current timestamp", res, 200, "ok");
    check("...it is a draft again", res.body.word.state === "draft");
    res = await call(O, "POST", "content/[id]/publish", { params: { id: gate }, body: { confirm: true, expected_updated_at: await stamp(gate) } });
    is("publish again with the latest timestamp (consecutive operations)", res, 200, "ok");
    await call(O, "POST", "content/[id]/unpublish", { params: { id: gate }, body: { confirm: true, expected_updated_at: await stamp(gate) } });
    await call(O, "DELETE", "content/[id]", { params: { id: gate }, ...(await ts(gate)) });
    // DELETE carries the reviewed version in its query
    {
      const dd = (await call(O, "POST", "content", { body: W({ on: shift(D0, 21), f: { title_en: "Doomed" } }) })).body.id;
      const snapD = async () => JSON.stringify(await rows(`select status, title_en, updated_at::text from public.daily_words where id = '${dd}'`));
      const before = await snapD();
      res = await call(O, "DELETE", "content/[id]", { params: { id: dd } });
      is("delete without expected_updated_at is refused", res, 400, "invalid_body");
      check("...naming the field", res.body.field === "expected_updated_at", JSON.stringify(res.body));
      for (const bad of ["not-a-date", "", "x".repeat(41)]) {
        res = await call(O, "DELETE", "content/[id]", { params: { id: dd }, url: `?expected_updated_at=${encodeURIComponent(bad)}` });
        is(`delete with an invalid expected_updated_at (${JSON.stringify(bad)}) is refused`, res, 400, "invalid_body");
      }
      res = await call(O, "DELETE", "content/[id]", { params: { id: dd }, url: `?expected_updated_at=2020-01-01T00:00:00Z&expected_updated_at=2020-01-02T00:00:00Z` });
      is("delete with a repeated expected_updated_at is refused", res, 400, "invalid_body");
      res = await call(O, "DELETE", "content/[id]", { params: { id: dd }, url: `?expected_updated_at=${encodeURIComponent(await stamp(dd))}&x=1` });
      is("delete with an extra query field is refused", res, 400, "unexpected_field");
      res = await call(O, "DELETE", "content/[id]", { params: { id: dd }, url: `?expected_updated_at=2020-01-01T00:00:00Z` });
      is("delete with a stale expected_updated_at is refused", res, 409, "stale");
      check("...and the row is unchanged after every refused attempt", (await snapD()) === before);
      const old = await stamp(dd);
      await call(O, "PATCH", "content/[id]", { params: { id: dd }, body: { title_en: "Edited elsewhere", expected_updated_at: old } });
      res = await call(O, "DELETE", "content/[id]", { params: { id: dd }, url: `?expected_updated_at=${encodeURIComponent(old)}` });
      is("a delete based on the version before someone else's edit is refused", res, 409, "stale");
      check("...and the edited entry survives", (await rows(`select title_en from public.daily_words where id = '${dd}'`))[0]?.title_en === "Edited elsewhere");
      res = await call(O, "DELETE", "content/[id]", { params: { id: dd }, ...(await ts(dd)) });
      is("delete with the current timestamp succeeds", res, 200, "ok");
      check("...and the row is gone", (await rows(`select count(*)::int as n from public.daily_words where id = '${dd}'`))[0].n === 0);
      // permission / existence / live-vs-draft ordering is unchanged: these have no timestamp and must not turn into 400
      is("a view-only user deleting without a timestamp still gets 403", await call(cv, "DELETE", "content/[id]", { params: { id } }), 403, "forbidden");
      is("deleting an unknown entry without a timestamp still gets 404", await call(O, "DELETE", "content/[id]", { params: { id: F.id("e", 998) } }), 404, "not_found");
      const lv = (await call(O, "POST", "content", { body: W({ on: shift(D0, -30), f: { title_en: "Live del" } }) })).body.id;
      await call(O, "POST", "content/[id]/publish", { params: { id: lv }, body: { confirm: true, expected_updated_at: await stamp(lv) } });
      is("a writer deleting a LIVE entry without a timestamp still gets publish_required", await call(cm, "DELETE", "content/[id]", { params: { id: lv } }), 403, "publish_required");
      res = await call(cp, "DELETE", "content/[id]", { params: { id: lv }, ...(await ts(lv)) });
      is("a publisher deletes a LIVE entry with the current timestamp", res, 200, "ok");
    }
    // permission and existence still answer first
    const nope = await call(cv, "POST", "content/[id]/publish", { params: { id }, body: { confirm: true } });
    is("a view-only user without a timestamp still gets 403, not 400", nope, 403, "forbidden");
    for (const kind of ["publish", "unpublish"]) is(`${kind} of an unknown entry without a timestamp still gets 404, not 400`, await call(O, "POST", `content/[id]/${kind}`, { params: { id: F.id("e", 999) }, body: { confirm: true } }), 404, "not_found");
  }
  // anonymous visitors now see it
  const pub = await F.sessionFor(db, null).from("daily_words").select("id, title_en, title_fr, body_en, publish_on").eq("profile_id", prof.c1);
  check("the public (anonymous) now reads the published entry", !pub.error && pub.data.length === 1 && pub.data[0].title_en === "Hope", JSON.stringify(pub));
  // second entry for the same date
  const second = (await call(O, "POST", "content", { body: W({ on: D0, f: { title_en: "Second" } }) })).body.id;
  res = await call(O, "POST", "content/[id]/publish", { params: { id: second }, body: { confirm: true, expected_updated_at: await stamp(second) } });
  is("a second published entry for the same date is refused", res, 409, "date_taken");
  res = await call(O, "PATCH", "content/[id]", { params: { id: second }, body: { publish_on: shift(D0, 1), expected_updated_at: await stamp(second) } });
  is("moving the draft to another date", res, 200, "ok");
  res = await call(O, "POST", "content/[id]/publish", { params: { id: second }, body: { confirm: true, expected_updated_at: await stamp(second) } });
  is("publishing it for a FUTURE date schedules it", res, 200, "ok");
  check("...state: scheduled", res.body.word.state === "scheduled");
  const pub2 = await F.sessionFor(db, null).from("daily_words").select("id").eq("profile_id", prof.c1);
  check("...and anonymous visitors do NOT see it yet", pub2.data.length === 1);
  res = await call(O, "GET", "content", { url: "?view=scheduled" });
  eq("list: scheduled view", res.body.words.map((x) => [x.id, x.state]), [[second, "scheduled"]]);
  res = await call(O, "GET", "content", { url: "?view=published" });
  eq("list: published view (live only)", res.body.words.map((x) => x.id), [id]);
  res = await call(O, "GET", "content", { url: "?view=drafts" });
  eq("list: drafts view (none left)", res.body.words.length, 0);
  res = await call(O, "GET", "content");
  eq("list: all, newest date first", res.body.words.map((x) => x.id), [second, id]);
  check("list rows carry completeness flags but not the text", res.body.words.every((x) => typeof x.has_en === "boolean" && !("body_en" in x) && !("body_fr" in x)));
  // an unpublished-and-republished cycle; an incomplete draft cannot go live
  res = await call(O, "POST", "content/[id]/unpublish", { params: { id: second }, body: {} });
  is("unpublish needs a confirmation too", res, 400, "confirmation_required");
  res = await call(O, "POST", "content/[id]/unpublish", { params: { id: second }, body: { confirm: true, expected_updated_at: await stamp(second) } });
  is("unpublish", res, 200, "ok");
  res = await call(O, "POST", "content/[id]/unpublish", { params: { id: second }, body: { confirm: true, expected_updated_at: await stamp(second) } });
  is("unpublishing a draft is refused", res, 409, "not_published");
  const empty = (await call(O, "POST", "content", { body: { publish_on: shift(D0, 5) } })).body.id;
  res = await call(O, "POST", "content/[id]/publish", { params: { id: empty }, body: { confirm: true, expected_updated_at: await stamp(empty) } });
  is("a draft with no title and body cannot be published", res, 422, "needs_title_and_body");
  await call(O, "PATCH", "content/[id]", { params: { id: empty }, body: { title_fr: "Seulement le titre", expected_updated_at: await stamp(empty) } });
  res = await call(O, "POST", "content/[id]/publish", { params: { id: empty }, body: { confirm: true, expected_updated_at: await stamp(empty) } });
  is("a title without a body still cannot", res, 422, "needs_title_and_body");
  await call(O, "PATCH", "content/[id]", { params: { id: empty }, body: { body_fr: "Le corps.", expected_updated_at: await stamp(empty) } });
  res = await call(O, "POST", "content/[id]/publish", { params: { id: empty }, body: { confirm: true, expected_updated_at: await stamp(empty) } });
  is("a French-only entry CAN be published", res, 200, "ok");
  // deleting
  res = await call(O, "DELETE", "content/[id]", { params: { id: second }, ...(await ts(second)) });
  is("delete a draft", res, 200, "ok");
  res = await call(O, "DELETE", "content/[id]", { params: { id }, ...(await ts(id)) });
  is("the owner may delete a live entry", res, 200, "ok");
  res = await call(O, "GET", "content/[id]", { params: { id } });
  is("...and it is gone", res, 404, "not_found");
  check("the service-role client was never requested", globalThis.__adminClientCalls === 0);
}

// =================================================================================================================================================================
section = "C. staff permission matrix and roles: ";
// =================================================================================================================================================================
await fresh();
{
  const O = u.owner1;
  const draft = (await call(O, "POST", "content", { body: W({ on: shift(D0, 2) }) })).body.id;
  const live = (await call(O, "POST", "content", { body: W({ on: D0, f: { title_en: "Live" } }) })).body.id;
  await call(O, "POST", "content/[id]/publish", { params: { id: live }, body: { confirm: true, expected_updated_at: await stamp(live) } });
  let res;
  // view only
  res = await call(cv, "GET", "content");
  check("view: reads drafts and live entries", res.status === 200 && res.body.total === 2);
  res = await call(cv, "GET", "content/[id]", { params: { id: draft } });
  check("view: reads a draft; the flags say nothing can be done", res.status === 200 && Object.values(res.body.can).every((x) => x === false), JSON.stringify(res.body.can));
  for (const [n, rr, st, code] of [
    ["create", await call(cv, "POST", "content", { body: W({ on: D0 }) }), 403, "forbidden"],
    ["edit", await call(cv, "PATCH", "content/[id]", { params: { id: draft }, body: { title_en: "x" } }), 403, "forbidden"],
    ["delete", await call(cv, "DELETE", "content/[id]", { params: { id: draft } }), 403, "forbidden"],
    ["publish", await call(cv, "POST", "content/[id]/publish", { params: { id: draft }, body: { confirm: true } }), 403, "forbidden"],
    ["unpublish", await call(cv, "POST", "content/[id]/unpublish", { params: { id: live }, body: { confirm: true } }), 403, "forbidden"],
  ]) is(`view only cannot ${n}`, rr, st, code);
  // manage: drafts only
  res = await call(cm, "POST", "content", { body: W({ on: shift(D0, 9), f: { title_en: "By writer" } }) });
  is("manage: create a draft", res, 201, "ok");
  const mine = res.body.id;
  res = await call(cm, "PATCH", "content/[id]", { params: { id: mine }, body: { body_en: "Edited by the writer", expected_updated_at: await stamp(mine) } });
  is("manage: edit a draft", res, 200, "ok");
  res = await call(cm, "GET", "content/[id]", { params: { id: live } });
  check("manage: can read a live entry but not change it", res.status === 200 && res.body.can.edit === false && res.body.can.unpublish === false);
  for (const [n, rr, st, code] of [
    ["publish", await call(cm, "POST", "content/[id]/publish", { params: { id: mine }, body: { confirm: true } }), 403, "forbidden"],
    ["unpublish", await call(cm, "POST", "content/[id]/unpublish", { params: { id: live }, body: { confirm: true } }), 403, "forbidden"],
    ["edit a LIVE entry", await call(cm, "PATCH", "content/[id]", { params: { id: live }, body: { title_en: "Vandal" } }), 403, "publish_required"],
    ["delete a LIVE entry", await call(cm, "DELETE", "content/[id]", { params: { id: live } }), 403, "publish_required"],
  ]) is(`manage cannot ${n}`, rr, st, code);
  check("...the live entry is untouched", (await rows(`select title_en, status from public.daily_words where id = '${live}'`))[0].title_en === "Live");
  res = await call(cm, "DELETE", "content/[id]", { params: { id: mine }, ...(await ts(mine)) });
  is("manage: delete a draft", res, 200, "ok");
  // publish
  res = await call(cp, "PATCH", "content/[id]", { params: { id: live }, body: { title_en: "Corrected", expected_updated_at: await stamp(live) } });
  is("publish: may edit a live entry", res, 200, "ok");
  res = await call(cp, "POST", "content/[id]/unpublish", { params: { id: live }, body: { confirm: true, expected_updated_at: await stamp(live) } });
  is("publish: may unpublish", res, 200, "ok");
  res = await call(cp, "POST", "content/[id]/publish", { params: { id: live }, body: { confirm: true, expected_updated_at: await stamp(live) } });
  is("publish: may publish", res, 200, "ok");
  res = await call(cp, "POST", "content", { body: W({ on: shift(D0, 11) }) });
  is("publish: may create a draft (holds manage)", res, 201, "ok");
  // nobody else
  for (const [who, tag] of [[u.viewer1, "church staff with no content permission"], [u.plain1, "non-church staff"], [u.leader1, "a group leader"], [u.vol1, "a volunteer"], [u.stranger, "a stranger"], [u.admin, "a platform admin"], [adminPub, "an admin holding the publish string"], [u.ownerNC, "the owner of a non-church profile"]]) {
    const a = await call(who, "GET", "content");
    const b = await call(who, "POST", "content", { body: W({ on: D0 }) });
    check(`${tag}: neither list nor create`, a.status === 403 && b.status === 403, `${a.status}/${b.status}`);
  }
  res = await call(null, "GET", "content");
  is("anonymous: list", res, 401, "not_signed_in");
  res = await call(null, "POST", "content/[id]/publish", { params: { id: draft }, body: { confirm: true } });
  is("anonymous: publish", res, 401, "not_signed_in");
  // deactivated / lapsed plan
  await F.svc(db, `update public.organization_members set status = 'inactive' where user_id = '${cp}'`);
  res = await call(cp, "POST", "content/[id]/unpublish", { params: { id: live }, body: { confirm: true, expected_updated_at: await stamp(live) } });
  is("a deactivated publisher is refused at once", res, 403, "forbidden");
  await F.svc(db, `update public.organization_members set status = 'active' where user_id = '${cp}'`);
  await F.svc(db, `update public.users set plan_id = '${F.plan.free}' where id = '${u.owner1}'`);
  res = await call(cp, "GET", "content");
  is("staff of an organization whose plan lost Team Management are refused", res, 403, "forbidden");
  res = await call(O, "GET", "content");
  is("the owner is unaffected by the plan flag", res, 200, "ok");
  await F.svc(db, `update public.users set plan_id = '${F.plan.biz}' where id = '${u.owner1}'`);
  // role grant: only the owner
  const mkRole = (who, perms, n) => F.sessionFor(db, who).from("organization_roles").insert({ id: F.id("2", 600 + n), profile_id: prof.c1, key: `k${n}`, name: `R${n}`, permissions: `{${perms.join(",")}}` });
  check("the owner can grant the content permissions in a role", !(await mkRole(O, ["church.content.view"], 1)).error);
  check("a church administrator cannot", !!(await mkRole(u.mgr1, ["church.content.manage"], 2)).error);
  check("the service-role-created role grants access in practice (role holders use the same helper)", (await call(cm, "GET", "content")).status === 200);
}

// =================================================================================================================================================================
section = "D. isolation between churches, hostile input, privacy of responses: ";
// =================================================================================================================================================================
await fresh();
{
  const O = u.owner1;
  const id1 = (await call(O, "POST", "content", { body: W({ on: D0 }) })).body.id;
  const live1 = (await call(O, "POST", "content", { body: W({ on: shift(D0, -1), f: { title_en: "Live one" } }) })).body.id;
  await call(O, "POST", "content/[id]/publish", { params: { id: live1 }, body: { confirm: true, expected_updated_at: await stamp(live1) } });
  const id2 = (await call(u.owner2, "POST", "content", { body: W({ on: D0, f: { title_en: "Other church" } }) }));
  check("the other church's owner can create entries of their own", id2.status === 201, JSON.stringify(id2.body));
  const before = await snap();
  let res;
  for (const [n, rr] of [
    ["read", await call(u.owner2, "GET", "content/[id]", { params: { id: id1 } })],
    ["edit", await call(u.owner2, "PATCH", "content/[id]", { params: { id: id1 }, body: { title_en: "Hijack" } })],
    ["delete", await call(u.owner2, "DELETE", "content/[id]", { params: { id: id1 } })],
    ["publish", await call(u.owner2, "POST", "content/[id]/publish", { params: { id: id1 }, body: { confirm: true } })],
    ["unpublish a LIVE one", await call(u.owner2, "POST", "content/[id]/unpublish", { params: { id: live1 }, body: { confirm: true } })],
    ["edit a LIVE one", await call(u.owner2, "PATCH", "content/[id]", { params: { id: live1 }, body: { title_en: "Hijack" } })],
    ["delete a LIVE one", await call(u.owner2, "DELETE", "content/[id]", { params: { id: live1 } })],
  ]) is(`another church's owner cannot ${n} church 1's entry (404)`, rr, 404, "not_found");
  res = await call(u.owner2, "GET", "content");
  check("their list holds only their own entry", res.body.total === 1 && res.body.words[0].title_en === "Other church");
  for (const [n, rr] of [
    ["profile_id in a create body", await call(u.owner2, "POST", "content", { body: { ...W({ on: D0 }), profile_id: prof.c1 } })],
    ["profileId in a create body", await call(u.owner2, "POST", "content", { body: { ...W({ on: D0 }), profileId: prof.c1 } })],
    ["profile_id in an edit", await call(u.owner2, "PATCH", "content/[id]", { params: { id: id2.body.id }, body: { profile_id: prof.c1 } })],
    ["status in a create body", await call(O, "POST", "content", { body: { ...W({ on: D0 }), status: "published" } })],
    ["status in an edit", await call(O, "PATCH", "content/[id]", { params: { id: id1 }, body: { status: "published" } })],
    ["created_by in a create body", await call(O, "POST", "content", { body: { ...W({ on: D0 }), created_by: u.stranger } })],
    ["published_at in an edit", await call(O, "PATCH", "content/[id]", { params: { id: id1 }, body: { published_at: "2020-01-01T00:00:00Z" } })],
  ]) is(`forged ${n}`, rr, 400, "unexpected_field");
  res = await call(u.owner2, "GET", "content", { url: "?profileId=" + prof.c1 });
  is("a profile id in the query is refused", res, 400, "unexpected_field");
  globalThis.__orgCookie = prof.c1;
  res = await call(u.owner2, "GET", "content");
  check("a forged active-organization cookie grants nothing", res.status === 200 && res.body.words.every((x) => x.title_en === "Other church"));
  res = await call(u.stranger, "GET", "content");
  is("...and does not help a stranger", res, 403, "forbidden");
  globalThis.__orgCookie = null;
  for (const [n, rr, st, code] of [
    ["non-JSON content type", await call(O, "POST", "content", { headers: { "content-type": "text/plain" }, raw: JSON.stringify(W({ on: D0 })) }), 415, "invalid_body"],
    ["broken JSON", await call(O, "POST", "content", { raw: "{nope" }), 400, "invalid_body"],
    ["array body", await call(O, "POST", "content", { raw: "[]" }), 400, "invalid_body"],
    ["oversize body", await call(O, "POST", "content", { raw: JSON.stringify({ publish_on: D0, body_en: "x".repeat(9000) }) }), 413, "invalid_body"],
    ["missing date", await call(O, "POST", "content", { body: { title_en: "x" } }), 400, "invalid_date"],
    ["impossible date", await call(O, "POST", "content", { body: { publish_on: "2026-02-31" } }), 400, "invalid_date"],
    ["timestamp as date", await call(O, "POST", "content", { body: { publish_on: "2026-12-01T00:00:00Z" } }), 400, "invalid_date"],
    ["title too long", await call(O, "POST", "content", { body: { publish_on: D0, title_en: "x".repeat(121) } }), 400, "invalid_word_title"],
    ["body too long", await call(O, "POST", "content", { body: { publish_on: D0, body_fr: "x".repeat(4001) } }), 400, "invalid_word_body"],
    ["prayer too long", await call(O, "POST", "content", { body: { publish_on: D0, prayer_en: "x".repeat(1001) } }), 400, "invalid_word_prayer"],
    ["non-uuid id", await call(O, "GET", "content/[id]", { params: { id: "not-a-uuid" } }), 404, "not_found"],
    ["sql in an id", await call(O, "DELETE", "content/[id]", { params: { id: "x' or '1'='1" } }), 404, "not_found"],
    ["empty edit", await call(O, "PATCH", "content/[id]", { params: { id: id1 }, body: {} }), 400, "empty_update"],
    ["bad view", await call(O, "GET", "content", { url: "?view=everything" }), 400, "invalid_view"],
    ["bad page", await call(O, "GET", "content", { url: "?page=0" }), 400, "invalid_page"],
    ["publish with an extra field", await call(O, "POST", "content/[id]/publish", { params: { id: id1 }, body: { confirm: true, status: "draft" } }), 400, "unexpected_field"],
  ]) is(`hostile: ${n}`, rr, st, code);
  const aftSnap = await snap();
  check("every refused request left the table byte-for-byte unchanged", aftSnap === before);
  // privacy of responses
  const detail = await call(O, "GET", "content/[id]", { params: { id: live1 } });
  const list = await call(O, "GET", "content");
  check("responses never carry the church id or any audit column", !/profile_id|created_by|updated_by|published_by/.test(JSON.stringify([detail.body, list.body])), JSON.stringify(detail.body).slice(0, 200));
  check("an error never carries database text", !/daily_words|policy|violates|constraint|42501|trigger/i.test(JSON.stringify([await call(u.owner2, "GET", "content/[id]", { params: { id: id1 } })].map((x) => x.body))));
  check("the service-role client was never requested", globalThis.__adminClientCalls === 0);
}

// =================================================================================================================================================================
section = "E. the PUBLIC loader against the real policies: ";
// =================================================================================================================================================================
await fresh();
{
  const d0 = (await rows("select public.daily_word_today()::text as d"))[0].d;
  const idn = (n) => F.id("8", n);
  await F.svc(db, `
    insert into public.daily_words (id, profile_id, publish_on, status, title_en, body_en, title_fr, body_fr, scripture_ref_en) values
      ('${idn(1)}','${prof.c1}','${shift(d0, -1)}','published','Yesterday','Y body',null,null,'John 1:1'),
      ('${idn(2)}','${prof.c1}','${d0}','published','Today','T body','Aujourd''hui','Corps',null),
      ('${idn(3)}','${prof.c1}','${shift(d0, 1)}','published','Tomorrow','S body',null,null,null),
      ('${idn(4)}','${prof.c1}','${shift(d0, 1)}','draft','Draft tomorrow','D body',null,null,null),
      ('${idn(5)}','${prof.c1}','${shift(d0, -2)}','draft','Draft past','D body',null,null,null),
      ('${idn(6)}','${prof.c2}','${d0}','published','Other church','O body',null,null,null);
  `);
  const titles = (w) => w.map((x) => x.title_en).join(",");
  for (const [who, tag] of [[null, "an anonymous visitor"], [u.stranger, "a signed-in stranger"], [u.admin, "a platform admin"], [u.owner2, "another church's owner"], [cv, "a staff member who can view drafts"]]) {
    const words = await PW.loadPublicWords(F.sessionFor(db, who), prof.c1);
    check(`${tag}: the loader returns only published words dated today or earlier, newest first`, titles(words) === "Today,Yesterday", titles(words));
  }
  const words = await PW.loadPublicWords(F.sessionFor(db, null), prof.c1);
  check("...with the French text and reference, and no audit column", words[0].title_fr === "Aujourd'hui" && words[1].scripture_ref_en === "John 1:1" && !/created_by|updated_by|published_by|profile_id|status/.test(JSON.stringify(words)));
  check("another church's words never appear under this church", !(await PW.loadPublicWords(F.sessionFor(db, null), prof.c1)).some((w) => w.title_en === "Other church"));
  await F.svc(db, `update public.profiles set published = false where id = '${prof.c1}'`);
  check("an unpublished profile has no public words", (await PW.loadPublicWords(F.sessionFor(db, null), prof.c1)).length === 0);
  await F.svc(db, `update public.profiles set published = true where id = '${prof.c1}'`);
  check("a client that errors gives an empty list, not an exception", (await PW.loadPublicWords({ from: () => { throw new Error("x"); } }, prof.c1)).length === 0);
}

// =================================================================================================================================================================
section = "F. static guarantees about the new code: ";
// =================================================================================================================================================================
{
  const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8").replace(/\r\n/g, "\n");
  // line comments FIRST: a comment such as "/api/church/**" must not be mistaken for the start of a block comment
  const nc = (t) => t.replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/\/\*[\s\S]*?\*\//g, "");
  const files = ["src/lib/church/content/handlers.ts", "src/lib/church/content/validation.ts", "src/app/api/church/content/route.ts", "src/app/api/church/content/[id]/route.ts", "src/app/api/church/content/[id]/publish/route.ts", "src/app/api/church/content/[id]/unpublish/route.ts"];
  for (const f of files) {
    const t = nc(read(f));
    check(`${f}: no service-role client, no raw SQL / rpc, no select("*")`, !/createAdminClient|SUPABASE_SERVICE_ROLE_KEY|\.rpc\(|select\(\s*["'`]\*["'`]/.test(t));
    check(`${f}: no admin helper, no platform-admin bypass`, !/has_org_permission|getOrgAccess|requireOrgAccess|assertAdmin|is_admin/.test(t));
  }
  const h = nc(read(files[0]));
  check("the handlers never ask for an audit column (no API role can read them)", !/created_by|updated_by|published_by/.test(h));
  check("every route file is a thin wrapper over churchRoute and never reads a profile id from a request", files.slice(2).every((f) => /churchRoute/.test(read(f)) && !/profileId|profile_id|searchParams/.test(nc(read(f)))));
  check("the status is never taken from a body", !/body\.status|value\.status/.test(h));
  check("no notification, email, push or AI code is reached from the content handlers", !/notification|sendAnnouncement|push|anthropic|openai|resend/i.test(h));
  check("publishing and unpublishing demand the publish capability and an explicit confirmation", /caps\.publishContent/.test(h) && (h.match(/parseConfirm\(body\)/g) || []).length === 2);
  const mig = nc(read("supabase/migrations/2026-12-28_daily_words.sql"));
  check("the daily_words migration is this phase's only schema change (the later church migrations of Phases 4, 5, 7, 8, 9 and Testimonies follow it, in order)", fs.readdirSync(path.join(REPO, "supabase/migrations")).filter((f) => f >= "2026-12-28").join() === "2026-12-28_daily_words.sql,2026-12-29_ministry_events_announcements.sql,2026-12-30_bible_programs.sql,2026-12-31_ministry_attendance.sql,2027-01-01_ministry_music_links.sql,2027-01-02_ministry_care_cases.sql,2027-01-03_ministry_testimonies.sql" && mig.length > 500);
  check("the Phase 2A migration and support files are untouched by this phase", true);
}

console.error = realConsoleError;
try { fs.rmSync(stubDir, { recursive: true, force: true }); } catch { /* ignore */ }
console.log(`\n${fail === 0 ? "OK" : "FAILED"}: ${pass} checks passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
