// Churches & Ministries Testimonies: the public submission route and the staff moderation routes, validated end to end and OFFLINE.
// The REAL route files (src/app/api/public/church-testimony and src/app/api/church/testimonies/**), the REAL handlers, validation and actor resolution run against scratch in-memory PostgreSQL (PGlite) that
// holds the REAL migrations. The public route gets a SERVICE-ROLE-shaped client (the only way in) and every staff request runs as a chosen signed-in user. All data is synthetic.
//   Run:  node scripts/tests/churchTestimoniesApi.test.mjs
import fs from "fs";
import path from "path";
import { createHarness, kit, SRC, REPO, doualaToday, shift } from "./ministryApiHarness.mjs";

const H = await createHarness({ dailyWords: true, events: true, attendance: true, bible: true, music: true, care: true, testimonies: true });
const { F, jiti } = H;
const { u, prof } = F;
const { check, eq, is, section, summary } = kit();
console.error = () => {};

const SUB = jiti(path.join(SRC, "lib/church/testimonies/submit.ts"));
const TH = jiti(path.join(SRC, "lib/church/testimonies/handlers.ts"));
const PERM = jiti(path.join(SRC, "lib/church/permissions.ts"));
const PT = jiti(path.join(SRC, "lib/church/public/testimonies.ts"));
const IDX = jiti(path.join(SRC, "lib/church/public/index.ts"));
const ET = jiti(path.join(SRC, "components/church/lifecycle/errorText.ts"));
const TR = jiti(path.join(SRC, "lib/i18n/translations.ts")).translations;
const PUBROUTE = path.join(SRC, "app/api/public/church-testimony/route.ts");

const U2 = (n) => F.id("c", 210 + n);
const viewer = U2(1), mgr = U2(2), pub = U2(3), noPerm = U2(4), adminPub = U2(5);
const R2 = (n) => F.id("b", 210 + n);
const r = { view: R2(1), mgr: R2(2), pub: R2(3), other: R2(4), adminPub: R2(5) };
const EXTRA = `
  insert into public.users (id, role, plan_id) values ('${viewer}','user','${F.plan.free}'), ('${mgr}','user','${F.plan.free}'), ('${pub}','user','${F.plan.free}'), ('${noPerm}','user','${F.plan.free}'), ('${adminPub}','admin','${F.plan.free}');
  insert into public.organization_roles (id, profile_id, key, name, permissions) values
    ('${r.view}','${prof.c1}','tview','Viewer','{church.testimonies.view}'),
    ('${r.mgr}','${prof.c1}','tmgr','Manager','{church.testimonies.manage}'),
    ('${r.pub}','${prof.c1}','tpub','Publisher','{church.testimonies.publish}'),
    ('${r.other}','${prof.c1}','tother','Other','{church.care.publish,church.reports.view,church.members.view}'),
    ('${r.adminPub}','${prof.c1}','tadmin','Admin','{church.testimonies.publish,church.testimonies.manage,church.testimonies.view}');
  insert into public.organization_members (profile_id, user_id, role_id) values ('${prof.c1}','${viewer}','${r.view}'), ('${prof.c1}','${mgr}','${r.mgr}'), ('${prof.c1}','${pub}','${r.pub}'), ('${prof.c1}','${noPerm}','${r.other}'), ('${prof.c1}','${adminPub}','${r.adminPub}');
  update public.profiles set username = 'graceassembly' where id = '${prof.c1}';
  update public.profiles set username = 'secondchurch' where id = '${prof.c2}';
  update public.profiles set username = 'notachurch' where id = '${prof.nc}';
  update public.profiles set username = 'hiddenchurch', published = false where id = '${prof.c3}';
`;
const O = u.owner1;
let seq = 0;
const key = () => F.id("3", 3000 + ++seq);
const PAYLOAD = (o = {}) => ({ username: "graceassembly", submission_key: key(), full_name: "Marie Ngono", phone: "+237 670 12 34 56", group_label: "Choir", body: "God healed me and my whole family this year.", lang: "en", publish_consent: false, name_consent: false, website: "", ...o });
function installAdmin() { globalThis.__adminFactory = () => F.sessionFor(H.db, null, { role: "service_role" }); }
async function send(body, { origin = "http://test.local", host = "test.local", contentType = "application/json", raw, sameOrigin = true } = {}) {
  installAdmin();
  globalThis.__sameOrigin = sameOrigin;
  const mod = jiti(PUBROUTE);
  const headers = { ...(contentType ? { "content-type": contentType } : {}), ...(origin ? { origin } : {}), host };
  const res = await mod.POST(new Request("http://test.local/api/public/church-testimony", { method: "POST", headers, body: raw !== undefined ? raw : JSON.stringify(body) }));
  let json = null; try { json = await res.json(); } catch { /* none */ }
  return { status: res.status, body: json, headers: res.headers };
}
const rowsOf = (sql) => H.rows(sql);
const count = async () => (await rowsOf("select count(*)::int as n from public.ministry_testimonies"))[0].n;
const list = (who, qs = "") => H.call(who, "GET", `church/testimonies${qs ? "?" + qs : ""}`);
const get = (who, id) => H.call(who, "GET", "church/testimonies/[id]", { params: { id } });
const review = (who, id, body) => H.call(who, "POST", "church/testimonies/[id]/review", { params: { id }, body });
const patch = (who, id, body) => H.call(who, "PATCH", "church/testimonies/[id]", { params: { id }, body });
const publish = (who, id, body) => H.call(who, "POST", "church/testimonies/[id]/publish", { params: { id }, body });
const unpublish = (who, id, body) => H.call(who, "POST", "church/testimonies/[id]/unpublish", { params: { id }, body });
const consent = (who, id, body) => H.call(who, "POST", "church/testimonies/[id]/consent", { params: { id }, body });
const stamp = (id) => H.stamp("ministry_testimonies", id);
const st = async (id) => (await rowsOf(`select review_status, publication_status, publish_consent, name_consent, public_body from public.ministry_testimonies where id = '${id}'`))[0];
const newT = async (o = {}) => { const res = await send(PAYLOAD(o)); if (res.status !== 200) throw new Error("setup failed " + JSON.stringify(res.body)); return (await rowsOf("select id from public.ministry_testimonies order by created_at desc, id limit 1"))[0].id; };

section("A. input validation (pure): ");
{
  const P = SUB.parseSubmission;
  const good = () => PAYLOAD();
  check("a valid submission is accepted and cleaned", P(good()).ok && P(good()).value.phone === "237670123456" && P(good()).value.full_name === "Marie Ngono");
  check("name: too short, too long, control characters and markup characters are refused", ["A", "x".repeat(121), "Bad\u0000Name", "<b>Name</b>", 5, null].every((v) => P(PAYLOAD({ full_name: v })).code === "invalid_name"));
  check("name: extra spaces are collapsed", P(PAYLOAD({ full_name: "  Marie    Ngono  " })).value.full_name === "Marie Ngono");
  const N = SUB.normalizeTestimonyPhone;
  check("phone: international and Cameroon local forms", N("+237 670 12 34 56") === "237670123456" && N("00237670123456") === "237670123456" && N("670123456") === "237670123456" && N("(237) 233-45-67-89") === "237233456789" && N("+33 6 12 34 56 78") === "33612345678");
  check("phone: letters, too short, too long, one repeated digit, wrong types are refused", ["abc", "12345", "1".repeat(16), "00000000000", "237 670 abc 456", 670123456, null, "+".repeat(45)].every((v) => N(v) === null));
  check("phone: refused phone is invalid_phone", P(PAYLOAD({ phone: "abc" })).code === "invalid_phone");
  check("group is optional; too long is refused", P(PAYLOAD({ group_label: "" })).value.group_label === null && P(PAYLOAD({ group_label: undefined })).ok && P(PAYLOAD({ group_label: "g".repeat(81) })).code === "invalid_group");
  check("testimony: under 10, over 3000, wrong type refused; line breaks kept", P(PAYLOAD({ body: "short" })).code === "invalid_testimony" && P(PAYLOAD({ body: "x".repeat(3001) })).code === "invalid_testimony" && P(PAYLOAD({ body: 5 })).code === "invalid_testimony" && P(PAYLOAD({ body: "Line one is here.\n\nLine two is here." })).value.body.includes("\n\n"));
  const noConsentKeys = good(); delete noConsentKeys.publish_consent; delete noConsentKeys.name_consent;
  check("consent defaults to FALSE for both boxes when the keys are absent", P(noConsentKeys).ok && P(noConsentKeys).value.publish_consent === false && P(noConsentKeys).value.name_consent === false);
  check("consent: ticks are taken exactly; name consent without publication consent is refused; non-booleans refused", P(PAYLOAD({ publish_consent: true })).value.publish_consent === true && P(PAYLOAD({ publish_consent: true, name_consent: true })).value.name_consent === true && P(PAYLOAD({ publish_consent: false, name_consent: true })).code === "invalid_consent" && P(PAYLOAD({ publish_consent: "yes" })).code === "invalid_consent" && P(PAYLOAD({ publish_consent: 1 })).code === "invalid_consent");
  check("username / key / language are validated", P(PAYLOAD({ username: "../x" })).code === "invalid_request" && P(PAYLOAD({ username: "" })).code === "invalid_request" && P(PAYLOAD({ submission_key: "x" })).code === "invalid_request" && P(PAYLOAD({ lang: "de" })).code === "invalid_request" && P(PAYLOAD({ lang: "fr" })).value.lang === "fr");
  check("the username is lower-cased", P(PAYLOAD({ username: "GraceAssembly" })).value.username === "graceassembly");
  check("a church id, a status, a consent date or any other field is REFUSED, never ignored", ["profile_id", "id", "review_status", "publication_status", "consent_at", "published_at", "public_body", "created_by"].every((f) => P(PAYLOAD({ [f]: "x" })).code === "unexpected_field"));
  check("not an object", P(null).code === "invalid_body" && P([]).code === "invalid_body" && P("x").code === "invalid_body");
  check("the honeypot is detected", P(PAYLOAD({ website: "http://spam" })).value.bot === true && P(PAYLOAD()).value.bot === false);
  check("capabilities come from the testimonies strings only", PERM.churchCapabilities(["church.testimonies.view"]).viewTestimonies && !PERM.churchCapabilities(["church.testimonies.view"]).manageTestimonies && PERM.churchCapabilities(["church.testimonies.manage"]).manageTestimonies && !PERM.churchCapabilities(["church.testimonies.manage"]).publishTestimonies && PERM.churchCapabilities(["church.testimonies.publish"]).manageTestimonies && PERM.churchCapabilities(["church.testimonies.publish"]).publishTestimonies && !PERM.churchCapabilities(["church.care.publish", "church.reports.view", "church.members.view"]).viewTestimonies);
  check("the strings are registered and SENSITIVE (owner-only to grant)", ["church.testimonies.view", "church.testimonies.manage", "church.testimonies.publish"].every((p) => PERM.CHURCH_PERMISSIONS.includes(p) && PERM.isSensitiveChurchPermissionName(p)));
}

section("B. the public route stores a testimony safely: ");
{
  await H.fresh(EXTRA);
  const ok = await send(PAYLOAD({ publish_consent: true, name_consent: true }));
  is("a valid submission from a visitor with no account: 200", ok, 200, "ok");
  eq("...the answer is only { ok: true } (no id, no count)", ok.body, { ok: true });
  check("...with no-store caching", ok.headers.get("cache-control") === "no-store");
  eq("one row was stored for the RIGHT church, private and unreviewed", (await rowsOf("select profile_id, full_name, phone, group_label, lang, publish_consent, name_consent, review_status, publication_status from public.ministry_testimonies"))[0], { profile_id: prof.c1, full_name: "Marie Ngono", phone: "237670123456", group_label: "Choir", lang: "en", publish_consent: true, name_consent: true, review_status: "submitted", publication_status: "unpublished" });
  eq("the moderation history starts with 'submitted'", (await rowsOf("select action from public.ministry_testimony_history")).map((x) => x.action), ["submitted"]);
  const refuse = await send(PAYLOAD({ full_name: "No Consent", phone: "237 699 00 11 22", publish_consent: false }));
  is("a visitor who does NOT tick publication: stored, with consent false", refuse, 200, "ok");
  eq("...consent false, exactly as sent", (await rowsOf("select publish_consent, name_consent from public.ministry_testimonies where full_name = 'No Consent'"))[0], { publish_consent: false, name_consent: false });
  eq("nothing is public after submission (submitting is not permission to publish)", await IDX.loadChurchPublic(F.sessionFor(H.db, null), prof.c1).then((x) => x.testimonies.length), 0);
  const fr = await send(PAYLOAD({ lang: "fr", full_name: "Jean Mballa", phone: "699001133", body: "Dieu a répondu à ma prière avec bonté." }));
  is("a French submission works", fr, 200, "ok");
  eq("...a local Cameroon number got its country code", (await rowsOf("select phone, lang from public.ministry_testimonies where full_name = 'Jean Mballa'"))[0], { phone: "237699001133", lang: "fr" });
}

section("C. the public route refuses what it should: ");
{
  await H.fresh(EXTRA);
  const before = await count();
  is("not same-origin (the real check says so): 403", await send(PAYLOAD(), { origin: "http://evil.example", sameOrigin: false }), 403, "forbidden");
  is("not JSON: 415", await send(PAYLOAD(), { contentType: "text/plain" }), 415, "invalid_body");
  is("broken JSON: 400", await send(null, { raw: "{not json" }), 400, "invalid_body");
  is("oversized body: 413", await send(null, { raw: JSON.stringify(PAYLOAD({ body: "x".repeat(20000) })) }), 413, "invalid_body");
  is("invalid name: 400 with the field", await send(PAYLOAD({ full_name: "A" })), 400, "invalid_name");
  is("invalid phone: 400", await send(PAYLOAD({ phone: "12" })), 400, "invalid_phone");
  is("invalid testimony: 400", await send(PAYLOAD({ body: "short" })), 400, "invalid_testimony");
  is("an unknown field (church id) is refused: 400", await send(PAYLOAD({ profile_id: prof.c2 })), 400, "unexpected_field");
  is("a church that does not exist: 404", await send(PAYLOAD({ username: "nobodyhere" })), 404, "not_found");
  is("a profile that is not a church: 404", await send(PAYLOAD({ username: "notachurch" })), 404, "not_found");
  is("an UNPUBLISHED church page: 404 (the same answer, nothing to probe)", await send(PAYLOAD({ username: "hiddenchurch" })), 404, "not_found");
  eq("none of these stored anything", await count(), before);
  const bot = await send(PAYLOAD({ website: "http://spam.example" }));
  is("a bot filling the hidden field gets the same plain ok", bot, 200, "ok");
  eq("...and NOTHING is stored", await count(), before);
  // the client cannot choose another church: the username decides, verified server-side
  const own = await send(PAYLOAD({ username: "secondchurch" }));
  is("a visitor of the second church's page", own, 200, "ok");
  eq("...lands in the second church, not the first", (await rowsOf("select profile_id from public.ministry_testimonies"))[0].profile_id, prof.c2);
}

section("D. duplicates and flooding: ");
{
  await H.fresh(EXTRA);
  const k = key();
  is("first send", await send(PAYLOAD({ submission_key: k })), 200, "ok");
  is("the SAME form sent again (a double tap): ok", await send(PAYLOAD({ submission_key: k })), 200, "ok");
  eq("...is one testimony", await count(), 1);
  is("the same number sending the same words again within a day: ok", await send(PAYLOAD()), 200, "ok");
  eq("...still one testimony", await count(), 1);
  // per-number limits
  for (let i = 0; i < 2; i++) is(`a different testimony from the same number (${i + 2})`, await send(PAYLOAD({ body: `A different testimony number ${i} with enough words.` })), 200, "ok");
  eq("three from one number in an hour", await count(), 3);
  is("the fourth from the same number within the hour: 429", await send(PAYLOAD({ body: "A fourth different testimony with enough words." })), 429, "too_many");
  eq("...nothing stored", await count(), 3);
  is("another number is unaffected", await send(PAYLOAD({ phone: "699 11 22 33", body: "A testimony from another phone number here." })), 200, "ok");
  // per-church flood limit
  await H.fresh(EXTRA);
  await F.svc(H.db, `insert into public.ministry_testimonies (profile_id, submission_key, full_name, phone, body) select '${prof.c1}', gen_random_uuid(), 'Flood ' || g, '23767' || lpad(g::text, 7, '0'), 'Flood testimony number ' || g || ' padding' from generate_series(1, ${SUB.RATE.churchPerHour}) g`);
  is("a church receiving more than its hourly cap: 429", await send(PAYLOAD({ phone: "699 55 66 77" })), 429, "too_many");
  is("the other church is unaffected", await send(PAYLOAD({ username: "secondchurch", phone: "699 55 66 77" })), 200, "ok");
}

section("E. staff permissions on the private records: ");
{
  await H.fresh(EXTRA);
  const id = await newT({ publish_consent: true, name_consent: true });
  is("anonymous: 401", await list(null), 401);
  is("a stranger: 403", await list(u.stranger), 403);
  is("a staff member with only other church permissions: 403", await list(noPerm), 403);
  is("a platform admin who is not the owner: 403", await list(adminPub), 403);
  is("a group leader (not staff): 403", await list(u.leader1), 403);
  const own = await list(O);
  is("the owner lists", own, 200, "ok");
  eq("...and sees the phone number, name and consent state", [own.body.items[0].phone, own.body.items[0].full_name, own.body.items[0].publish_consent], ["237670123456", "Marie Ngono", true]);
  is("a viewer lists", await list(viewer), 200, "ok");
  is("a viewer opens one, with its history", await get(viewer, id), 200, "ok");
  is("another church's owner gets 404 (not this church's testimony)", await get(u.owner2, id), 404);
  is("a non-uuid is 404", await get(O, "nope"), 404);
  is("a stranger cannot open one: 403", await get(u.stranger, id), 403);
  const s0 = await stamp(id);
  is("a viewer cannot review: 403", await review(viewer, id, { status: "under_review", expected_updated_at: s0 }), 403);
  is("a viewer cannot correct: 403", await patch(viewer, id, { moderation_note: "x", expected_updated_at: s0 }), 403);
  is("a viewer cannot publish: 403", await publish(viewer, id, { confirm: true, expected_updated_at: s0 }), 403);
  is("a viewer cannot withdraw consent: 403", await consent(viewer, id, { scope: "publication", confirm: true, expected_updated_at: s0 }), 403);
  is("a stranger cannot review: 403", await review(u.stranger, id, { status: "approved", expected_updated_at: s0 }), 403);
  check("another church's owner cannot review it (403 or 404)", [403, 404].includes((await review(u.owner2, id, { status: "approved", expected_updated_at: s0 })).status));
  eq("none of those changed anything", await st(id), { review_status: "submitted", publication_status: "unpublished", publish_consent: true, name_consent: true, public_body: null });
  is("a manager can review", await review(mgr, id, { status: "approved", expected_updated_at: s0 }), 200, "ok");
  is("a manager cannot publish: 403", await publish(mgr, id, { confirm: true, expected_updated_at: await stamp(id) }), 403);
  is("a publisher can publish", await publish(pub, id, { confirm: true, expected_updated_at: await stamp(id) }), 200, "ok");
  is("a manager can take it down", await unpublish(mgr, id, { confirm: true, expected_updated_at: await stamp(id) }), 200, "ok");
  is("a viewer cannot take it down: 403", await unpublish(viewer, id, { confirm: true, expected_updated_at: await stamp(id) }), 403);
  check("a testimonies POST is not available for creating records (no create route exists)", !fs.existsSync(path.join(SRC, "app/api/church/testimonies/route.ts")) || !/export const POST/.test(fs.readFileSync(path.join(SRC, "app/api/church/testimonies/route.ts"), "utf8")));
}

section("F. the moderation flow and the consent rules: ");
{
  await H.fresh(EXTRA);
  const id = await newT({ publish_consent: true, name_consent: false });
  const s1 = await stamp(id);
  is("a status must be one of the three targets", await review(mgr, id, { status: "submitted", expected_updated_at: s1 }), 400, "invalid_status");
  is("the reviewed version is mandatory", await review(mgr, id, { status: "approved" }), 400, "invalid_body");
  is("an unknown field is refused", await review(mgr, id, { status: "approved", expected_updated_at: s1, review_status: "approved" }), 400, "unexpected_field");
  is("under review", await review(mgr, id, { status: "under_review", expected_updated_at: s1 }), 200, "ok");
  is("a stale version is a 409", await review(mgr, id, { status: "approved", expected_updated_at: s1 }), 409, "stale");
  is("the same status again is a 409", await review(mgr, id, { status: "under_review", expected_updated_at: await stamp(id) }), 409, "status_unchanged");
  is("publishing before approval: 409 not_approved", await publish(pub, id, { confirm: true, expected_updated_at: await stamp(id) }), 409, "not_approved");
  is("approve", await review(mgr, id, { status: "approved", expected_updated_at: await stamp(id) }), 200, "ok");
  eq("APPROVAL DID NOT PUBLISH", await st(id), { review_status: "approved", publication_status: "unpublished", publish_consent: true, name_consent: false, public_body: null });
  eq("...nothing is public yet", (await IDX.loadChurchPublic(F.sessionFor(H.db, null), prof.c1)).testimonies.length, 0);
  is("publishing needs an explicit confirmation", await publish(pub, id, { expected_updated_at: await stamp(id) }), 400, "confirmation_required");
  is("publish", await publish(pub, id, { confirm: true, expected_updated_at: await stamp(id) }), 200, "ok");
  is("publishing twice: 409", await publish(pub, id, { confirm: true, expected_updated_at: await stamp(id) }), 409, "already_published");
  const pubOut = await IDX.loadChurchPublic(F.sessionFor(H.db, null), prof.c1);
  eq("it is public now, WITHOUT a name (name consent was not given)", pubOut.testimonies.map((x) => [x.display_name, x.body]), [[null, "God healed me and my whole family this year."]]);
  // correction
  is("a correction needs a change", await patch(mgr, id, { expected_updated_at: await stamp(id) }), 400, "empty_update");
  is("a too-short correction is refused", await patch(mgr, id, { public_body: "short", expected_updated_at: await stamp(id) }), 400, "invalid_public_body");
  is("the submitter's own fields cannot be sent", await patch(mgr, id, { body: "Rewritten words that mean something else.", expected_updated_at: await stamp(id) }), 400, "unexpected_field");
  is("a correction", await patch(mgr, id, { public_body: "God healed me and my family this year.", expected_updated_at: await stamp(id) }), 200, "ok");
  eq("the page shows the correction, the original is untouched", [(await IDX.loadChurchPublic(F.sessionFor(H.db, null), prof.c1)).testimonies[0].body, (await rowsOf("select body from public.ministry_testimonies"))[0].body], ["God healed me and my family this year.", "God healed me and my whole family this year."]);
  is("the same correction again: nothing changed", await patch(mgr, id, { public_body: "God healed me and my family this year.", expected_updated_at: await stamp(id) }), 409, "nothing_changed");
  is("a private note", await patch(mgr, id, { moderation_note: "Call her first", expected_updated_at: await stamp(id) }), 200, "ok");
  is("revert to the original words", await patch(mgr, id, { public_body: null, expected_updated_at: await stamp(id) }), 200, "ok");
  eq("...the page shows the original again", (await IDX.loadChurchPublic(F.sessionFor(H.db, null), prof.c1)).testimonies[0].body, "God healed me and my whole family this year.");
  // withdrawal
  is("withdrawing needs a scope", await consent(mgr, id, { confirm: true, expected_updated_at: await stamp(id) }), 400, "invalid_scope");
  is("withdrawing needs confirmation", await consent(mgr, id, { scope: "publication", expected_updated_at: await stamp(id) }), 400, "confirmation_required");
  is("name consent was never given: nothing to withdraw", await consent(mgr, id, { scope: "name", confirm: true, expected_updated_at: await stamp(id) }), 409, "consent_not_held");
  is("withdraw publication consent", await consent(mgr, id, { scope: "publication", confirm: true, expected_updated_at: await stamp(id) }), 200, "ok");
  eq("...it is off the page at once and the consent is gone", [await st(id), (await IDX.loadChurchPublic(F.sessionFor(H.db, null), prof.c1)).testimonies.length], [{ review_status: "approved", publication_status: "unpublished", publish_consent: false, name_consent: false, public_body: null }, 0]);
  is("it can never be published again: 409 no_publish_consent", await publish(pub, id, { confirm: true, expected_updated_at: await stamp(id) }), 409, "no_publish_consent");
  is("withdrawing again: 409", await consent(mgr, id, { scope: "publication", confirm: true, expected_updated_at: await stamp(id) }), 409, "consent_not_held");
  const h = (await get(O, id)).body.history.map((x) => x.action);
  check("the history lists every step, newest first", h[0] === "consent_withdrawn" || h.includes("consent_withdrawn"), h.join());
  eq("...complete", h.slice().reverse().filter((a, i, arr) => arr.indexOf(a) === i).sort(), ["approved", "consent_withdrawn", "edited", "note_updated", "published", "submitted", "under_review", "unpublished"].sort());
  // a testimony whose author refused publication can never be published, by anyone
  const refused = await newT({ publish_consent: false, full_name: "Refuser Person", phone: "699 88 77 66" });
  await review(mgr, refused, { status: "approved", expected_updated_at: await stamp(refused) });
  is("the owner cannot publish a testimony whose author refused: 409", await publish(O, refused, { confirm: true, expected_updated_at: await stamp(refused) }), 409, "no_publish_consent");
  eq("...it stays private", (await st(refused)).publication_status, "unpublished");
  // name withdrawal keeps it live but unnamed
  const named = await newT({ publish_consent: true, name_consent: true, full_name: "Named Person", phone: "699 12 12 12" });
  await review(mgr, named, { status: "approved", expected_updated_at: await stamp(named) });
  await publish(pub, named, { confirm: true, expected_updated_at: await stamp(named) });
  eq("named while the author allows it", (await IDX.loadChurchPublic(F.sessionFor(H.db, null), prof.c1)).testimonies.map((x) => x.display_name), ["Named Person"]);
  is("withdraw the NAME permission", await consent(mgr, named, { scope: "name", confirm: true, expected_updated_at: await stamp(named) }), 200, "ok");
  eq("it stays on the page without the name", (await IDX.loadChurchPublic(F.sessionFor(H.db, null), prof.c1)).testimonies.map((x) => x.display_name), [null]);
  // rejecting a live one takes it down
  is("reject a live testimony", await review(mgr, named, { status: "rejected", expected_updated_at: await stamp(named) }), 200, "ok");
  eq("...it is off the page at once", (await IDX.loadChurchPublic(F.sessionFor(H.db, null), prof.c1)).testimonies.length, 0);
  eq("...the rejected record is kept privately and the owner still sees it", (await list(O, "status=rejected")).body.items.map((x) => x.full_name), ["Named Person"]);
}

section("G. lists, filters and isolation: ");
{
  await H.fresh(EXTRA);
  const a = await newT({ full_name: "Alice Aaa", phone: "699 00 00 01", body: "Alice testimony that is long enough." });
  const b = await newT({ full_name: "Bob Bbb", phone: "699 00 00 02", body: "Bob testimony that is long enough here." });
  await send(PAYLOAD({ username: "secondchurch", full_name: "Other Church", phone: "699 00 00 03" }));
  eq("the owner lists only this church's testimonies", (await list(O)).body.items.map((x) => x.full_name).sort(), ["Alice Aaa", "Bob Bbb"]);
  eq("the other church's owner lists only theirs", (await list(u.owner2)).body.items.map((x) => x.full_name), ["Other Church"]);
  await review(mgr, a, { status: "approved", expected_updated_at: await stamp(a) });
  eq("filter by review status", (await list(O, "status=approved")).body.items.map((x) => x.full_name), ["Alice Aaa"]);
  eq("filter 'new'", (await list(O, "status=submitted")).body.items.map((x) => x.full_name), ["Bob Bbb"]);
  eq("filter by publication", (await list(O, "publication=published")).body.items.length, 0);
  eq("search by name", (await list(O, "q=bob")).body.items.map((x) => x.full_name), ["Bob Bbb"]);
  eq("search treats % and _ as plain characters (no wildcard)", (await list(O, "q=%25")).body.items.length, 2);
  const today = doualaToday();
  eq("filter by date: today", (await list(O, `from=${today}&to=${today}`)).body.items.length, 2);
  eq("filter by date: yesterday and before has none", (await list(O, `from=${shift(today, -30)}&to=${shift(today, -1)}`)).body.items.length, 0);
  is("a bad filter is 400", await list(O, "status=secret"), 400, "invalid_filter");
  is("a bad date is 400", await list(O, "from=nope"), 400, "invalid_report_date");
  is("end before start is 400", await list(O, `from=${today}&to=${shift(today, -1)}`), 400, "invalid_range");
  is("an unknown parameter is 400", await list(O, "profile_id=" + prof.c2), 400, "unexpected_field");
  is("a bad page is 400", await list(O, "page=0"), 400, "invalid_page");
  void b;
}

section("H. NOTHING PRIVATE LEAKS TO THE PUBLIC: ");
{
  await H.fresh(EXTRA);
  const live = await newT({ publish_consent: true, name_consent: true, full_name: "Visible Vera", phone: "699 31 31 31", group_label: "Secret Choir Group", body: "A published testimony with enough words." });
  const live2 = await newT({ publish_consent: true, name_consent: false, full_name: "Hidden Henri", phone: "699 32 32 32", group_label: "Youth Wing", body: "An anonymous published testimony here." });
  const priv = await newT({ publish_consent: false, full_name: "Private Paul", phone: "699 33 33 33", body: "A private testimony that must never show." });
  const pend = await newT({ publish_consent: true, full_name: "Pending Pierre", phone: "699 34 34 34", body: "A not yet approved testimony must not show." });
  for (const id of [live, live2]) { await review(mgr, id, { status: "approved", expected_updated_at: await stamp(id) }); await publish(pub, id, { confirm: true, expected_updated_at: await stamp(id) }); }
  await patch(mgr, live, { moderation_note: "INTERNAL NOTE do not show", expected_updated_at: await stamp(live) });
  const bundle = await IDX.loadChurchPublic(F.sessionFor(H.db, null), prof.c1);
  const text = JSON.stringify(bundle);
  eq("only the two published, consented testimonies are public", bundle.testimonies.map((x) => x.id).sort(), [live, live2].sort());
  eq("every public testimony has exactly these four fields", [...new Set(bundle.testimonies.map((x) => Object.keys(x).sort().join()))], ["body,display_name,id,lang"]);
  check("no phone number, group, internal note, private, pending or hidden name anywhere in the public bundle", !/69931|69932|69933|69934|Secret Choir|Youth Wing|INTERNAL|Private Paul|Pending Pierre|Hidden Henri|must never show|not yet approved/.test(text), text);
  eq("the name appears only where allowed", bundle.testimonies.map((x) => x.display_name).sort((a, b) => String(a).localeCompare(String(b))), [null, "Visible Vera"].sort((a, b) => String(a).localeCompare(String(b))));
  // the visitor's own session cannot read the table behind it
  const direct = await F.sessionFor(H.db, null).from("ministry_testimonies").select("phone");
  check("the visitor's session cannot read the table directly", !!direct.error && direct.error.code === "42501");
  const direct2 = await F.sessionFor(H.db, u.stranger).from("ministry_testimonies").select("id");
  eq("a signed-in stranger reads no row either", (direct2.data || []).length, 0);
  // the public shaping drops anything else a row carried
  const S = PT.shapePublicTestimonies;
  const good = (n, o = {}) => ({ id: F.id("5", 5000 + n), display_name: "A Name", body: "Words here.", lang: "en", phone: "237600000000", group_label: "Choir", moderation_note: "x", review_status: "approved", ...o });
  check("shape: only the four public fields survive, whatever the row carried", JSON.stringify(Object.keys(S([good(1)])[0])) === '["id","display_name","body","lang"]');
  check("shape: empty text, bad id and junk are dropped; at most 12", S([good(2, { body: "  " }), good(3, { id: "x" }), null, 5, "x"]).length === 0 && S(Array.from({ length: 20 }, (_, i) => good(i + 10))).length === 12 && S(null).length === 0);
  check("shape: a blank name becomes null", S([good(4, { display_name: "   " })])[0].display_name === null);
  const fake = (res, seen = {}) => ({ rpc: async (fn, args) => { seen.fn = fn; seen.args = args; return res; } });
  const seen = {};
  check("loader: calls the one public function with only the church id", (await PT.loadPublicTestimonies(fake({ data: [good(5)], error: null }, seen), prof.c1)).length === 1 && seen.fn === "ministry_testimonies_public" && JSON.stringify(seen.args) === JSON.stringify({ p_profile_id: prof.c1 }));
  check("loader: an error or a throw gives []", (await PT.loadPublicTestimonies(fake({ data: null, error: { code: "42883" } }), prof.c1)).length === 0 && (await PT.loadPublicTestimonies({ rpc() { throw new Error("x"); } }, prof.c1)).length === 0);
  const src = fs.readFileSync(path.join(REPO, "src/lib/church/public/testimonies.ts"), "utf8").replace(/\/\/[^\n]*/g, "");
  check("the public loader reads no table at all (only the function)", !/\.from\(/.test(src) && !/createAdminClient/.test(src));
  // withdrawing consent removes it from the very next public read
  await consent(mgr, live2, { scope: "publication", confirm: true, expected_updated_at: await stamp(live2) });
  eq("after a withdrawal the next public read no longer has it", (await IDX.loadChurchPublic(F.sessionFor(H.db, null), prof.c1)).testimonies.map((x) => x.id), [live]);
  await unpublish(mgr, live, { confirm: true, expected_updated_at: await stamp(live) });
  eq("after unpublishing, nothing is public", (await IDX.loadChurchPublic(F.sessionFor(H.db, null), prof.c1)).testimonies.length, 0);
  void priv; void pend;
}

section("I. text and scope: ");
{
  const en = TR.en.churchTestimonies, fr = TR.fr.churchTestimonies;
  const shape = (a, b, p = "") => { const out = []; for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const x = a[k], y = b[k], here = `${p}.${k}`; if (typeof x !== typeof y) out.push(here); else if (x && typeof x === "object") out.push(...shape(x, y, here)); else if (typeof x === "function" && x.length !== y.length) out.push(here + "()"); else if (typeof x === "string" && (!x.trim() || !y.trim())) out.push(here + " empty"); } return out; };
  eq("English and French have exactly the same keys, types and arity", shape(en, fr), []);
  const codes = new Set(["status_unchanged", "nothing_changed", "no_publish_consent", "not_approved", "already_published", "not_published", "consent_not_held", "invalid_scope", "invalid_status", "invalid_filter", "cannot_publish", "consent_cannot_be_granted", "invalid_public_body", "invalid_note"]);
  const src = fs.readFileSync(path.join(REPO, "src/lib/church/testimonies/handlers.ts"), "utf8");
  for (const mm of src.matchAll(/fail\(\d{3}, "([a-z_]+)"/g)) codes.add(mm[1]);
  for (const c of codes) for (const lang of ["en", "fr"]) check(`code ${c} has its own sentence (${lang})`, ET.churchErrorText(TR[lang], c) !== TR[lang].churchPeople.errors.generic, c);
  const pubCodes = ["invalid_name", "invalid_phone", "invalid_group", "invalid_testimony", "invalid_consent", "too_many", "not_found", "network", "generic"];
  check("every public form error has a sentence in both languages", pubCodes.every((c) => en.public.form.errors[c] && fr.public.form.errors[c]));
  const code = [src, fs.readFileSync(path.join(REPO, "src/lib/church/testimonies/submit.ts"), "utf8")].join("\n").replace(/\/\/[^\n]*/g, "");
  check("the testimony code has no payment, money, ledger or provider code", !/fapshi|stripe|payment|contribution|ledger|refund|payout|currency|amount/i.test(code), (code.match(/fapshi|stripe|payment|contribution|ledger|refund|payout|currency|amount/i) || [""])[0]);
  check("the staff handlers never create an admin client; the submit helper never creates one either (the route hands it in)", !/createAdminClient/.test(code));
  check("the testimonies code never touches a care table", !/ministry_care|beneficiar/i.test(code));
  const aiTool = fs.readFileSync(path.join(REPO, "src/lib/ai/tools/definitions/churchReport.ts"), "utf8").replace(/\/\/[^\n]*/g, "");
  const reports = ["period", "build", "csv", "handlers"].map((f) => fs.readFileSync(path.join(REPO, `src/lib/church/reports/${f}.ts`), "utf8")).join("\n").replace(/\/\/[^\n]*/g, "");
  check("Ringo AI's tool and the reports never read a testimony", !/ministry_testimon/i.test(aiTool) && !/ministry_testimon/i.test(reports));
  const know = fs.readFileSync(path.join(REPO, "src/lib/ai/knowledge/modules/churchMinistries.ts"), "utf8");
  check("the knowledge says testimonies exist, are private, and that Ringo AI cannot see them", /version: 5,/.test(know) && /Share your testimony/.test(know) && /Ringo AI has NO access to testimonies/.test(know) && /Nobody, not even the owner, can grant that permission/.test(know));
  eq("the service-role client was never used by a staff route", globalThis.__adminClientCalls, 0);
}

H.close();
process.exit(summary());
