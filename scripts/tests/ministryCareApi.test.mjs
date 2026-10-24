// Churches & Ministries Phase 9: the Care & Support case and consent back end (NO money), validated end to end and OFFLINE.
// The REAL route files (src/app/api/church/care/**), the REAL handlers, validation, error mapping and actor resolution run against scratch in-memory PostgreSQL (PGlite) that holds the REAL Team
// migrations, the REAL Phase 2A church migration and the REAL Phase 3-9 migrations. See scripts/tests/ministryApiHarness.mjs.
//   Run:  node scripts/tests/ministryCareApi.test.mjs
import fs from "fs";
import path from "path";
import { createHarness, kit, SRC, REPO } from "./ministryApiHarness.mjs";

const H = await createHarness({ dailyWords: true, events: true, attendance: true, bible: true, music: true, care: true });
const { F, jiti } = H;
const { u, prof, m } = F;
const { check, eq, is, section, summary } = kit();
console.error = () => {};

const CH = jiti(path.join(SRC, "lib/church/care/handlers.ts"));
const PERM = jiti(path.join(SRC, "lib/church/permissions.ts"));
const ERR = jiti(path.join(SRC, "lib/church/errors.ts"));
const ET = jiti(path.join(SRC, "components/church/lifecycle/errorText.ts"));
const TR = jiti(path.join(SRC, "lib/i18n/translations.ts")).translations;

const U2 = (n) => F.id("c", 150 + n);
const viewer = U2(1), mgr = U2(2), pub = U2(3), noPerm = U2(4), adminPub = U2(5);
const R2 = (n) => F.id("b", 150 + n);
const r = { view: R2(1), mgr: R2(2), pub: R2(3), other: R2(4), adminPub: R2(5) };
const EXTRA = `
  insert into public.users (id, role, plan_id) values ('${viewer}','user','${F.plan.free}'), ('${mgr}','user','${F.plan.free}'), ('${pub}','user','${F.plan.free}'), ('${noPerm}','user','${F.plan.free}'), ('${adminPub}','admin','${F.plan.free}');
  insert into public.organization_roles (id, profile_id, key, name, permissions) values
    ('${r.view}','${prof.c1}','cview','Care viewer','{church.care.view,church.members.view}'),
    ('${r.mgr}','${prof.c1}','cmgr','Care manager','{church.care.manage}'),
    ('${r.pub}','${prof.c1}','cpub','Care publisher','{church.care.publish}'),
    ('${r.other}','${prof.c1}','cother','Events publisher','{church.events.publish}'),
    ('${r.adminPub}','${prof.c1}','cadmin','Admin holding care','{church.care.publish,church.care.manage,church.care.view}');
  insert into public.organization_members (profile_id, user_id, role_id) values ('${prof.c1}','${viewer}','${r.view}'), ('${prof.c1}','${mgr}','${r.mgr}'), ('${prof.c1}','${pub}','${r.pub}'), ('${prof.c1}','${noPerm}','${r.other}'), ('${prof.c1}','${adminPub}','${r.adminPub}');
`;
const O = u.owner1;
const list = (who, qs = "") => H.call(who, "GET", `church/care${qs ? "?" + qs : ""}`);
const create = (who, body) => H.call(who, "POST", "church/care", { body });
const get = (who, id) => H.call(who, "GET", "church/care/[id]", { params: { id } });
const patch = (who, id, body) => H.call(who, "PATCH", "church/care/[id]", { params: { id }, body });
const del = (who, id, stamp) => H.call(who, "DELETE", "church/care/[id]", { params: { id }, url: stamp === undefined ? "" : `?expected_updated_at=${encodeURIComponent(stamp)}` });
const publish = (who, id, body) => H.call(who, "POST", "church/care/[id]/publish", { params: { id }, body });
const unpublish = (who, id, body) => H.call(who, "POST", "church/care/[id]/unpublish", { params: { id }, body });
const consentList = (who, id) => H.call(who, "GET", "church/care/[id]/consent", { params: { id } });
const consentAdd = (who, id, body) => H.call(who, "POST", "church/care/[id]/consent", { params: { id }, body });
const benGet = (who, id) => H.call(who, "GET", "church/care/[id]/beneficiary", { params: { id } });
const benPut = (who, id, body) => H.call(who, "PUT", "church/care/[id]/beneficiary", { params: { id }, body });
const benDel = (who, id) => H.call(who, "DELETE", "church/care/[id]/beneficiary", { params: { id } });
const CASE = (o = {}) => ({ title_en: "Help with a hospital bill", summary_en: "A member of our church needs support.", category: "medical", ...o });
const CONSENT = (o = {}) => ({ kind: "granted", given_by: "beneficiary", method: "written", ...o });
const stamp = (id) => H.stamp("ministry_care_cases", id);
const row = async (id) => (await H.rows(`select status, consent_state from public.ministry_care_cases where id = '${id}'`))[0];

section("A. input validation (pure): ");
{
  const P = CH.parseCase;
  check("create: a valid case", P(CASE(), "create").ok);
  check("category must be one of the fixed list", P(CASE({ category: "lottery" }), "create").code === "invalid_category" && CH.CARE_CATEGORIES.every((c) => P(CASE({ category: c }), "create").ok));
  check("title / summary length limits", P(CASE({ title_en: "x".repeat(121) }), "create").code === "invalid_title" && P(CASE({ summary_fr: "x".repeat(2001) }), "create").code === "invalid_summary");
  check("no other field is accepted (status, consent_state, church, beneficiary, audit, any money field)", ["status", "consent_state", "profile_id", "id", "created_by", "published_at", "beneficiary", "member_id", "amount", "target", "currency"].every((f) => P(CASE({ [f]: "x" }), "create").code === "unexpected_field"));
  check("create refuses expected_updated_at; update needs a change", P(CASE({ expected_updated_at: "2026-01-01T00:00:00Z" }), "create").code === "unexpected_field" && P({}, "update").code === "empty_update");
  const C = CH.parseConsentBody;
  check("consent: a valid record", C(CONSENT()).ok && C(CONSENT({ kind: "withdrawn", given_by: "guardian", method: "verbal_witnessed" })).ok);
  check("consent: every field is required and from a fixed list", C({}).code === "invalid_consent_kind" && C(CONSENT({ kind: "maybe" })).code === "invalid_consent_kind" && C(CONSENT({ given_by: "pastor" })).code === "invalid_consent_given_by" && C(CONSENT({ method: "text" })).code === "invalid_consent_method");
  check("consent: no free text, no case id, no recorder, no date", ["note", "case_id", "recorded_by", "created_at", "profile_id"].every((f) => C(CONSENT({ [f]: "x" })).code === "unexpected_field"));
  check("beneficiary: a uuid only", CH.parseBeneficiaryBody({ member_id: m.admin }).ok && CH.parseBeneficiaryBody({ member_id: "x" }).code === "invalid_member_id" && CH.parseBeneficiaryBody({ member_id: m.admin, name: "A" }).code === "unexpected_field");
  check("capabilities come from the care strings only", PERM.churchCapabilities(["church.care.view"]).viewCare && !PERM.churchCapabilities(["church.care.view"]).manageCare && PERM.churchCapabilities(["church.care.manage"]).manageCare && !PERM.churchCapabilities(["church.care.manage"]).publishCare && PERM.churchCapabilities(["church.care.publish"]).manageCare && PERM.churchCapabilities(["church.care.publish"]).publishCare && !PERM.churchCapabilities(["church.events.publish", "church.members.view", "church.reports.view"]).viewCare);
  check("the strings are registered and SENSITIVE (owner-only to grant)", ["church.care.view", "church.care.manage", "church.care.publish"].every((p) => PERM.CHURCH_PERMISSIONS.includes(p) && PERM.isSensitiveChurchPermissionName(p)));
  const cls = (message, code = "23514") => ERR.classifyDbError({ message, code });
  check("db codes", cls("care_consent_required").code === "needs_consent" && cls("care_consent_required").status === 422 && cls("care_child_not_allowed").code === "care_child_not_allowed" && cls("care_member_missing").status === 404 && cls("care_profile_required").status === 403 && cls('new row violates check constraint "ministry_care_cases_publish_content_check"').code === "needs_title_and_summary" && cls('violates check constraint "ministry_care_cases_category_check"').code === "invalid_category");
}

section("B. permissions: ");
{
  await H.fresh(EXTRA);
  is("anonymous: 401", await list(null), 401);
  is("anonymous cannot create: 401", await create(null, CASE()), 401);
  is("a stranger: 403", await list(u.stranger), 403);
  is("a staff member without a care permission: 403", await list(noPerm), 403);
  is("a platform admin who is not the owner: 403", await list(adminPub), 403);
  is("the owner can list", await list(O), 200, "ok");
  is("a viewer can list", await list(viewer), 200, "ok");
  is("a viewer cannot create: 403", await create(viewer, CASE()), 403);
  const mc = await create(mgr, CASE());
  is("a manager can create a draft", mc, 201, "ok");
  const id = mc.body.id;
  eq("it is a PRIVATE draft with no consent", await row(id), { status: "draft", consent_state: "none" });
  is("the viewer can open it", await get(viewer, id), 200, "ok");
  is("a stranger gets 403 on it", await get(u.stranger, id), 403);
  is("another church's owner gets 404 (not this church's case)", await get(u.owner2, id), 404);
  is("an unknown id is 404, a non-uuid is 404", await get(O, F.id("1", 999)), 404);
  is("a non-uuid is 404", await get(O, "nope"), 404);
  const st = await stamp(id);
  is("a viewer cannot edit: 403", await patch(viewer, id, { title_en: "x", expected_updated_at: st }), 403);
  is("a manager can edit a draft", await patch(mgr, id, { title_en: "Edited", expected_updated_at: st }), 200, "ok");
  is("an edit without the reviewed version is refused", await patch(mgr, id, { title_en: "x" }), 400, "invalid_body");
  is("a stale edit is a 409", await patch(mgr, id, { title_en: "y", expected_updated_at: st }), 409, "stale");
  is("the manager cannot publish: 403", await publish(mgr, id, { confirm: true, expected_updated_at: await stamp(id) }), 403);
  is("the viewer cannot record consent: 403", await consentAdd(viewer, id, CONSENT()), 403);
  is("the viewer can read the consent record", await consentList(viewer, id), 200, "ok");
  is("the member without a care permission cannot read it: 403", await consentList(noPerm, id), 403);
  is("a stranger cannot read it: 403", await consentList(u.stranger, id), 403);
  is("a platform admin who is not the owner cannot read it: 403", await consentList(adminPub, id), 403);
  is("a viewer cannot link a person: 403", await benPut(viewer, id, { member_id: m.other }), 403);
  is("a group leader (not staff) is refused", await list(u.leader1), 403);
}

section("C. the privacy flow: ");
{
  await H.fresh(EXTRA);
  const id = (await create(O, CASE())).body.id;
  is("the new case is not public", { status: (await H.rows(`select count(*)::int as n from public.ministry_care_cases where status='published'`))[0].n === 0 ? 200 : 500 }, 200);
  const st1 = await stamp(id);
  is("publishing WITHOUT consent is refused with needs_consent", await publish(pub, id, { confirm: true, expected_updated_at: st1 }), 422, "needs_consent");
  eq("...and nothing changed", await row(id), { status: "draft", consent_state: "none" });
  is("publish needs an explicit confirmation", await publish(pub, id, { expected_updated_at: st1 }), 400, "confirmation_required");
  is("consent: a bad record is refused", await consentAdd(mgr, id, { kind: "granted" }), 400, "invalid_consent_given_by");
  is("withdrawing consent that was never given is refused", await consentAdd(mgr, id, CONSENT({ kind: "withdrawn" })), 409, "consent_unchanged");
  const g = await consentAdd(mgr, id, CONSENT({ given_by: "guardian", method: "verbal_witnessed" }));
  is("a manager records a granted consent", g, 201, "ok");
  eq("...it answers with the derived state", [g.body.consent_state, g.body.status], ["granted", "draft"]);
  is("recording the same decision twice is refused", await consentAdd(mgr, id, CONSENT()), 409, "consent_unchanged");
  const hist = await consentList(viewer, id);
  eq("the history lists the decision without any person or free text", [hist.body.items.length, Object.keys(hist.body.items[0]).sort()], [1, ["created_at", "given_by", "id", "kind", "method"]]);
  is("a stale version cannot publish", await publish(pub, id, { confirm: true, expected_updated_at: st1 }), 409, "stale");
  const pubd = await publish(pub, id, { confirm: true, expected_updated_at: await stamp(id) });
  is("with consent the publisher can publish", pubd, 200, "ok");
  eq("...it is live", await row(id), { status: "published", consent_state: "granted" });
  eq("anon (the public page's reader) now sees exactly the content columns", ((await F.sessionFor(H.db, null).from("ministry_care_cases").select("id,title_en,summary_en,category")).data || []).map((x) => x.id), [id]);
  is("publishing twice is a 409", await publish(pub, id, { confirm: true, expected_updated_at: await stamp(id) }), 409, "already_published");

  const w = await consentAdd(mgr, id, CONSENT({ kind: "withdrawn" }));
  is("a MANAGER can withdraw consent from a LIVE case", w, 201, "ok");
  eq("...which takes the case off the public page at once", [w.body.consent_state, w.body.status, await row(id)], ["withdrawn", "draft", { status: "draft", consent_state: "withdrawn" }]);
  eq("anon sees nothing again", ((await F.sessionFor(H.db, null).from("ministry_care_cases").select("id")).data || []).length, 0);
  is("it cannot be published again while consent is withdrawn", await publish(pub, id, { confirm: true, expected_updated_at: await stamp(id) }), 422, "needs_consent");
  is("a new granted record is accepted after a withdrawal", await consentAdd(mgr, id, CONSENT()), 201, "ok");
  is("...and then it can be published again", await publish(pub, id, { confirm: true, expected_updated_at: await stamp(id) }), 200, "ok");
  eq("the history keeps every decision, newest first", (await consentList(O, id)).body.items.map((x) => x.kind), ["granted", "withdrawn", "granted"]);
  is("unpublish needs the publish permission: manager 403", await unpublish(mgr, id, { confirm: true, expected_updated_at: await stamp(id) }), 403);
  is("the publisher can unpublish", await unpublish(pub, id, { confirm: true, expected_updated_at: await stamp(id) }), 200, "ok");
  eq("unpublishing does NOT erase the consent", (await row(id)).consent_state, "granted");
  is("a manager can delete the (now draft) case", await del(mgr, id, await stamp(id)), 200, "ok");
  eq("deleting the case removed its consent record too", (await H.rows(`select count(*)::int as n from public.ministry_care_consents`))[0].n, 0);
  is("deleting needs the reviewed version", await del(O, (await create(O, CASE())).body.id), 400, "invalid_body");
  // a case with no readable text cannot be published
  const empty = (await create(O, { category: "other" })).body.id;
  await consentAdd(mgr, empty, CONSENT());
  is("a case with no title and summary: needs_title_and_summary", await publish(pub, empty, { confirm: true, expected_updated_at: await stamp(empty) }), 422, "needs_title_and_summary");
}

section("D. the private beneficiary link: ");
{
  await H.fresh(EXTRA);
  const id = (await create(O, CASE())).body.id;
  is("no link yet", await benGet(viewer, id), 200, "ok");
  eq("...null", (await benGet(viewer, id)).body.beneficiary, null);
  is("a manager links an adult of the roster", await benPut(mgr, id, { member_id: m.other }), 200, "ok");
  const got = await benGet(viewer, id);
  eq("the viewer (who also has People view) sees who it is", got.body.beneficiary, { member_id: m.other, name: "Olivier Other" });
  eq("a care manager WITHOUT People view gets the id but not the name", (await benGet(mgr, id)).body.beneficiary, { member_id: m.other, name: null });
  is("a child cannot be linked", await benPut(mgr, id, { member_id: m.kid1 }), 422, "care_child_not_allowed");
  is("a person of another church cannot be linked", await benPut(mgr, id, { member_id: m.c2a }), 404, "member_not_found");
  is("a bad id is 400", await benPut(mgr, id, { member_id: "x" }), 400, "invalid_member_id");
  is("replacing the person works", await benPut(mgr, id, { member_id: m.admin }), 200, "ok");
  eq("...still one link", (await H.rows(`select count(*)::int as n from public.ministry_care_beneficiaries where case_id = '${id}'`))[0].n, 1);
  is("a stranger is 403", await benGet(u.stranger, id), 403);
  is("another church's owner gets 404", await benGet(u.owner2, id), 404);
  // nothing about the person is in any case answer
  const detail = JSON.stringify([(await get(O, id)).body, (await list(O)).body, (await consentList(O, id)).body]);
  check("the case, list and consent answers never contain the person's id or name", [m.admin, m.other, "Grace", "Olivier"].every((s) => !detail.includes(s)));
  is("clearing the link works", await benDel(mgr, id), 200, "ok");
  is("clearing it again is 404", await benDel(mgr, id), 404);
  is("a viewer cannot clear: 403", await benDel(viewer, id), 403);
}

section("E. lists and isolation: ");
{
  await H.fresh(EXTRA);
  const a = (await create(O, CASE({ title_en: "One" }))).body.id;
  const b = (await create(O, CASE({ title_en: "Two" }))).body.id;
  await consentAdd(O, b, CONSENT());
  await publish(O, b, { confirm: true, expected_updated_at: await stamp(b) });
  await create(u.owner2, CASE({ title_en: "Other church" }));
  eq("the owner lists only this church's cases", (await list(O)).body.items.map((x) => x.title_en).sort(), ["One", "Two"]);
  eq("the drafts view", (await list(O, "view=drafts")).body.items.map((x) => x.id), [a]);
  eq("the published view", (await list(O, "view=published")).body.items.map((x) => x.id), [b]);
  is("an unknown view is 400", await list(O, "view=secret"), 400, "invalid_view");
  is("an unknown parameter is 400", await list(O, "profile_id=" + prof.c2), 400, "unexpected_field");
  const keys = Object.keys((await list(O)).body.items[0]).sort();
  eq("a list row carries no person, no contact, no audit column and no money field", keys.filter((k) => /member|name|phone|email|created_by|updated_by|published_by|recorded|amount|target|currency|payment/.test(k)), []);
}

section("F. text and scope: ");
{
  const en = TR.en.churchCare, fr = TR.fr.churchCare;
  const shape = (a, b, p = "") => { const out = []; for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const x = a[k], y = b[k], here = `${p}.${k}`; if (typeof x !== typeof y) out.push(here); else if (x && typeof x === "object") out.push(...shape(x, y, here)); else if (typeof x === "string" && (!x.trim() || !y.trim())) out.push(here + " empty"); } return out; };
  eq("English and French have exactly the same keys", shape(en, fr), []);
  const codes = new Set(["needs_consent", "needs_title_and_summary", "invalid_category", "invalid_title", "invalid_summary", "consent_unchanged", "invalid_consent_kind", "invalid_consent_given_by", "invalid_consent_method", "invalid_member_id", "member_not_found", "care_child_not_allowed"]);
  const src = fs.readFileSync(path.join(REPO, "src/lib/church/care/handlers.ts"), "utf8");
  for (const mm of src.matchAll(/(?:fail\(\d{3}, |code: )"([a-z_]+)"/g)) codes.add(mm[1]);
  for (const c of codes) for (const lang of ["en", "fr"]) check(`code ${c} has its own sentence (${lang})`, ET.churchErrorText(TR[lang], c) !== TR[lang].churchPeople.errors.generic, c);
  check("every category and consent option has a label in both languages", CH.CARE_CATEGORIES.every((c) => en.categories[c] && fr.categories[c]) && CH.CONSENT_KINDS.every((k) => en.consent.kinds[k] && fr.consent.kinds[k]) && CH.CONSENT_GIVEN_BY.every((k) => en.consent.givenBy[k] && fr.consent.givenBy[k]) && CH.CONSENT_METHODS.every((k) => en.consent.methods[k] && fr.consent.methods[k]));
  const code = src.replace(/\/\/[^\n]*/g, "");
  check("the care code has no payment, money, ledger or provider code", !/fapshi|stripe|payment|contribution|ledger|refund|payout|currency|amount|createAdminClient/i.test(code), (code.match(/fapshi|stripe|payment|contribution|ledger|refund|payout|currency|amount|createAdminClient/i) || [""])[0]);
  const aiTool = fs.readFileSync(path.join(REPO, "src/lib/ai/tools/definitions/churchReport.ts"), "utf8");
  const aiCode = aiTool.replace(/\/\/[^\n]*/g, "");
  check("Ringo AI's church tool never touches a care table", !/ministry_care|care_cases|care_consents|care_beneficiaries|beneficiar|\.viewCare|manageCare|publishCare/i.test(aiCode));
  eq("the service-role client was never used", globalThis.__adminClientCalls, 0);
}

section("G. the PUBLIC loader against the real database rules: ");
{
  const PC = jiti(path.join(SRC, "lib/church/public/care.ts"));
  const IDX = jiti(path.join(SRC, "lib/church/public/index.ts"));
  await H.fresh(EXTRA);
  const anon = () => F.sessionFor(H.db, null);
  const draft = (await create(O, CASE({ title_en: "Draft case" }))).body.id;
  const live = (await create(O, CASE({ title_en: "Live case" }))).body.id;
  const noConsent = (await create(O, CASE({ title_en: "No consent case" }))).body.id;
  await consentAdd(mgr, live, CONSENT());
  await publish(O, live, { confirm: true, expected_updated_at: await stamp(live) });
  eq("a visitor's loader returns ONLY the published, consented case", (await PC.loadPublicCare(anon(), prof.c1)).map((x) => x.id), [live]);
  eq("...with exactly the public fields", Object.keys((await PC.loadPublicCare(anon(), prof.c1))[0]).sort(), ["category", "id", "summary_en", "summary_fr", "title_en", "title_fr"]);
  eq("a signed-in stranger sees the same", (await PC.loadPublicCare(F.sessionFor(H.db, u.stranger), prof.c1)).map((x) => x.id), [live]);
  eq("staff of the church viewing the public page also get only the published case (their drafts are not public)", (await PC.loadPublicCare(F.sessionFor(H.db, mgr), prof.c1)).map((x) => x.id), [live]);
  eq("another church's page has none", (await PC.loadPublicCare(anon(), prof.c2)).length, 0);
  const bundle = await IDX.loadChurchPublic(anon(), prof.c1);
  eq("the church bundle carries the case", bundle.care.map((x) => x.id), [live]);
  // consent withdrawn: gone from the public loader immediately
  await consentAdd(mgr, live, CONSENT({ kind: "withdrawn" }));
  eq("after a withdrawal the loader returns nothing", (await PC.loadPublicCare(anon(), prof.c1)).length, 0);
  eq("...and the bundle too", (await IDX.loadChurchPublic(anon(), prof.c1)).care.length, 0);
  // the page being unpublished hides everything, even a consented case
  await consentAdd(mgr, live, CONSENT());
  await publish(O, live, { confirm: true, expected_updated_at: await stamp(live) });
  eq("granted again and republished, it is back", (await PC.loadPublicCare(anon(), prof.c1)).length, 1);
  await F.svc(H.db, `update public.profiles set published = false where id = '${prof.c1}'`);
  eq("if the church page itself is unpublished, no case is public", (await PC.loadPublicCare(anon(), prof.c1)).length, 0);
  void draft; void noConsent;
}

H.close();
process.exit(summary());
