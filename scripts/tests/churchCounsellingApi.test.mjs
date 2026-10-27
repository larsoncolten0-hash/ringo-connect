// Churches & Ministries expansion, Phase 6: counselling requests. The public submit route and the staff routes, validated end to end and OFFLINE.
// The REAL route files (src/app/api/public/church-counselling and src/app/api/church/counselling/**), the REAL handlers, validation and actor resolution run against scratch in-memory PostgreSQL (PGlite)
// that holds the REAL migrations. The public route gets a SERVICE-ROLE-shaped client (the only way in); every staff request runs as a chosen signed-in user. All data is synthetic.
//   Run:  node scripts/tests/churchCounsellingApi.test.mjs
import fs from "fs";
import path from "path";
import { createHarness, kit, SRC } from "./ministryApiHarness.mjs";

const H = await createHarness({ dailyWords: true, events: true, attendance: true, bible: true, music: true, care: true, testimonies: true, landing: true, groupsPastors: true, customers: true, bibleYear: true, counselling: true });
const { F, jiti } = H;
const { u, prof } = F;
const { check, eq, is, section, summary } = kit();
console.error = () => {};
console.info = () => {};

const SUB = jiti(path.join(SRC, "lib/church/counselling/submit.ts"));
const PERM = jiti(path.join(SRC, "lib/church/permissions.ts"));
const MODS = jiti(path.join(SRC, "lib/church/modules.ts"));
const PUBROUTE = path.join(SRC, "app/api/public/church-counselling/route.ts");

const VIEWER = F.id("c", 721), MANAGER = F.id("c", 722), OTHER = F.id("c", 723);
const R = { view: F.id("b", 721), manage: F.id("b", 722), other: F.id("b", 723) };
const EXTRA = `
  insert into public.users (id, role, plan_id) values ('${VIEWER}','user','${F.plan.free}'), ('${MANAGER}','user','${F.plan.free}'), ('${OTHER}','user','${F.plan.free}');
  insert into public.organization_roles (id, profile_id, key, name, permissions) values
    ('${R.view}','${prof.c1}','cview','Counselling viewer','{church.counselling.view}'),
    ('${R.manage}','${prof.c1}','cmanage','Counselling manager','{church.counselling.manage}'),
    ('${R.other}','${prof.c1}','cother','Members only','{church.members.view,church.members.manage}');
  insert into public.organization_members (profile_id, user_id, role_id) values ('${prof.c1}','${VIEWER}','${R.view}'), ('${prof.c1}','${MANAGER}','${R.manage}'), ('${prof.c1}','${OTHER}','${R.other}');
  update public.profiles set username = 'graceassembly' where id = '${prof.c1}';
  update public.profiles set username = 'secondchurch' where id = '${prof.c2}';
  update public.profiles set username = 'notachurch' where id = '${prof.nc}';
  update public.profiles set username = 'hiddenchurch', published = false where id = '${prof.c3}';
`;
const FEATURES_ON = `insert into public.church_features (profile_id, counselling) values ('${prof.c1}', true), ('${prof.c2}', false)`;
const O = u.owner1;
let seq = 0;
const key = () => F.id("3", 4000 + ++seq);
const REASON = "I am struggling after a loss in my family and would like to talk.";
const PAYLOAD = (o = {}) => ({ username: "graceassembly", submission_key: key(), full_name: "Marie Ngono", phone: "+237 670 12 34 56", email: "marie@example.test", reason: REASON, lang: "en", contact_consent: true, website: "", ...o });
function installAdmin() { globalThis.__adminFactory = () => F.sessionFor(H.db, null, { role: "service_role" }); }
async function send(body, { origin = "http://test.local", host = "test.local", contentType = "application/json", raw, sameOrigin = true } = {}) {
  installAdmin();
  globalThis.__sameOrigin = sameOrigin;
  const mod = jiti(PUBROUTE);
  const headers = { ...(contentType ? { "content-type": contentType } : {}), ...(origin ? { origin } : {}), host };
  const res = await mod.POST(new Request("http://test.local/api/public/church-counselling", { method: "POST", headers, body: raw !== undefined ? raw : JSON.stringify(body) }));
  let json = null; try { json = await res.json(); } catch { /* none */ }
  return { status: res.status, body: json, headers: res.headers };
}
const rowsOf = (sql) => H.rows(sql);
const count = async () => (await rowsOf("select count(*)::int as n from public.church_counselling_requests"))[0].n;
const list = (who, qs = "") => H.call(who, "GET", `church/counselling${qs ? "?" + qs : ""}`);
const get = (who, id) => H.call(who, "GET", "church/counselling/[id]", { params: { id } });
const patch = (who, id, body) => H.call(who, "PATCH", "church/counselling/[id]", { params: { id }, body });
const del = (who, id, v) => H.call(who, "DELETE", `church/counselling/[id]${v ? "?expected_updated_at=" + encodeURIComponent(v) : ""}`, { params: { id } });
const pending = (who) => H.call(who, "GET", "church/counselling/pending");
const stamp = (id) => H.stamp("church_counselling_requests", id);
const newReq = async (o = {}) => { const res = await send(PAYLOAD(o)); if (res.status !== 200) throw new Error("setup failed " + JSON.stringify(res.body)); return (await rowsOf("select id from public.church_counselling_requests order by created_at desc, id limit 1"))[0].id; };
const fresh = async () => { await H.fresh(EXTRA); await F.svc(H.db, FEATURES_ON); };

section("A. input validation (pure): ");
{
  const P = SUB.parseCounsellingRequest;
  check("a valid request is accepted and cleaned", P(PAYLOAD()).ok && P(PAYLOAD()).value.phone === "237670123456" && P(PAYLOAD()).value.email === "marie@example.test");
  check("name: too short, too long, control characters and markup are refused", ["A", "x".repeat(121), "Bad\u0000Name", "<b>Name</b>", 5, null].every((v) => P(PAYLOAD({ full_name: v })).code === "invalid_name"));
  check("phone: letters, too short and wrong types are refused", ["abc", "12345", 670123456, null].every((v) => P(PAYLOAD({ phone: v })).code === "invalid_phone"));
  check("the e-mail is optional, lower-cased, and a bad one is refused", P(PAYLOAD({ email: "" })).value.email === null && P(PAYLOAD({ email: undefined })).ok && P(PAYLOAD({ email: "Marie@Example.TEST" })).value.email === "marie@example.test" && P(PAYLOAD({ email: "marie" })).code === "invalid_email");
  check("reason: under 10, over 1000 and wrong types are refused; line breaks are kept", P(PAYLOAD({ reason: "too short" })).code === "invalid_reason" && P(PAYLOAD({ reason: "x".repeat(1001) })).code === "invalid_reason" && P(PAYLOAD({ reason: 5 })).code === "invalid_reason" && P(PAYLOAD({ reason: "First line here.\n\nSecond line here." })).value.reason.includes("\n\n"));
  check("the contact agreement must be exactly true", P(PAYLOAD({ contact_consent: false })).code === "consent_required" && P(PAYLOAD({ contact_consent: "yes" })).code === "consent_required" && P(PAYLOAD({ contact_consent: undefined })).code === "consent_required");
  check("username / key / language are validated", P(PAYLOAD({ username: "../x" })).code === "invalid_request" && P(PAYLOAD({ submission_key: "x" })).code === "invalid_request" && P(PAYLOAD({ lang: "de" })).code === "invalid_request" && P(PAYLOAD({ lang: "fr" })).value.lang === "fr" && P(PAYLOAD({ username: "GraceAssembly" })).value.username === "graceassembly");
  check("a church id, a status, a decision or any other field is REFUSED, never ignored", ["profile_id", "id", "status", "decision_note", "decided_at", "decided_by", "created_at"].every((f) => P(PAYLOAD({ [f]: "x" })).code === "unexpected_field"));
  check("not an object", P(null).code === "invalid_body" && P([]).code === "invalid_body" && P("x").code === "invalid_body");
  check("the honeypot is detected", P(PAYLOAD({ website: "http://spam" })).value.bot === true && P(PAYLOAD()).value.bot === false);
  check("permissions: view and manage are registered and SENSITIVE (owner-only to grant)", ["church.counselling.view", "church.counselling.manage"].every((p) => PERM.CHURCH_PERMISSIONS.includes(p) && PERM.isSensitiveChurchPermissionName(p)));
  check("capabilities: manage implies view, view does not imply manage, nothing else grants either", PERM.churchCapabilities(["church.counselling.manage"]).viewCounselling && PERM.churchCapabilities(["church.counselling.view"]).viewCounselling && !PERM.churchCapabilities(["church.counselling.view"]).manageCounselling && !PERM.churchCapabilities(["church.members.view", "church.members.manage", "church.care.publish"]).viewCounselling);
  const keys = (p, owner = false) => MODS.accessibleChurchModules(PERM.churchCapabilities(p), owner).map((m) => m.key);
  check("the Counselling module appears only for people with a counselling right", keys(["church.counselling.view"]).includes("counselling") && !keys(["church.members.view"]).includes("counselling") && keys(PERM.CHURCH_PERMISSIONS, true).includes("counselling"));
}

section("B. the public route stores a request safely: ");
{
  await fresh();
  const ok = await send(PAYLOAD());
  is("a valid request from a visitor with no account: 200", ok, 200, "ok");
  eq("...the answer is only { ok: true } (no id, no count)", ok.body, { ok: true });
  check("...with no-store caching", ok.headers.get("cache-control") === "no-store");
  eq("one row was stored for the RIGHT church, pending", (await rowsOf("select profile_id, full_name, phone, email, lang, status from public.church_counselling_requests"))[0], { profile_id: prof.c1, full_name: "Marie Ngono", phone: "237670123456", email: "marie@example.test", lang: "en", status: "pending" });
  const fr = await send(PAYLOAD({ lang: "fr", full_name: "Jean Mballa", phone: "699001133", email: "", reason: "Je voudrais parler de ma famille avec un pasteur." }));
  is("a French request works", fr, 200, "ok");
  eq("...a local Cameroon number got its country code, no e-mail is fine", (await rowsOf("select phone, lang, email from public.church_counselling_requests where full_name = 'Jean Mballa'"))[0], { phone: "237699001133", lang: "fr", email: null });
}

section("C. the public route refuses what it should: ");
{
  await fresh();
  const before = await count();
  is("not same-origin: 403", await send(PAYLOAD(), { origin: "http://evil.example", sameOrigin: false }), 403, "forbidden");
  is("not JSON: 415", await send(PAYLOAD(), { contentType: "text/plain" }), 415, "invalid_body");
  is("broken JSON: 400", await send(null, { raw: "{not json" }), 400, "invalid_body");
  is("oversized body: 413", await send(null, { raw: JSON.stringify(PAYLOAD({ reason: "x".repeat(20000) })) }), 413, "invalid_body");
  is("invalid name: 400 with the field", await send(PAYLOAD({ full_name: "A" })), 400, "invalid_name");
  is("invalid phone: 400", await send(PAYLOAD({ phone: "12" })), 400, "invalid_phone");
  is("invalid reason: 400", await send(PAYLOAD({ reason: "short" })), 400, "invalid_reason");
  is("no contact agreement: 400", await send(PAYLOAD({ contact_consent: false })), 400, "consent_required");
  is("an unknown field (church id) is refused: 400", await send(PAYLOAD({ profile_id: prof.c2 })), 400, "unexpected_field");
  is("a church that does not exist: 404", await send(PAYLOAD({ username: "nobodyhere" })), 404, "not_found");
  is("a profile that is not a church: 404", await send(PAYLOAD({ username: "notachurch" })), 404, "not_found");
  is("an UNPUBLISHED church page: 404 (the same answer)", await send(PAYLOAD({ username: "hiddenchurch" })), 404, "not_found");
  is("a church whose owner switched counselling OFF: 404 (the same answer)", await send(PAYLOAD({ username: "secondchurch" })), 404, "not_found");
  eq("none of these stored anything", await count(), before);
  const bot = await send(PAYLOAD({ website: "http://spam.example" }));
  is("a bot filling the hidden field gets the same plain ok", bot, 200, "ok");
  eq("...and NOTHING is stored", await count(), before);
}

section("D. the switch, duplicates and flooding: ");
{
  await fresh();
  const k = key();
  is("first send", await send(PAYLOAD({ submission_key: k })), 200, "ok");
  is("the same form key again: ok", await send(PAYLOAD({ submission_key: k })), 200, "ok");
  is("the same number with the same words again: ok", await send(PAYLOAD()), 200, "ok");
  eq("...one request in all", await count(), 1);
  await F.svc(H.db, `update public.church_features set counselling = false where profile_id = '${prof.c1}'`);
  is("the owner switches counselling off: the page takes no more requests", await send(PAYLOAD({ reason: "A different reason that is long enough." })), 404, "not_found");
  await F.svc(H.db, `update public.church_features set counselling = true where profile_id = '${prof.c1}'`);
  await F.svc(H.db, "delete from public.church_counselling_requests");
  for (let i = 0; i < SUB.RATE.phonePerHour; i++) is(`request ${i + 1} from one number`, await send(PAYLOAD({ reason: `Reason number ${i} that is long enough.` })), 200, "ok");
  is("the next request from the same number within the hour: 429", await send(PAYLOAD({ reason: "One more reason that is long enough." })), 429, "too_many");
  is("a different number still gets through", await send(PAYLOAD({ phone: "699 11 22 33", reason: "Another person with another reason." })), 200, "ok");
}

section("E. the staff list never shows the reason: ");
{
  await fresh();
  const id = await newReq();
  await newReq({ full_name: "Paul Atangana", phone: "699 55 44 33", reason: "I need help with a hard decision at work." });
  is("anonymous: 401", await list(null), 401);
  is("a stranger: 403", await list(u.stranger), 403);
  is("a members manager without counselling rights: 403", await list(u.mgr1), 403);
  is("a members-only role: 403", await list(OTHER), 403);
  is("a group leader (not staff): 403", await list(u.leader1), 403);
  is("a platform admin who is not the owner: 403", await list(u.admin), 403);
  const other = await list(u.owner2);
  check("the owner of another church sees only their own church: nothing of this one", other.status === 200 && other.body.items.length === 0 && other.body.total === 0, JSON.stringify(other.body));
  for (const [label, who] of [["the owner", O], ["a counselling viewer", VIEWER], ["a counselling manager", MANAGER]]) {
    const r = await list(who);
    check(`${label} sees the two requests`, r.status === 200 && r.body.items.length === 2 && r.body.total === 2, JSON.stringify(r.body).slice(0, 200));
    check(`${label}: a list row holds a name, language, status and dates, and NOTHING private`, r.body.items.every((x) => Object.keys(x).sort().join() === "created_at,decided_at,full_name,id,lang,status,updated_at") && !/struggling|hard decision|2376|@example/.test(JSON.stringify(r.body)), JSON.stringify(r.body).slice(0, 200));
  }
  is("filter by status", await list(O, "status=approved"), 200);
  eq("...nothing is approved yet", (await list(O, "status=approved")).body.items.length, 0);
  eq("search by name", (await list(O, "q=atangana")).body.items.map((x) => x.full_name), ["Paul Atangana"]);
  is("an unknown status: 400", await list(O, "status=closed"), 400, "invalid_status");
  is("a bad page: 400", await list(O, "page=0"), 400, "invalid_page");
  is("an unexpected query: 400", await list(O, "reason=x"), 400, "unexpected_field");
  is("a very long search: 400", await list(O, "q=" + "x".repeat(81)), 400, "invalid_q");
  void id;
}

section("F. one request in detail, and who may decide: ");
{
  await fresh();
  const id = await newReq();
  is("anonymous: 401", await get(null, id), 401);
  is("a stranger: 403", await get(u.stranger, id), 403);
  is("a members manager: 403", await get(u.mgr1, id), 403);
  is("a platform admin who is not the owner: 403", await get(u.admin, id), 403);
  is("a bad id: 404", await get(O, "nope"), 404);
  is("an id that does not exist: 404", await get(O, F.id("3", 9999)), 404, "not_found");
  const v = await get(VIEWER, id);
  check("a viewer reads the reason, the contact details and the history", v.status === 200 && v.body.item.reason === REASON && v.body.item.phone === "237670123456" && v.body.history.length === 0 && v.body.can_decide === false, JSON.stringify(v.body).slice(0, 200));
  check("the internal form key is never returned", !("submission_key" in v.body.item) && !("decided_by" in v.body.item));
  const m = await get(MANAGER, id);
  check("a manager is told they can decide", m.status === 200 && m.body.can_decide === true);
  const st = await stamp(id);
  is("a viewer cannot decide: 403", await patch(VIEWER, id, { status: "approved", expected_updated_at: st }), 403);
  is("the version is mandatory: 400", await patch(MANAGER, id, { status: "approved" }), 400, "invalid_body");
  is("an unknown status: 400", await patch(MANAGER, id, { status: "closed", expected_updated_at: st }), 400, "invalid_status");
  is("the person's words cannot be edited: 400", await patch(MANAGER, id, { reason: "Edited", expected_updated_at: st }), 400, "unexpected_field");
  is("nor the name or phone: 400", await patch(MANAGER, id, { full_name: "Someone", expected_updated_at: st }), 400, "unexpected_field");
  is("a stale version: 409", await patch(MANAGER, id, { status: "approved", expected_updated_at: "2020-01-01T00:00:00Z" }), 409, "stale");
  const done = await patch(MANAGER, id, { status: "approved", decision_note: "Pastor Joy will call on Monday.", expected_updated_at: st });
  is("a manager approves with a private note", done, 200, "ok");
  check("the answer holds the decision and the note", done.body.item.status === "approved" && done.body.item.decision_note === "Pastor Joy will call on Monday." && done.body.item.decided_at);
  const after = await get(O, id);
  check("the history shows pending -> approved, with no personal text", after.body.history.length === 1 && after.body.history[0].from_status === "pending" && after.body.history[0].to_status === "approved" && Object.keys(after.body.history[0]).sort().join() === "created_at,from_status,id,to_status", JSON.stringify(after.body.history));
  is("the old version can no longer be used: 409", await patch(O, id, { status: "declined", expected_updated_at: st }), 409, "stale");
}

section("G. waiting count and delete: ");
{
  await fresh();
  const a = await newReq();
  await newReq({ phone: "699 55 44 33", reason: "A second person with a long enough reason." });
  is("anonymous: 401", await pending(null), 401);
  is("a members manager: 403", await pending(u.mgr1), 403);
  const p = await pending(VIEWER);
  check("a viewer gets a count and nothing else", p.status === 200 && p.body.pending === 2 && Object.keys(p.body).sort().join() === "ok,pending", JSON.stringify(p.body));
  await patch(MANAGER, a, { status: "declined", expected_updated_at: await stamp(a) });
  eq("the count follows the decisions", (await pending(O)).body.pending, 1);
  is("a viewer cannot delete: 403", await del(VIEWER, a, await stamp(a)), 403);
  is("the version is mandatory: 400", await del(MANAGER, a), 400, "invalid_body");
  is("a stale version: 409", await del(MANAGER, a, "2020-01-01T00:00:00Z"), 409, "stale");
  is("a platform admin who is not the owner: 403", await del(u.admin, a, await stamp(a)), 403);
  is("a manager deletes", await del(MANAGER, a, await stamp(a)), 200, "ok");
  eq("...one request is left", await count(), 1);
  eq("...and its history went with it", (await rowsOf("select count(*)::int n from public.church_counselling_history"))[0].n, 0);
  is("deleting it again: 404", await del(MANAGER, a, "2020-01-01T00:00:00Z"), 404, "not_found");
}

section("H. privacy boundaries (static): ");
{
  const walk = (dir, out = []) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(e.name)) out.push(p); } return out; };
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const zones = ["lib/ai", "lib/analytics", "lib/pixelClient.ts", "lib/pixelEvents.ts", "lib/metaConversions.ts", "lib/overview", "lib/reports", "lib/watchdog", "lib/activity"].map((z) => path.join(SRC, z)).filter((z) => fs.existsSync(z));
  const files = zones.flatMap((z) => (fs.statSync(z).isDirectory() ? walk(z) : [z]));
  const leaks = files.filter((f) => /church_counselling|counselling_requests|church\/counselling/.test(strip(fs.readFileSync(f, "utf8"))));
  check("no AI, analytics, pixel, overview, report, watchdog or activity code reads a counselling request", leaks.length === 0, leaks.map((f) => path.relative(SRC, f)).join());
  const mine = ["lib/church/counselling/handlers.ts", "lib/church/counselling/submit.ts", "app/api/public/church-counselling/route.ts", "app/api/church/counselling/route.ts", "app/api/church/counselling/[id]/route.ts", "app/api/church/counselling/pending/route.ts"].map((f) => strip(fs.readFileSync(path.join(SRC, f), "utf8")));
  const logs = mine.flatMap((t) => t.match(/console\.(error|info|warn|log)\([^;]*;/g) || []);
  check("every log line in the counselling code holds a scope and a code only (never the reason, a name, a phone or an e-mail)", logs.length > 0 && logs.every((l) => !/reason|full_name|phone|email|note|body|message/.test(l.replace(/scope: "church_counselling"/, ""))), logs.join(" | "));
  check("the staff handlers use only the signed-in person's own session (no service role)", !/createAdminClient|service_role/.test(mine[0]));
  check("the list query never selects the reason", /const LIST_COLS = "[^"]*"/.test(fs.readFileSync(path.join(SRC, "lib/church/counselling/handlers.ts"), "utf8")) && !/LIST_COLS = "[^"]*reason/.test(fs.readFileSync(path.join(SRC, "lib/church/counselling/handlers.ts"), "utf8")));
  const knowledge = strip(fs.readFileSync(path.join(SRC, "lib/ai/knowledge/modules/churchMinistries.ts"), "utf8"));
  check("the church knowledge module reads no counselling table", !/church_counselling/.test(knowledge));
}

await H.close();
process.exit(summary());
