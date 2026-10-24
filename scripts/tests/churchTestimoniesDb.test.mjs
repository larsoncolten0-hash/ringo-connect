// Churches & Ministries Testimonies: the ministry_testimonies migration, attacked OFFLINE (PGlite, synthetic data, no Supabase, no network).
//   Run:  node scripts/tests/churchTestimoniesDb.test.mjs
import fs from "fs";
import path from "path";
import * as F from "./churchFixtures.mjs";

const { PGlite } = await import(process.env.PGLITE_ENTRY || "@electric-sql/pglite");
const { u, prof, REPO } = F;
let pass = 0, fail = 0, section = "";
const check = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log("  FAIL:", `${section}${name}`, "|", String(detail).slice(0, 400)); } };
const eq = (name, a, b) => check(name, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8").replace(/\r\n/g, "\n");
const MIG = F.TE_MIG;
const SUP = "supabase/support/2027-01-03_ministry_testimonies";
const PRE = read(`${SUP}.preflight.sql`), VER = read(`${SUP}.verify.sql`), ROLL = read(`${SUP}.rollback.sql`);

const U2 = (n) => F.id("c", 190 + n);
const viewer = U2(1), mgr = U2(2), pub = U2(3), other = U2(4), adminPub = U2(5);
const R2 = (n) => F.id("b", 190 + n);
const r = { view: R2(1), mgr: R2(2), pub: R2(3), other: R2(4), adminPub: R2(5) };
const T = (k) => F.id("7", 900 + k);
const KEY = (k) => F.id("3", 900 + k);

async function fresh({ withMig = true, extras = true } = {}) {
  const db = await F.newDb(PGlite, { dailyWords: true, events: true, attendance: true, bible: true, music: true, care: true, testimonies: withMig });
  await F.seed(db);
  if (extras) await F.svc(db, `
    insert into public.users (id, role, plan_id) values ('${viewer}','user','${F.plan.free}'), ('${mgr}','user','${F.plan.free}'), ('${pub}','user','${F.plan.free}'), ('${other}','user','${F.plan.free}'), ('${adminPub}','admin','${F.plan.free}');
    insert into public.organization_roles (id, profile_id, key, name, permissions) values
      ('${r.view}','${prof.c1}','tview','Testimonies viewer','{church.testimonies.view}'),
      ('${r.mgr}','${prof.c1}','tmgr','Testimonies manager','{church.testimonies.manage}'),
      ('${r.pub}','${prof.c1}','tpub','Testimonies publisher','{church.testimonies.publish}'),
      ('${r.other}','${prof.c1}','tother','Care and members','{church.care.publish,church.members.view,church.reports.view}'),
      ('${r.adminPub}','${prof.c1}','tadmin','Platform admin holding testimonies','{church.testimonies.publish,church.testimonies.manage,church.testimonies.view}');
    insert into public.organization_members (profile_id, user_id, role_id) values ('${prof.c1}','${viewer}','${r.view}'), ('${prof.c1}','${mgr}','${r.mgr}'), ('${prof.c1}','${pub}','${r.pub}'), ('${prof.c1}','${other}','${r.other}'), ('${prof.c1}','${adminPub}','${r.adminPub}');
  `);
  return db;
}
const rows = (db, sql) => F.svcQuery(db, sql);
const S = (db, who) => F.sessionFor(db, who);
const Te = (db, who) => S(db, who).from("ministry_testimonies");
const Hi = (db, who) => S(db, who).from("ministry_testimony_history");
const code = (x) => x && x.error && x.error.code;
const msg = (x) => (x && x.error && x.error.message) || "";
let n = 0;
/** Inserts a testimony as the SERVICE ROLE (the only way in), like the public route does. */
async function add(db, o = {}) {
  const id = o.id || T(++n);
  const v = { profile_id: prof.c1, full_name: "Marie Ngono", phone: "237670000111", body: "God healed me from a long illness and I thank Him.", publish_consent: true, name_consent: false, lang: "en", group_label: null, ...o };
  await F.svc(db, `insert into public.ministry_testimonies (id, profile_id, submission_key, full_name, phone, group_label, body, lang, publish_consent, name_consent) values ('${id}','${v.profile_id}','${o.key || KEY(n)}','${v.full_name}','${v.phone}',${v.group_label ? `'${v.group_label}'` : "null"},'${v.body}','${v.lang}',${v.publish_consent},${v.name_consent})`);
  return id;
}
const state = async (db, id) => (await rows(db, `select review_status, publication_status, publish_consent, name_consent, public_body, moderation_note from public.ministry_testimonies where id = '${id}'`))[0];
const publicRows = async (db, who, profile = prof.c1) => (await S(db, who).rpc("ministry_testimonies_public", { p_profile_id: profile })).data || [];

section = "A. structure and grants: ";
{
  const db = await fresh();
  const Tb = ["ministry_testimonies", "ministry_testimony_history"];
  for (const t of Tb) {
    for (const k of ["select", "insert", "update", "delete", "truncate", "references", "trigger"]) {
      check(`${t}: anon has no table-level ${k}`, (await rows(db, `select has_table_privilege('anon','public.${t}','${k}') as b`))[0].b === false);
      check(`${t}: PUBLIC has no ${k}`, (await rows(db, `select has_table_privilege('public','public.${t}','${k}') as b`))[0].b === false);
    }
    for (const k of ["select", "insert", "update"]) check(`${t}: anon has no column-level ${k}`, (await rows(db, `select has_any_column_privilege('anon','public.${t}','${k}') as b`))[0].b === false);
    for (const k of ["insert", "delete", "truncate", "references", "trigger"]) check(`${t}: authenticated cannot ${k}`, (await rows(db, `select (has_any_column_privilege('authenticated','public.${t}','insert') and '${k}' = 'insert') or (has_table_privilege('authenticated','public.${t}','${k}') and '${k}' <> 'insert') as b`))[0].b === false);
    check(`${t}: row-level security is on and no policy is for PUBLIC`, (await rows(db, `select relrowsecurity as b from pg_class where oid = 'public.${t}'::regclass`))[0].b === true && (await rows(db, `select count(*)::int as n from pg_policy where polrelid = 'public.${t}'::regclass and polroles = array[0::oid]`))[0].n === 0);
  }
  for (const c of ["full_name", "phone", "group_label", "body", "lang", "profile_id", "submission_key", "consent_at", "created_at"]) check(`authenticated cannot update the submitter's own ${c}`, (await rows(db, `select has_column_privilege('authenticated','public.ministry_testimonies','${c}','update') as b`))[0].b === false);
  for (const [t, c] of [["ministry_testimonies", "published_by"], ["ministry_testimonies", "reviewed_by"], ["ministry_testimonies", "edited_by"], ["ministry_testimonies", "submission_key"], ["ministry_testimony_history", "actor_id"]])
    for (const who of ["anon", "authenticated"]) for (const k of ["select", "insert", "update"]) check(`${who} cannot ${k} ${t}.${c}`, (await rows(db, `select has_column_privilege('${who}','public.${t}','${c}','${k}') as b`))[0].b === false);
  check("authenticated cannot update the history", (await rows(db, `select has_any_column_privilege('authenticated','public.ministry_testimony_history','update') as b`))[0].b === false);
  eq("policies: testimonies 2+1, history 1", [(await rows(db, `select count(*) filter (where polpermissive)::int as p, count(*) filter (where not polpermissive)::int as r from pg_policy where polrelid = 'public.ministry_testimonies'::regclass`))[0], (await rows(db, `select count(*)::int as n from pg_policy where polrelid = 'public.ministry_testimony_history'::regclass`))[0].n], [{ p: 2, r: 1 }, 1]);
  for (const fn of ["ministry_testimony_guard()", "ministry_testimony_audit()", "ministry_testimony_history_guard()"]) check(`${fn} is not callable by anon / authenticated / PUBLIC`, (await rows(db, `select (has_function_privilege('anon','public.${fn}','execute') or has_function_privilege('authenticated','public.${fn}','execute') or has_function_privilege('public','public.${fn}','execute')) as b`))[0].b === false);
  check("the public function is callable by anon and authenticated but not PUBLIC", (await rows(db, `select (has_function_privilege('anon','public.ministry_testimonies_public(uuid)','execute') and has_function_privilege('authenticated','public.ministry_testimonies_public(uuid)','execute') and not has_function_privilege('public','public.ministry_testimonies_public(uuid)','execute')) as b`))[0].b === true);
  eq("no money-like column exists", (await rows(db, `select count(*)::int as n from information_schema.columns where table_schema='public' and table_name like 'ministry\\_testimon%' and column_name ~* '(amount|price|currency|money|fee|commission|payment|payout|refund|receipt|balance)'`))[0].n, 0);
  eq("no column links a testimony to a care case or a beneficiary", (await rows(db, `select count(*)::int as n from information_schema.columns where table_schema='public' and table_name like 'ministry\\_testimon%' and column_name ~* '(care|beneficiar|member_id|case_id)'`))[0].n, 0);
  await db.close();
}

section = "B. anonymous visitors can reach nothing: ";
{
  const db = await fresh();
  const id = await add(db);
  await F.svc(db, `update public.ministry_testimonies set review_status = 'approved' where id = '${id}'; update public.ministry_testimonies set publication_status = 'published' where id = '${id}'`);
  check("anon cannot select the table, even a published testimony", code(await Te(db, null).select("id")) === "42501");
  check("anon cannot select phone or name or body", code(await Te(db, null).select("phone")) === "42501" && code(await Te(db, null).select("full_name")) === "42501" && code(await Te(db, null).select("body")) === "42501");
  check("anon cannot insert", !!(await Te(db, null).insert({ id: T(990), profile_id: prof.c1, submission_key: KEY(990), full_name: "Bot Bot", phone: "237670000999", body: "spam spam spam spam" })).error);
  check("a signed-in stranger cannot insert either", !!(await Te(db, u.stranger).insert({ id: T(991), profile_id: prof.c1, submission_key: KEY(991), full_name: "Bot Bot", phone: "237670000999", body: "spam spam spam spam" })).error);
  check("not even the church owner can insert through the API (only the server route can)", !!(await Te(db, u.owner1).insert({ id: T(992), profile_id: prof.c1, submission_key: KEY(992), full_name: "Bot Bot", phone: "237670000999", body: "spam spam spam spam" })).error);
  eq("a signed-in stranger reads no row", ((await Te(db, u.stranger).select("id")).data || []).length, 0);
  check("anon cannot read the history", code(await Hi(db, null).select("id")) === "42501");
  eq("the public function is the only read: it returns the published, consented testimony", (await publicRows(db, null)).length, 1);
  const pr = await publicRows(db, null);
  eq("...with exactly five fields, none of them a phone, group, status or note", Object.keys(pr[0]).sort(), ["body", "display_name", "id", "lang", "published_at"]);
  eq("...and no name, because name consent was not given", pr[0].display_name, null);
  await db.close();
}

section = "C. staff access (permissions): ";
{
  const db = await fresh();
  const id = await add(db);
  eq("the owner reads it", ((await Te(db, u.owner1).select("id,full_name,phone,body")).data || []).map((x) => x.id), [id]);
  eq("the viewer reads it, with the phone number", ((await Te(db, viewer).select("phone")).data || []).map((x) => x.phone), ["237670000111"]);
  eq("a manager reads it", ((await Te(db, mgr).select("id")).data || []).length, 1);
  eq("a publisher reads it", ((await Te(db, pub).select("id")).data || []).length, 1);
  eq("a member with only OTHER church permissions (care publish, members view, reports view) reads none", ((await Te(db, other).select("id")).data || []).length, 0);
  eq("a stranger reads none", ((await Te(db, u.stranger).select("id")).data || []).length, 0);
  eq("another church's owner reads none", ((await Te(db, u.owner2).select("id")).data || []).length, 0);
  eq("a platform admin who is not the owner reads none, even holding every testimony role", ((await Te(db, adminPub).select("id")).data || []).length, 0);
  eq("the history is staff-only too", [((await Hi(db, viewer).select("action")).data || []).length, ((await Hi(db, other).select("action")).data || []).length, ((await Hi(db, u.stranger).select("action")).data || []).length], [1, 0, 0]);
  const upd = (who, patch) => Te(db, who).update(patch).eq("id", id).select("id");
  eq("the viewer cannot moderate", ((await upd(viewer, { review_status: "under_review" })).data || []).length, 0);
  eq("a stranger cannot moderate", ((await upd(u.stranger, { review_status: "under_review" })).data || []).length, 0);
  eq("another church's owner cannot moderate", ((await upd(u.owner2, { review_status: "under_review" })).data || []).length, 0);
  eq("a non-owner platform admin cannot moderate", ((await upd(adminPub, { review_status: "under_review" })).data || []).length, 0);
  eq("the care publisher cannot moderate testimonies", ((await upd(other, { review_status: "under_review" })).data || []).length, 0);
  eq("a manager can mark it under review", ((await upd(mgr, { review_status: "under_review" })).data || []).length, 1);
  eq("a manager can approve it", ((await upd(mgr, { review_status: "approved" })).data || []).length, 1);
  const mp = await Te(db, mgr).update({ publication_status: "published" }).eq("id", id);
  check("a manager CANNOT publish (needs church.testimonies.publish)", !!mp.error && /testimony_publish_permission/.test(msg(mp)), JSON.stringify(mp.error));
  eq("a publisher can publish an approved, consented testimony", ((await upd(pub, { publication_status: "published" })).data || []).length, 1);
  eq("a manager can take it down", ((await upd(mgr, { publication_status: "unpublished" })).data || []).length, 1);
  eq("reviewed_by / published_by are the real people", (await rows(db, `select reviewed_by, published_by from public.ministry_testimonies where id = '${id}'`))[0], { reviewed_by: mgr, published_by: null });
  await db.close();
}

section = "D. the submitter's words and consent cannot be touched: ";
{
  const db = await fresh();
  const id = await add(db, { publish_consent: false });
  for (const [col, val] of [["full_name", "Someone Else"], ["phone", "237699999999"], ["group_label", "Choir"], ["body", "Changed words for the testimony."], ["lang", "fr"]])
    check(`the owner cannot change the submitter's ${col} through the API`, !!(await Te(db, u.owner1).update({ [col]: val }).eq("id", id)).error);
  for (const [col, val] of [["full_name", "Someone Else"], ["phone", "237699999999"], ["body", "Changed words for the testimony."], ["profile_id", prof.c2], ["submission_key", KEY(777)], ["created_at", "2020-01-01"], ["consent_at", "2020-01-01"]]) {
    const e = await F.svcErr(db, `update public.ministry_testimonies set ${col} = '${val}' where id = '${id}'`);
    check(`even the service role cannot change ${col}`, !!e && /testimony_original_immutable/.test(e.msg), JSON.stringify(e));
  }
  const grant = await Te(db, u.owner1).update({ publish_consent: true }).eq("id", id);
  check("the owner CANNOT grant publication consent that the person refused", !!grant.error && /testimony_consent_cannot_be_granted/.test(msg(grant)), JSON.stringify(grant.error));
  const grantSvc = await F.svcErr(db, `update public.ministry_testimonies set publish_consent = true where id = '${id}'`);
  check("...nor can the service role", !!grantSvc && /testimony_consent_cannot_be_granted/.test(grantSvc.msg), JSON.stringify(grantSvc));
  const grantName = await F.svcErr(db, `update public.ministry_testimonies set name_consent = true where id = '${id}'`);
  check("name consent cannot be granted later either", !!grantName && /testimony_consent_cannot_be_granted/.test(grantName.msg), JSON.stringify(grantName));
  eq("it is still private and unreviewed", await state(db, id), { review_status: "submitted", publication_status: "unpublished", publish_consent: false, name_consent: false, public_body: null, moderation_note: null });
  const noConsentPublish = await F.svcErr(db, `update public.ministry_testimonies set review_status = 'approved'; update public.ministry_testimonies set publication_status = 'published' where id = '${id}'`);
  check("an APPROVED testimony whose author refused publication can never be published (administrators cannot override a refusal)", !!noConsentPublish && /testimony_cannot_publish|ministry_testimonies_published_check/.test(noConsentPublish.msg), JSON.stringify(noConsentPublish));
  eq("...it stays unpublished", (await state(db, id)).publication_status, "unpublished");
  check("name consent without publication consent is refused by a constraint", !!(await F.svcErr(db, `insert into public.ministry_testimonies (profile_id, submission_key, full_name, phone, body, publish_consent, name_consent) values ('${prof.c1}','${KEY(555)}','Name Only','237670000222','Some words here for testimony.', false, true)`)));
  await db.close();
}

section = "E. review and publication are separate; approval never publishes: ";
{
  const db = await fresh();
  const id = await add(db);
  await F.svc(db, `update public.ministry_testimonies set review_status = 'approved' where id = '${id}'`);
  eq("approved alone is NOT public", [(await state(db, id)).publication_status, (await publicRows(db, null)).length], ["unpublished", 0]);
  await F.svc(db, `update public.ministry_testimonies set publication_status = 'published' where id = '${id}'`);
  eq("approved + consent + published is public", (await publicRows(db, null)).length, 1);
  await F.svc(db, `update public.ministry_testimonies set review_status = 'under_review' where id = '${id}'`);
  eq("leaving 'approved' unpublishes it at once, in the same statement", [(await state(db, id)).publication_status, (await publicRows(db, null)).length], ["unpublished", 0]);
  await F.svc(db, `update public.ministry_testimonies set review_status = 'approved' where id = '${id}'`);
  eq("approving again does NOT bring it back by itself", (await publicRows(db, null)).length, 0);
  await F.svc(db, `update public.ministry_testimonies set publication_status = 'published' where id = '${id}'`);
  await F.svc(db, `update public.ministry_testimonies set review_status = 'rejected' where id = '${id}'`);
  eq("rejecting a live testimony takes it off the page at once", [(await state(db, id)).publication_status, (await publicRows(db, null)).length], ["unpublished", 0]);
  const back = await F.svcErr(db, `update public.ministry_testimonies set review_status = 'submitted' where id = '${id}'`);
  check("a received testimony cannot go back to 'submitted'", !!back && /testimony_status_invalid/.test(back.msg), JSON.stringify(back));
  const unrev = await F.svcErr(db, `update public.ministry_testimonies set publication_status = 'published' where id = '${id}'`);
  check("a rejected testimony cannot be published", !!unrev, JSON.stringify(unrev));
  eq("the rejected record is kept privately", ((await Te(db, u.owner1).select("id,review_status")).data || []).map((x) => x.review_status), ["rejected"]);
  // a new row can only start private whatever the writer sends
  const sneaky = T(800);
  await F.svc(db, `insert into public.ministry_testimonies (id, profile_id, submission_key, full_name, phone, body, publish_consent, review_status, publication_status, public_body, moderation_note) values ('${sneaky}','${prof.c1}','${KEY(800)}','Sneaky One','237670000333','Words that are long enough here.', true, 'approved', 'published', 'forced public text here', 'note')`);
  eq("an insert that tries to start approved and published is reset to private and unreviewed", await state(db, sneaky), { review_status: "submitted", publication_status: "unpublished", publish_consent: true, name_consent: false, public_body: null, moderation_note: null });
  await db.close();
}

section = "F. consent withdrawal removes it from public at once: ";
{
  const db = await fresh();
  const id = await add(db, { name_consent: true });
  await F.svc(db, `update public.ministry_testimonies set review_status = 'approved' where id = '${id}'; update public.ministry_testimonies set publication_status = 'published' where id = '${id}'`);
  eq("published with name consent: the name is shown", (await publicRows(db, null)).map((x) => x.display_name), ["Marie Ngono"]);
  const wn = await Te(db, mgr).update({ name_consent: false }).eq("id", id).select("id");
  eq("a manager records that the person withdrew NAME permission", (wn.data || []).length, 1);
  eq("...it stays public, now without the name", [(await publicRows(db, null)).length, (await publicRows(db, null))[0].display_name], [1, null]);
  eq("the publication consent is untouched by a name withdrawal", (await state(db, id)).publish_consent, true);
  const wp = await Te(db, mgr).update({ publish_consent: false }).eq("id", id).select("id");
  eq("a manager records that the person withdrew PUBLICATION permission", (wp.data || []).length, 1);
  eq("...it is off the public page immediately", (await publicRows(db, null)).length, 0);
  eq("...the record is kept privately, unpublished, consent withdrawn, approval untouched", await state(db, id), { review_status: "approved", publication_status: "unpublished", publish_consent: false, name_consent: false, public_body: null, moderation_note: null });
  eq("...and the withdrawal time is recorded", (await rows(db, `select (consent_withdrawn_at is not null) as w from public.ministry_testimonies where id = '${id}'`))[0].w, true);
  const again = await F.svcErr(db, `update public.ministry_testimonies set publication_status = 'published' where id = '${id}'`);
  check("it can never be published again after a withdrawal", !!again, JSON.stringify(again));
  const restore = await Te(db, u.owner1).update({ publish_consent: true }).eq("id", id);
  check("the owner cannot restore consent", !!restore.error);
  eq("a viewer cannot record a withdrawal", ((await Te(db, viewer).update({ publish_consent: false }).eq("id", id).select("id")).data || []).length, 0);
  await db.close();
}

section = "G. a staff correction is separate, logged and reversible: ";
{
  const db = await fresh();
  const id = await add(db, { body: "I was healed and I want to thank God for it." });
  await F.svc(db, `update public.ministry_testimonies set review_status = 'approved' where id = '${id}'; update public.ministry_testimonies set publication_status = 'published' where id = '${id}'`);
  eq("the public sees the original words", (await publicRows(db, null))[0].body, "I was healed and I want to thank God for it.");
  const ed = await Te(db, mgr).update({ public_body: "I was healed, and I want to thank God." }).eq("id", id).select("id");
  eq("a manager corrects the text shown on the page", (ed.data || []).length, 1);
  eq("the public now sees the correction", (await publicRows(db, null))[0].body, "I was healed, and I want to thank God.");
  eq("the original words are untouched", (await rows(db, `select body from public.ministry_testimonies where id = '${id}'`))[0].body, "I was healed and I want to thank God for it.");
  eq("the correction is attributed to the editor", (await rows(db, `select edited_by, (edited_at is not null) as at from public.ministry_testimonies where id = '${id}'`))[0], { edited_by: mgr, at: true });
  check("a too-short correction is refused", !!(await Te(db, mgr).update({ public_body: "short" }).eq("id", id)).error);
  const rv = await Te(db, mgr).update({ public_body: null }).eq("id", id).select("id");
  eq("reverting goes back to the original words", [(rv.data || []).length, (await publicRows(db, null))[0].body], [1, "I was healed and I want to thank God for it."]);
  check("the note is not in the public output", !JSON.stringify(await publicRows(db, null)).includes("Call her"));
  check("the viewer cannot correct", ((await Te(db, viewer).update({ public_body: "A viewer correction here." }).eq("id", id).select("id")).data || []).length === 0);
  await db.close();
}

section = "H. the moderation history is complete and append-only: ";
{
  const db = await fresh();
  const id = await add(db, { name_consent: true });
  await Te(db, mgr).update({ review_status: "under_review" }).eq("id", id);
  await Te(db, mgr).update({ review_status: "approved" }).eq("id", id);
  await Te(db, pub).update({ publication_status: "published" }).eq("id", id);
  await Te(db, mgr).update({ public_body: "A corrected public text here." }).eq("id", id);
  await Te(db, mgr).update({ moderation_note: "private note" }).eq("id", id);
  await Te(db, mgr).update({ name_consent: false }).eq("id", id);
  await Te(db, mgr).update({ publish_consent: false }).eq("id", id);
  const h = await rows(db, `select action, from_value, to_value, actor_id from public.ministry_testimony_history where testimony_id = '${id}' order by seq`);
  eq("every step is recorded in order, with the right actor", h.map((x) => [x.action, x.actor_id === null ? "server" : x.actor_id === mgr ? "mgr" : x.actor_id === pub ? "pub" : "?"]), [
    ["submitted", "server"], ["under_review", "mgr"], ["approved", "mgr"], ["published", "pub"], ["edited", "mgr"], ["note_updated", "mgr"], ["name_consent_withdrawn", "mgr"], ["consent_withdrawn", "mgr"], ["unpublished", "mgr"],
  ]);
  eq("status changes keep from / to", h.filter((x) => x.action === "approved").map((x) => [x.from_value, x.to_value]), [["under_review", "approved"]]);
  check("the history holds no text of the testimony, no phone and no note", !JSON.stringify(h).match(/corrected public|private note|237670|God healed/));
  check("an API role cannot add, edit or delete history", !!(await Hi(db, mgr).insert({ id: T(950), profile_id: prof.c1, testimony_id: id, action: "approved" })).error && !!(await Hi(db, mgr).update({ action: "rejected" }).eq("testimony_id", id)).error && !!(await Hi(db, mgr).delete().eq("testimony_id", id)).error);
  const upd = await F.svcErr(db, `update public.ministry_testimony_history set action = 'rejected' where testimony_id = '${id}'`);
  check("even the service role cannot edit a history row", !!upd && /testimony_history_immutable/.test(upd.msg), JSON.stringify(upd));
  check("no API role can delete a testimony", !!(await Te(db, u.owner1).delete().eq("id", id)).error);
  eq("the viewer reads the history, staff of another church and strangers do not", [((await Hi(db, viewer).select("action")).data || []).length > 0, ((await Hi(db, u.owner2).select("action")).data || []).length], [true, 0]);
  await db.close();
}

section = "I. the public output only shows what is allowed: ";
{
  const db = await fresh();
  const live = await add(db, { full_name: "Visible Person", phone: "237670000444", group_label: "Youth", name_consent: true, body: "My testimony that is live now." });
  const anon2 = await add(db, { full_name: "Hidden Name", phone: "237670000555", group_label: "Choir", name_consent: false, body: "Anonymous live testimony here." });
  const draft = await add(db, { full_name: "Draft Person", phone: "237670000666", body: "Only submitted never reviewed here." });
  const refused = await add(db, { full_name: "Refused Person", phone: "237670000777", publish_consent: false, body: "Private only, they refused publication." });
  const rejected = await add(db, { full_name: "Rejected Person", phone: "237670000888", body: "Rejected testimony text goes here." });
  const other = await add(db, { profile_id: prof.c2, full_name: "Other Church", phone: "237670000999", body: "A testimony of the second church." });
  for (const id of [live, anon2, other]) await F.svc(db, `update public.ministry_testimonies set review_status = 'approved' where id = '${id}'; update public.ministry_testimonies set publication_status = 'published' where id = '${id}'`);
  await F.svc(db, `update public.ministry_testimonies set review_status = 'rejected' where id = '${rejected}'`);
  const out = await publicRows(db, null);
  eq("only the two approved + published + consented testimonies of THIS church", out.map((x) => x.id).sort(), [live, anon2].sort());
  eq("the name appears only for the one who allowed it", out.map((x) => x.display_name).sort((a, b) => String(a).localeCompare(String(b))), [null, "Visible Person"].sort((a, b) => String(a).localeCompare(String(b))));
  const text = JSON.stringify(out);
  check("no phone number, group, other church, draft, refused or rejected testimony anywhere in the output", !/2376700|Youth|Choir|Other Church|Draft Person|Refused|Rejected|second church|Hidden Name/.test(text), text);
  eq("another church's output is its own", (await publicRows(db, null, prof.c2)).map((x) => x.id), [other]);
  eq("a signed-in stranger gets the same output as anon", (await publicRows(db, u.stranger)).map((x) => x.id).sort(), [live, anon2].sort());
  await F.svc(db, `update public.profiles set published = false where id = '${prof.c1}'`);
  eq("if the church page is unpublished nothing is returned", (await publicRows(db, null)).length, 0);
  await F.svc(db, `update public.profiles set published = true where id = '${prof.c1}'`);
  // twelve at most, newest first
  for (let i = 0; i < 14; i++) { const id = await add(db, { full_name: `Person Number${i}`, phone: `23767000${String(1000 + i)}`, body: `Another testimony number ${i} long enough.` }); await F.svc(db, `update public.ministry_testimonies set review_status = 'approved' where id = '${id}'; update public.ministry_testimonies set publication_status = 'published' where id = '${id}'`); }
  eq("at most twelve are returned", (await publicRows(db, null)).length, 12);
  await db.close();
}

section = "J. data rules and isolation: ";
{
  const db = await fresh();
  const bad = async (name, o) => { const e = await F.svcErr(db, `insert into public.ministry_testimonies (profile_id, submission_key, full_name, phone, body, group_label) values ('${o.profile || prof.c1}','${o.key || KEY(++n + 300)}','${o.name || "Valid Name"}','${o.phone || "237670000123"}','${o.body || "A valid testimony body text."}',${o.group ? `'${o.group}'` : "null"})`); check(name, !!e, JSON.stringify(e)); };
  await bad("a one-letter name is refused", { name: "A" });
  await bad("a phone with letters is refused", { phone: "23767abc0123" });
  await bad("a phone that is too short is refused", { phone: "1234567" });
  await bad("a body under 10 characters is refused", { body: "short" });
  await bad("a body over 3000 characters is refused", { body: "x".repeat(3001) });
  await bad("a group over 80 characters is refused", { group: "g".repeat(81) });
  await bad("a profile that is not a church cannot receive testimonies", { profile: prof.nc });
  const a = await add(db, { key: KEY(321) });
  const dup = await F.svcErr(db, `insert into public.ministry_testimonies (profile_id, submission_key, full_name, phone, body) values ('${prof.c1}','${KEY(321)}','Valid Name','237670000123','A valid testimony body text.')`);
  check("the same form key twice in one church is refused (no duplicates)", !!dup && /ministry_testimonies_submission_key/.test(dup.msg), JSON.stringify(dup));
  check("the same key in ANOTHER church is a different testimony", !(await F.svcErr(db, `insert into public.ministry_testimonies (profile_id, submission_key, full_name, phone, body) values ('${prof.c2}','${KEY(321)}','Valid Name','237670000123','A valid testimony body text.')`)));
  await F.svc(db, `delete from public.profiles where id = '${prof.c2}'`);
  eq("deleting a church removes its testimonies and their history", [(await rows(db, `select count(*)::int as n from public.ministry_testimonies where profile_id = '${prof.c2}'`))[0].n, (await rows(db, `select count(*)::int as n from public.ministry_testimony_history where profile_id = '${prof.c2}'`))[0].n], [0, 0]);
  void a;
  await db.close();
}

section = "K. support scripts and re-runs: ";
{
  const pre = await fresh({ withMig: false, extras: false });
  const p1 = (await pre.query(PRE)).rows;
  check("preflight: nine rows, all ok before the migration", p1.length === 9 && p1.every((x) => x.ok === true), JSON.stringify(p1.filter((x) => x.ok !== true)));
  await pre.exec(MIG);
  check("preflight after applying: the 'does not exist yet' rows fail (it is a BEFORE check)", (await pre.query(PRE)).rows.filter((x) => x.ok !== true).length >= 2);
  const v = (await pre.query(VER)).rows;
  check("verify: seventeen rows, all ok", v.length === 17 && v.every((x) => x.ok === true), JSON.stringify(v.filter((x) => x.ok !== true)));
  await add(pre, { key: KEY(901) });
  await pre.exec(MIG);
  eq("re-running the migration keeps the data", (await rows(pre, "select count(*)::int as n from public.ministry_testimonies"))[0].n, 1);
  check("verify still passes after a re-run", (await pre.query(VER)).rows.every((x) => x.ok === true));
  let err = null; try { await pre.exec(ROLL); } catch (e) { err = String(e.message); await pre.exec("rollback").catch(() => {}); }
  check("rollback refuses while a row exists", !!err && /rollback refused/.test(err), err);
  eq("...and nothing was dropped", (await rows(pre, "select count(*)::int as n from public.ministry_testimonies"))[0].n, 1);
  await pre.exec(ROLL.replace("begin;", "begin;\nselect set_config('ministry_testimonies.allow_data_loss', 'yes', true);"));
  check("rollback with explicit confirmation drops the tables and the functions", (await rows(pre, "select (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relname like 'ministry\\_testimon%') = 0 and (select count(*) from pg_proc where proname like 'ministry\\_testimon%') = 0 as a"))[0].a === true);
  await pre.exec(ROLL);
  check("rollback is safe to run again", true);
  await pre.exec(MIG);
  check("the migration can be applied again after a rollback", (await rows(pre, "select to_regclass('public.ministry_testimonies') is not null as a"))[0].a === true);
  await pre.close();

  const a = await fresh({ withMig: false, extras: false }); const b = await fresh({ extras: false });
  const fp = async (d) => JSON.stringify(await rows(d, `select (select jsonb_agg(proname || ':' || md5(pg_get_functiondef(oid)) order by proname) from pg_proc where pronamespace = 'public'::regnamespace and (proname like 'church\\_%' or proname like 'team\\_church\\_%' or proname like 'bible\\_%' or proname like 'daily\\_word%' or (proname like 'ministry\\_%' and proname not like 'ministry\\_testimon%') or proname in ('is_admin','has_org_permission','is_org_member'))) as f, (select jsonb_agg(polrelid::regclass::text || ':' || polname order by polrelid::regclass::text, polname) from pg_policy where polrelid::regclass::text not like 'ministry\\_testimon%') as p`));
  check("applying the migration changes no existing function and no other table's policy", (await fp(a)) === (await fp(b)));
  await a.close(); await b.close();

  const foreign = await fresh({ withMig: false, extras: false });
  await foreign.exec(`create table public.ministry_testimonies (id uuid primary key)`);
  let e4 = null; try { await foreign.exec(MIG); } catch (e) { e4 = String(e.message); await foreign.exec("rollback").catch(() => {}); }
  check("the migration refuses to adopt a same-named table it does not manage", !!e4 && /precondition failed/.test(e4), e4);
  await foreign.close();
}

section = "L. the migration text itself: ";
{
  const c = MIG.replace(/--[^\n]*/g, "");
  const created = [...c.matchAll(/create (?:or replace )?(?:unique )?(table|function|trigger|index|policy)\s+(?:if not exists\s+)?(?:public\.)?([a-z_]+)/gi)].map((mm) => mm[2]);
  check("it creates only ministry_testimon* objects", created.length > 0 && created.every((x) => /^ministry_testimon/.test(x)), created.filter((x) => !/^ministry_testimon/.test(x)).join());
  check("it never alters or drops an existing object", !/alter table public\.(?!ministry_testimon)|drop (table|function|index) /i.test(c));
  check("it writes no row anywhere", !/(^|;)\s*(insert\s+into\s+public\.(?!ministry_testimony_history)|update\s+public\.|delete\s+from)/im.test(c));
  check("no audit column has a grant", !/grant [^;]*(published_by|reviewed_by|edited_by|actor_id|submission_key)/i.test(c));
  check("there is no anon grant on either table and no insert or delete grant to authenticated", !/grant [^;]*on public\.ministry_testimon[a-z_]* to [^;]*anon/i.test(c) && !/grant (insert|delete)[^;]*to authenticated/i.test(c));
  const noGuard = c.split("\n").filter((l) => !l.includes("column_name ~*")).join("\n");
  check("no money, payment or ledger object or column is defined", !/(amount|price|currency|contribution|payment|payout|refund|ledger|fapshi|receipt)/i.test(noGuard), (noGuard.match(/(amount|price|currency|contribution|payment|payout|refund|ledger|fapshi|receipt)/i) || [""])[0]);
  check("the three permissions are named exactly", /church\.testimonies\.view/.test(MIG) && /church\.testimonies\.manage/.test(MIG) && /church\.testimonies\.publish/.test(MIG));
  check("it is wrapped in one transaction", /^begin;/m.test(MIG) && /^commit;/m.test(MIG));
}

console.log(`\n${fail === 0 ? "OK" : "FAILED"}: ${pass} checks passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
