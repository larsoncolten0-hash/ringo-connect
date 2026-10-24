// Churches & Ministries Phase 9: the ministry_care_cases migration (CASES, CONSENT, PRIVATE BENEFICIARY LINK; no money), attacked OFFLINE (PGlite, synthetic data, no Supabase, no network).
//   Run:  node scripts/tests/ministryCareDb.test.mjs
import fs from "fs";
import path from "path";
import * as F from "./churchFixtures.mjs";

const { PGlite } = await import(process.env.PGLITE_ENTRY || "@electric-sql/pglite");
const { u, prof, m, REPO } = F;
let pass = 0, fail = 0, section = "";
const check = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log("  FAIL:", `${section}${name}`, "|", String(detail).slice(0, 400)); } };
const eq = (name, a, b) => check(name, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8").replace(/\r\n/g, "\n");
const MIG = F.CA_MIG;
const SUP = "supabase/support/2027-01-02_ministry_care_cases";
const PRE = read(`${SUP}.preflight.sql`), VER = read(`${SUP}.verify.sql`), ROLL = read(`${SUP}.rollback.sql`);

const U2 = (n) => F.id("c", 130 + n);
const viewer = U2(1), mgr = U2(2), pub = U2(3), other = U2(4), adminPub = U2(5);
const R2 = (n) => F.id("b", 130 + n);
const r = { view: R2(1), mgr: R2(2), pub: R2(3), other: R2(4), adminPub: R2(5) };
const K = (k) => F.id("6", 700 + k);
const CN = (k) => F.id("5", 700 + k);

async function fresh({ withCare = true, extras = true } = {}) {
  const db = await F.newDb(PGlite, { dailyWords: true, events: true, attendance: true, bible: true, music: true, care: withCare });
  await F.seed(db);
  if (extras) await F.svc(db, `
    insert into public.users (id, role, plan_id) values ('${viewer}','user','${F.plan.free}'), ('${mgr}','user','${F.plan.free}'), ('${pub}','user','${F.plan.free}'), ('${other}','user','${F.plan.free}'), ('${adminPub}','admin','${F.plan.free}');
    insert into public.organization_roles (id, profile_id, key, name, permissions) values
      ('${r.view}','${prof.c1}','cview','Care viewer','{church.care.view}'),
      ('${r.mgr}','${prof.c1}','cmgr','Care manager','{church.care.manage}'),
      ('${r.pub}','${prof.c1}','cpub','Care publisher','{church.care.publish}'),
      ('${r.other}','${prof.c1}','cother','Events publisher','{church.events.publish,church.members.view}'),
      ('${r.adminPub}','${prof.c1}','cadmin','Platform admin holding care','{church.care.publish,church.care.manage,church.care.view}');
    insert into public.organization_members (profile_id, user_id, role_id) values ('${prof.c1}','${viewer}','${r.view}'), ('${prof.c1}','${mgr}','${r.mgr}'), ('${prof.c1}','${pub}','${r.pub}'), ('${prof.c1}','${other}','${r.other}'), ('${prof.c1}','${adminPub}','${r.adminPub}');
  `);
  return db;
}
const rows = (db, sql) => F.svcQuery(db, sql);
const S = (db, who) => F.sessionFor(db, who);
const Cs = (db, who) => S(db, who).from("ministry_care_cases");
const Bn = (db, who) => S(db, who).from("ministry_care_beneficiaries");
const Cn = (db, who) => S(db, who).from("ministry_care_consents");
const code = (x) => x && x.error && x.error.code;
let n = 0;
const kase = (o = {}) => ({ id: K(++n), profile_id: prof.c1, title_en: `Case ${n}`, summary_en: "A short description written by the church.", ...o });
const consent = (caseId, kind = "granted", o = {}) => ({ id: CN(++n), profile_id: prof.c1, case_id: caseId, kind, given_by: "beneficiary", method: "written", ...o });

section = "A. structure and grants: ";
{
  const db = await fresh();
  const T = ["ministry_care_cases", "ministry_care_beneficiaries", "ministry_care_consents"];
  for (const t of T) {
    for (const k of ["select", "insert", "update", "delete", "truncate", "references", "trigger"]) {
      check(`${t}: anon has no table-level ${k}`, (await rows(db, `select has_table_privilege('anon','public.${t}','${k}') as b`))[0].b === false);
      check(`${t}: PUBLIC has no ${k}`, (await rows(db, `select has_table_privilege('public','public.${t}','${k}') as b`))[0].b === false);
    }
    for (const k of ["insert", "update"]) check(`${t}: anon has no column-level ${k}`, (await rows(db, `select has_any_column_privilege('anon','public.${t}','${k}') as b`))[0].b === false);
    for (const k of ["truncate", "references", "trigger"]) check(`${t}: authenticated cannot ${k}`, (await rows(db, `select has_table_privilege('authenticated','public.${t}','${k}') as b`))[0].b === false);
    check(`${t}: row-level security is on, no policy for PUBLIC`, (await rows(db, `select relrowsecurity as b from pg_class where oid = 'public.${t}'::regclass`))[0].b === true && (await rows(db, `select count(*)::int as n from pg_policy where polrelid = 'public.${t}'::regclass and polroles = array[0::oid]`))[0].n === 0);
    check(`${t}: authenticated cannot update profile_id`, (await rows(db, `select has_column_privilege('authenticated','public.${t}','profile_id','update') as b`))[0].b === false);
  }
  for (const t of ["ministry_care_beneficiaries", "ministry_care_consents"]) check(`anon cannot read a single column of ${t}`, (await rows(db, `select has_any_column_privilege('anon','public.${t}','select') as b`))[0].b === false);
  for (const [t, c] of [["ministry_care_cases", "created_by"], ["ministry_care_cases", "updated_by"], ["ministry_care_cases", "published_by"], ["ministry_care_beneficiaries", "created_by"], ["ministry_care_beneficiaries", "updated_by"], ["ministry_care_consents", "recorded_by"]])
    for (const who of ["anon", "authenticated"]) for (const k of ["select", "insert", "update"]) check(`${who} cannot ${k} ${t}.${c}`, (await rows(db, `select has_column_privilege('${who}','public.${t}','${c}','${k}') as b`))[0].b === false);
  for (const k of ["insert", "update"]) check(`authenticated cannot ${k} consent_state`, (await rows(db, `select has_column_privilege('authenticated','public.ministry_care_cases','consent_state','${k}') as b`))[0].b === false);
  check("anon cannot even read consent_state", (await rows(db, `select has_column_privilege('anon','public.ministry_care_cases','consent_state','select') as b`))[0].b === false);
  check("authenticated can neither update nor delete a consent record", (await rows(db, `select (has_any_column_privilege('authenticated','public.ministry_care_consents','update') or has_table_privilege('authenticated','public.ministry_care_consents','delete')) as b`))[0].b === false);
  eq("policy counts: cases 5+3, beneficiaries 4+3, consents 2+1", [
    (await rows(db, `select count(*) filter (where polpermissive)::int as p, count(*) filter (where not polpermissive)::int as r from pg_policy where polrelid = 'public.ministry_care_cases'::regclass`))[0],
    (await rows(db, `select count(*) filter (where polpermissive)::int as p, count(*) filter (where not polpermissive)::int as r from pg_policy where polrelid = 'public.ministry_care_beneficiaries'::regclass`))[0],
    (await rows(db, `select count(*) filter (where polpermissive)::int as p, count(*) filter (where not polpermissive)::int as r from pg_policy where polrelid = 'public.ministry_care_consents'::regclass`))[0],
  ], [{ p: 5, r: 3 }, { p: 4, r: 3 }, { p: 2, r: 1 }]);
  for (const fn of ["ministry_care_case_guard", "ministry_care_beneficiary_guard", "ministry_care_consent_guard", "ministry_care_consent_applied"])
    check(`${fn}() is not callable by anon / authenticated / PUBLIC`, (await rows(db, `select (has_function_privilege('anon','public.${fn}()','execute') or has_function_privilege('authenticated','public.${fn}()','execute') or has_function_privilege('public','public.${fn}()','execute')) as b`))[0].b === false);
  eq("NO money-like column exists in any care table", (await rows(db, `select count(*)::int as n from information_schema.columns where table_schema='public' and table_name like 'ministry\\_care%' and column_name ~* '(amount|price|target|currency|money|fee|commission|payment|payout|refund|receipt|balance|contribution|ledger)'`))[0].n, 0);
  eq("exactly three care tables exist", (await rows(db, `select count(*)::int as n from pg_class where relnamespace='public'::regnamespace and relkind='r' and relname like 'ministry\\_care%'`))[0].n, 3);
  const sel = await Cs(db, u.owner1).select("created_by");
  check("even the owner cannot read created_by through the API", code(sel) === "42501", JSON.stringify(sel.error));
  await db.close();
}

section = "B. staff access: ";
{
  const db = await fresh();
  const own = await Cs(db, u.owner1).insert(kase({ id: K(901) }));
  check("the owner can create a draft case", !own.error, JSON.stringify(own.error));
  const mg = await Cs(db, mgr).insert(kase({ id: K(902) }));
  check("a member holding church.care.manage can create a draft", !mg.error, JSON.stringify(mg.error));
  const pb = await Cs(db, pub).insert(kase({ id: K(903) }));
  check("a member holding church.care.publish can create a draft", !pb.error, JSON.stringify(pb.error));
  const vw = await Cs(db, viewer).insert(kase());
  check("a viewer cannot create (RLS)", !!vw.error && code(vw) === "42501", JSON.stringify(vw.error));
  const np = await Cs(db, other).insert(kase());
  check("a member with only OTHER church permissions cannot create", !!np.error);
  check("a stranger cannot create", !!(await Cs(db, u.stranger).insert(kase())).error);
  check("anon cannot create", !!(await Cs(db, null).insert(kase())).error);
  check("a platform admin who is not the owner cannot create, even holding every care role", !!(await Cs(db, adminPub).insert(kase())).error);
  check("another church's owner cannot create in this church", !!(await Cs(db, u.owner2).insert(kase({ profile_id: prof.c1 }))).error);
  check("a manager cannot create a PUBLISHED case", !!(await Cs(db, mgr).insert(kase({ status: "published" }))).error);
  eq("the viewer sees all three drafts", ((await Cs(db, viewer).select("id")).data || []).map((x) => x.id).sort(), [K(901), K(902), K(903)].sort());
  eq("the member without a care permission sees none", ((await Cs(db, other).select("id")).data || []).length, 0);
  eq("a stranger sees none (drafts are private)", ((await Cs(db, u.stranger).select("id")).data || []).length, 0);
  eq("anon sees none", ((await Cs(db, null).select("id")).data || []).length, 0);
  eq("a platform admin who is not the owner sees none", ((await Cs(db, adminPub).select("id")).data || []).length, 0);
  eq("the viewer cannot edit", ((await Cs(db, viewer).update({ title_en: "x" }).eq("id", K(901)).select("id")).data || []).length, 0);
  eq("the manager can edit a draft", ((await Cs(db, mgr).update({ title_en: "Edited" }).eq("id", K(901)).select("id")).data || []).length, 1);
  eq("a non-owner platform admin edits nothing", ((await Cs(db, adminPub).update({ title_en: "x" }).eq("id", K(901)).select("id")).data || []).length, 0);
  eq("the viewer deletes nothing", ((await Cs(db, viewer).delete().eq("id", K(902)).select("id")).data || []).length, 0);
  eq("the manager can delete a draft", ((await Cs(db, mgr).delete().eq("id", K(902)).select("id")).data || []).length, 1);
  check("profile_id cannot be moved through the API", !!(await Cs(db, u.owner1).update({ profile_id: prof.c3 }).eq("id", K(901))).error);
  check("created_by cannot be supplied", !!(await Cs(db, u.owner1).insert(kase({ created_by: u.stranger }))).error);
  check("consent_state cannot be supplied", !!(await Cs(db, u.owner1).insert(kase({ consent_state: "granted" }))).error);
  eq("the audit columns came from the caller", (await rows(db, `select created_by, updated_by from public.ministry_care_cases where id = '${K(903)}'`))[0], { created_by: pub, updated_by: pub });
  eq("a new case starts with no consent and as a draft", (await rows(db, `select status, consent_state from public.ministry_care_cases where id = '${K(903)}'`))[0], { status: "draft", consent_state: "none" });
  const nc = await Cs(db, u.ownerNC).insert(kase({ profile_id: prof.nc }));
  check("a profile that is not a church cannot hold cases", !!nc.error, JSON.stringify(nc.error));
  await db.close();
}

section = "C. consent controls publication: ";
{
  const db = await fresh();
  const id1 = K(911);
  await Cs(db, u.owner1).insert(kase({ id: id1 }));
  const early = await Cs(db, u.owner1).update({ status: "published" }).eq("id", id1);
  check("publishing with NO consent is refused (care_consent_required)", !!early.error && /care_consent_required/.test(early.error.message || ""), JSON.stringify(early.error));
  const earlySvc = await F.svcErr(db, `update public.ministry_care_cases set status = 'published' where id = '${id1}'`);
  check("...even for the service role", !!earlySvc && /care_consent_required/.test(earlySvc.msg), JSON.stringify(earlySvc));
  const forged = await F.svcErr(db, `update public.ministry_care_cases set consent_state = 'granted', status = 'published' where id = '${id1}'`);
  check("a forged consent_state is recomputed from the record, so the publish is still refused", !!forged && /care_consent_required/.test(forged.msg), JSON.stringify(forged));
  const direct = await F.svcErr(db, `insert into public.ministry_care_cases (id, profile_id, status, title_en, summary_en) values ('${K(912)}','${prof.c1}','published','T','S')`);
  check("a case cannot even be INSERTED as published", !!direct && /care_consent_required/.test(direct.msg), JSON.stringify(direct));

  const viewerConsent = await Cn(db, viewer).insert(consent(id1));
  check("a viewer cannot record consent", !!viewerConsent.error && code(viewerConsent) === "42501", JSON.stringify(viewerConsent.error));
  check("anon cannot record consent", !!(await Cn(db, null).insert(consent(id1))).error);
  check("a non-owner platform admin cannot record consent", !!(await Cn(db, adminPub).insert(consent(id1))).error);
  const gi = await Cn(db, mgr).insert(consent(id1, "granted", { given_by: "guardian", method: "verbal_witnessed" }));
  check("a manager can record a granted consent", !gi.error, JSON.stringify(gi.error));
  eq("the case now shows consent granted (derived, still a draft)", (await rows(db, `select status, consent_state from public.ministry_care_cases where id = '${id1}'`))[0], { status: "draft", consent_state: "granted" });
  eq("the recorder came from the caller", (await rows(db, `select recorded_by from public.ministry_care_consents where case_id = '${id1}'`))[0].recorded_by, mgr);
  check("recorded_by cannot be supplied by a client", !!(await Cn(db, mgr).insert(consent(id1, "withdrawn", { recorded_by: u.stranger }))).error);
  check("invalid kind / given_by / method are refused", !!(await Cn(db, mgr).insert(consent(id1, "maybe"))).error && !!(await Cn(db, mgr).insert(consent(id1, "granted", { given_by: "pastor" }))).error && !!(await Cn(db, mgr).insert(consent(id1, "granted", { method: "text" }))).error);
  check("consent for a case of ANOTHER church is refused (composite key)", !!(await Cn(db, u.owner2).insert({ id: CN(990), profile_id: prof.c2, case_id: id1, kind: "granted", given_by: "beneficiary", method: "written" })).error);

  const mgrPublish = await Cs(db, mgr).update({ status: "published" }).eq("id", id1);
  eq("a manager still cannot publish (RLS) even with consent", (mgrPublish.data || []).length === 0 && (await rows(db, `select status from public.ministry_care_cases where id = '${id1}'`))[0].status, "draft");
  const ok = await Cs(db, pub).update({ status: "published" }).eq("id", id1).select("id,status");
  eq("the publisher can publish once consent is granted", (ok.data || []).map((x) => x.status), ["published"]);
  eq("published_at / published_by were set by the guard", (await rows(db, `select (published_at is not null) as a, published_by from public.ministry_care_cases where id = '${id1}'`))[0], { a: true, published_by: pub });

  const anon = await Cs(db, null).select("id,title_en,summary_en,category");
  eq("anon now sees the published, consented case", (anon.data || []).map((x) => x.id), [id1]);

  const wd = await Cn(db, mgr).insert(consent(id1, "withdrawn", { given_by: "beneficiary", method: "written" }));
  check("a MANAGER (not only a publisher) can withdraw consent", !wd.error, JSON.stringify(wd.error));
  eq("withdrawal unpublished the case in the same statement", (await rows(db, `select status, consent_state, published_at, published_by from public.ministry_care_cases where id = '${id1}'`))[0], { status: "draft", consent_state: "withdrawn", published_at: null, published_by: null });
  eq("anon no longer sees it", ((await Cs(db, null).select("id")).data || []).length, 0);
  eq("a signed-in stranger no longer sees it", ((await Cs(db, u.stranger).select("id")).data || []).length, 0);
  const again = await Cs(db, pub).update({ status: "published" }).eq("id", id1);
  check("it cannot be published again while consent is withdrawn", !!again.error && /care_consent_required/.test(again.error.message || ""), JSON.stringify(again.error));
  await Cn(db, mgr).insert(consent(id1, "granted"));
  eq("a NEW granted record re-enables publishing", ((await Cs(db, pub).update({ status: "published" }).eq("id", id1).select("id")).data || []).length, 1);
  eq("the history keeps every decision, in order", (await rows(db, `select kind from public.ministry_care_consents where case_id = '${id1}' order by seq`)).map((x) => x.kind), ["granted", "withdrawn", "granted"]);

  // withdrawal of a published case whose row was edited at the same moment still wins; and an edit to a live case keeps it live while consent holds
  eq("editing a live case keeps it live while consent holds", ((await Cs(db, pub).update({ summary_en: "Updated text" }).eq("id", id1).select("status")).data || [])[0]?.status, "published");
  await F.svc(db, `insert into public.ministry_care_consents (profile_id, case_id, kind, given_by, method) values ('${prof.c1}','${id1}','withdrawn','guardian','written')`);
  eq("a withdrawal written by the service role also unpublishes", (await rows(db, `select status from public.ministry_care_cases where id = '${id1}'`))[0].status, "draft");

  // immutability
  const upd = await F.svcErr(db, `update public.ministry_care_consents set kind = 'granted' where case_id = '${id1}'`);
  check("a consent record cannot be edited, even by the service role", !!upd && /care_consent_immutable/.test(upd.msg), JSON.stringify(upd));
  check("an API role cannot update a consent record (no privilege)", !!(await Cn(db, mgr).update({ kind: "granted" }).eq("case_id", id1)).error);
  check("an API role cannot delete a consent record (no privilege)", !!(await Cn(db, mgr).delete().eq("case_id", id1)).error);
  check("the viewer can READ the consent record", ((await Cn(db, viewer).select("id,kind")).data || []).length === 4);
  eq("a stranger reads no consent record", ((await Cn(db, u.stranger).select("id")).data || []).length, 0);
  eq("anon is refused the consent table", code(await Cn(db, null).select("id")), "42501");
  await db.close();
}

section = "D. public read is minimal: ";
{
  const db = await fresh();
  await F.svc(db, `
    insert into public.ministry_care_cases (id, profile_id, title_en, summary_en) values ('${K(921)}','${prof.c1}','Draft one','S'), ('${K(922)}','${prof.c1}','Live one','S'), ('${K(923)}','${prof.c3}','Unpublished church','S');
    insert into public.ministry_care_consents (profile_id, case_id, kind, given_by, method) values ('${prof.c1}','${K(922)}','granted','beneficiary','written'), ('${prof.c3}','${K(923)}','granted','beneficiary','written');
    update public.ministry_care_cases set status = 'published' where id in ('${K(922)}','${K(923)}');
    update public.profiles set published = false where id = '${prof.c3}';`);
  eq("anon sees only the consented, published case of a published church", ((await Cs(db, null).select("id")).data || []).map((x) => x.id), [K(922)]);
  const star = await Cs(db, null).select("*");
  check("select * for anon is refused (the audit columns and consent_state have no grant)", code(star) === "42501", JSON.stringify(star.error));
  check("anon cannot read consent_state", code(await Cs(db, null).select("consent_state")) === "42501");
  check("anon cannot read the beneficiary or consent tables at all", code(await Bn(db, null).select("member_id")) === "42501" && code(await Cn(db, null).select("kind")) === "42501");
  eq("the public columns are exactly the content columns", (await Cs(db, null).select("id,profile_id,status,category,title_en,title_fr,summary_en,summary_fr,published_at,created_at,updated_at")).error, null);
  await db.close();
}

section = "E. the private beneficiary link: ";
{
  const db = await fresh();
  await Cs(db, u.owner1).insert(kase({ id: K(931) }));
  await Cs(db, u.owner1).insert(kase({ id: K(932) }));
  const add = await Bn(db, mgr).insert({ case_id: K(931), profile_id: prof.c1, member_id: m.other });
  check("a manager can link an adult of the roster", !add.error, JSON.stringify(add.error));
  const child = await Bn(db, mgr).insert({ case_id: K(932), profile_id: prof.c1, member_id: m.kid1 });
  check("a CHILD can never be linked (care_child_not_allowed)", !!child.error && /care_child_not_allowed/.test(child.error.message || ""), JSON.stringify(child.error));
  const childSvc = await F.svcErr(db, `insert into public.ministry_care_beneficiaries (case_id, profile_id, member_id) values ('${K(932)}','${prof.c1}','${m.kid2}')`);
  check("...not even by the service role", !!childSvc && /care_child_not_allowed/.test(childSvc.msg), JSON.stringify(childSvc));
  const foreign = await Bn(db, mgr).insert({ case_id: K(932), profile_id: prof.c1, member_id: m.c2a });
  check("a person of ANOTHER church cannot be linked", !!foreign.error, JSON.stringify(foreign.error));
  check("a second link for the same case is refused (one person per case)", !!(await Bn(db, mgr).insert({ case_id: K(931), profile_id: prof.c1, member_id: m.admin })).error);
  eq("the manager can change who it is", ((await Bn(db, mgr).update({ member_id: m.admin }).eq("case_id", K(931)).select("member_id")).data || []).map((x) => x.member_id), [m.admin]);
  const moveChild = await Bn(db, mgr).update({ member_id: m.kid1 }).eq("case_id", K(931));
  check("...but not to a child", !!moveChild.error);
  check("the case and church of a link cannot change", !!(await F.svcErr(db, `update public.ministry_care_beneficiaries set case_id = '${K(932)}' where case_id = '${K(931)}'`)));
  eq("the viewer can read the link", ((await Bn(db, viewer).select("case_id,member_id")).data || []).length, 1);
  check("the viewer cannot create or change a link", !!(await Bn(db, viewer).insert({ case_id: K(932), profile_id: prof.c1, member_id: m.other })).error);
  eq("the member without care permissions reads nothing", ((await Bn(db, other).select("case_id")).data || []).length, 0);
  eq("a stranger reads nothing", ((await Bn(db, u.stranger).select("case_id")).data || []).length, 0);
  eq("a non-owner platform admin reads nothing", ((await Bn(db, adminPub).select("case_id")).data || []).length, 0);
  check("anon is refused", code(await Bn(db, null).select("case_id")) === "42501");
  // publish the case: the published row exposes nothing about the person
  await Cn(db, mgr).insert(consent(K(931)));
  await Cs(db, pub).update({ status: "published" }).eq("id", K(931));
  const pubRow = await Cs(db, null).select("id,profile_id,status,category,title_en,title_fr,summary_en,summary_fr,published_at,created_at,updated_at").eq("id", K(931));
  check("the public row of a linked case holds no member id and no name", JSON.stringify(pubRow.data).indexOf(m.admin) === -1 && JSON.stringify(pubRow.data).indexOf("Grace") === -1);
  eq("a signed-in stranger cannot reach the link of a published case either", ((await Bn(db, u.stranger).select("member_id")).data || []).length, 0);
  // erasing the person erases the link, not the case
  await F.svc(db, `delete from public.church_members where id = '${m.admin}'`);
  eq("erasing the person removes the link", (await rows(db, `select count(*)::int as n from public.ministry_care_beneficiaries where case_id = '${K(931)}'`))[0].n, 0);
  eq("...and keeps the case", (await rows(db, `select count(*)::int as n from public.ministry_care_cases where id = '${K(931)}'`))[0].n, 1);
  await db.close();
}

section = "F. data rules, cascade and isolation: ";
{
  const db = await fresh();
  const bad = async (name, o) => { const x = await Cs(db, u.owner1).insert(kase(o)); check(name, !!x.error && ["23514", "23505"].includes(code(x)), JSON.stringify(x.error)); };
  await bad("an unknown category is refused", { category: "lottery" });
  await bad("a title over 120 characters is refused", { title_en: "x".repeat(121) });
  await bad("an empty title is refused", { title_en: "" });
  await bad("a summary over 2000 characters is refused", { summary_en: "x".repeat(2001) });
  const id1 = K(941), id2 = K(942);
  await Cs(db, u.owner1).insert(kase({ id: id1, profile_id: prof.c1 }));
  await Cs(db, u.owner2).insert(kase({ id: id2, profile_id: prof.c2 }));
  eq("each owner sees only their own church's cases", [((await Cs(db, u.owner1).select("id")).data || []).map((x) => x.id), ((await Cs(db, u.owner2).select("id")).data || []).map((x) => x.id)], [[id1], [id2]]);
  eq("owner 2 cannot edit church 1's case", ((await Cs(db, u.owner2).update({ title_en: "x" }).eq("id", id1).select("id")).data || []).length, 0);
  const move = await F.svcErr(db, `update public.ministry_care_cases set profile_id = '${prof.c3}' where id = '${id1}'`);
  check("a case cannot be moved to another church, even by the service role", !!move && /care_tenant_immutable/.test(move.msg), JSON.stringify(move));
  // a published-without-content case is refused by the content check
  await F.svc(db, `insert into public.ministry_care_consents (profile_id, case_id, kind, given_by, method) values ('${prof.c1}','${id1}','granted','beneficiary','written')`);
  await F.svc(db, `update public.ministry_care_cases set title_en = null, summary_en = null where id = '${id1}'`);
  const empty = await F.svcErr(db, `update public.ministry_care_cases set status = 'published' where id = '${id1}'`);
  check("a case with no readable text cannot be published", !!empty && /ministry_care_cases_publish_content_check/.test(empty.msg), JSON.stringify(empty));
  // deleting a case removes its consent record and link; deleting a profile removes everything
  await F.svc(db, `update public.ministry_care_cases set title_en = 'T', summary_en = 'S' where id = '${id1}'`);
  await F.svc(db, `insert into public.ministry_care_beneficiaries (case_id, profile_id, member_id) values ('${id1}','${prof.c1}','${m.other}')`);
  await F.svc(db, `delete from public.ministry_care_cases where id = '${id1}'`);
  eq("deleting a case removes its consent records and its link", [(await rows(db, `select count(*)::int as n from public.ministry_care_consents where case_id = '${id1}'`))[0].n, (await rows(db, `select count(*)::int as n from public.ministry_care_beneficiaries where case_id = '${id1}'`))[0].n], [0, 0]);
  await F.svc(db, `delete from public.profiles where id = '${prof.c2}'`);
  eq("deleting a church removes its cases", (await rows(db, `select count(*)::int as n from public.ministry_care_cases where profile_id = '${prof.c2}'`))[0].n, 0);
  eq("no care table is touched by anything but care permissions: an events publisher reads no case", ((await Cs(db, other).select("id")).data || []).length, 0);
  await db.close();
}

section = "G. support scripts and re-runs: ";
{
  const pre = await fresh({ withCare: false, extras: false });
  const p1 = (await pre.query(PRE)).rows;
  check("preflight: eleven rows, all ok before the migration", p1.length === 11 && p1.every((x) => x.ok === true), JSON.stringify(p1.filter((x) => x.ok !== true)));
  await pre.exec(MIG);
  check("preflight after applying: the 'does not exist yet' rows fail (it is a BEFORE check)", (await pre.query(PRE)).rows.filter((x) => x.ok !== true).length >= 2);
  const v = (await pre.query(VER)).rows;
  check("verify: sixteen rows, all ok", v.length === 16 && v.every((x) => x.ok === true), JSON.stringify(v.filter((x) => x.ok !== true)));
  await F.svc(pre, `insert into public.ministry_care_cases (id, profile_id, title_en, summary_en) values ('${K(951)}','${prof.c1}','A','B')`);
  await pre.exec(MIG);
  eq("re-running the migration keeps the data", (await rows(pre, "select count(*)::int as n from public.ministry_care_cases"))[0].n, 1);
  check("verify still passes after a re-run", (await pre.query(VER)).rows.every((x) => x.ok === true));
  let err = null; try { await pre.exec(ROLL); } catch (e) { err = String(e.message); await pre.exec("rollback").catch(() => {}); }
  check("rollback refuses while a row exists", !!err && /rollback refused/.test(err), err);
  eq("...and nothing was dropped", (await rows(pre, "select count(*)::int as n from public.ministry_care_cases"))[0].n, 1);
  await pre.exec(ROLL.replace("begin;", "begin;\nselect set_config('ministry_care.allow_data_loss', 'yes', true);"));
  check("rollback with explicit confirmation drops the tables and the functions", (await rows(pre, "select (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relname like 'ministry\\_care%') = 0 and (select count(*) from pg_proc where proname like 'ministry\\_care%') = 0 as a"))[0].a === true);
  await pre.exec(ROLL);
  check("rollback is safe to run again", true);
  await pre.exec(MIG);
  check("the migration can be applied again after a rollback", (await rows(pre, "select to_regclass('public.ministry_care_cases') is not null as a"))[0].a === true);
  await pre.close();

  const a = await fresh({ withCare: false, extras: false }); const b = await fresh({ extras: false });
  const fp = async (d) => JSON.stringify(await rows(d, `select (select jsonb_agg(proname || ':' || md5(pg_get_functiondef(oid)) order by proname) from pg_proc where pronamespace = 'public'::regnamespace and (proname like 'church\\_%' or proname like 'team\\_church\\_%' or proname like 'bible\\_%' or proname like 'daily\\_word%' or (proname like 'ministry\\_%' and proname not like 'ministry\\_care\\_%') or proname in ('is_admin','has_org_permission','is_org_member'))) as f, (select jsonb_agg(polrelid::regclass::text || ':' || polname order by polrelid::regclass::text, polname) from pg_policy where polrelid::regclass::text not like 'ministry\\_care%') as p`));
  check("applying the migration changes no existing function and no other table's policy", (await fp(a)) === (await fp(b)));
  await a.close(); await b.close();

  const foreign = await fresh({ withCare: false, extras: false });
  await foreign.exec(`create table public.ministry_care_cases (id uuid primary key)`);
  let e4 = null; try { await foreign.exec(MIG); } catch (e) { e4 = String(e.message); await foreign.exec("rollback").catch(() => {}); }
  check("the migration refuses to adopt a same-named table it does not manage", !!e4 && /precondition failed/.test(e4), e4);
  await foreign.close();
}

section = "H. the migration text itself: ";
{
  const c = MIG.replace(/--[^\n]*/g, "");
  const created = [...c.matchAll(/create (?:or replace )?(?:unique )?(table|function|trigger|index|policy)\s+(?:if not exists\s+)?(?:public\.)?([a-z_]+)/gi)].map((mm) => mm[2]);
  check("it creates only ministry_care* objects", created.length > 0 && created.every((x) => /^ministry_care/.test(x)), created.filter((x) => !/^ministry_care/.test(x)).join());
  check("it never alters or drops an existing object", !/alter table public\.(?!ministry_care)|drop (table|function|index) /i.test(c));
  check("it writes no row anywhere", !/(^|;)\s*(insert\s+into|update\s+public\.|delete\s+from)/im.test(c.replace(/update public\.ministry_care_cases set updated_at/g, "")));
  check("no audit column has a grant", !/grant [^;]*(created_by|updated_by|published_by|recorded_by)/i.test(c));
  const noGuard = c.split("\n").filter((l) => !l.includes("column_name ~*")).join("\n"); // the postcondition that FORBIDS money-like columns names them
  check("no money, payment or ledger object or column is defined", !/(amount|price|target_|currency|contribution|payment|payout|refund|ledger|fapshi|receipt)/i.test(noGuard), (noGuard.match(/(amount|price|target_|currency|contribution|payment|payout|refund|ledger|fapshi|receipt)/i) || [""])[0]);
  check("the three permissions are named exactly", /church\.care\.view/.test(MIG) && /church\.care\.manage/.test(MIG) && /church\.care\.publish/.test(MIG));
  check("it is wrapped in one transaction", /^begin;/m.test(MIG) && /^commit;/m.test(MIG));
}

console.log(`\n${fail === 0 ? "OK" : "FAILED"}: ${pass} checks passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
