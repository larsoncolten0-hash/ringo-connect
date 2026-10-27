// Churches & Ministries Phase 2: the 2027-01-04_church_landing_images migration (pictures on events / announcements / care cases, and the week function for the testimonies landing page), attacked OFFLINE
// (PGlite, synthetic data, no Supabase, no network).
//   * the preflight is all-true before, the verify all-true after, the migration is re-runnable, and the rollback refuses while pictures exist;
//   * the public can read a picture only through a published event / announcement / (consented) care case, can never read the care confirmation and can write nothing;
//   * the shape of a picture address is enforced by the database, and a care picture cannot exist without the recorded confirmation;
//   * removing the picture clears the confirmation, and withdrawing the case's consent clears the picture at once;
//   * the week function applies the SAME conditions as the existing public function, from a chosen moment on, and no more than 100.
//   Run:  node scripts/tests/churchLandingDb.test.mjs
import fs from "fs";
import path from "path";
import * as F from "./churchFixtures.mjs";

const { PGlite } = await import(process.env.PGLITE_ENTRY || "@electric-sql/pglite");
const { u, prof, REPO } = F;
let pass = 0, fail = 0, section = "";
const check = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log("  FAIL:", `${section}${name}`, "|", String(detail).slice(0, 400)); } };
const eq = (name, a, b) => check(name, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8").replace(/\r\n/g, "\n");
const MIG = F.LI_MIG;
const SUP = "supabase/support/2027-01-04_church_landing_images";
const PRE = read(`${SUP}.preflight.sql`), VER = read(`${SUP}.verify.sql`), ROLL = read(`${SUP}.rollback.sql`);

const rows = (db, sql) => F.svcQuery(db, sql);
const S = (db, who) => F.sessionFor(db, who);
const code = (x) => x && x.error && x.error.code;
const uid = (kind, n) => F.id(kind, 5000 + n);
const IMG = "https://example.supabase.co/storage/v1/object/public/uploads/u1/events/a1b2c3.jpg";
const IMG2 = "https://example.supabase.co/storage/v1/object/public/uploads/u1/care/d4e5f6.jpg";
/** Runs a script that may refuse (it raises inside its own BEGIN): returns null on success or the message, and rolls the aborted transaction back so the connection can be used again. */
const attempt = async (db, sql) => { try { await db.exec(sql); return null; } catch (e) { try { await db.exec("rollback"); } catch { /* nothing to roll back */ } return String(e.message); } };
const allOk = (r) => r.length > 0 && r.every((x) => x.ok === true);

async function fresh({ landing = true } = {}) {
  const db = await F.newDb(PGlite, { dailyWords: true, events: true, attendance: true, bible: true, music: true, care: true, testimonies: true, landing });
  await F.seed(db);
  return db;
}
let n = 0;
async function event(db, o = {}) {
  const id = o.id || uid("1", ++n);
  await F.svc(db, `insert into public.ministry_events (id, profile_id, status, event_date, title_en) values ('${id}','${prof.c1}','${o.status || "published"}','2030-01-10','Service ${n}')`);
  return id;
}
async function announcement(db, o = {}) {
  const id = o.id || uid("2", ++n);
  await F.svc(db, `insert into public.ministry_announcements (id, profile_id, status, title_en, body_en) values ('${id}','${prof.c1}','${o.status || "published"}','Notice ${n}','Body')`);
  return id;
}
async function careCase(db, { published = true, consent = true } = {}) {
  const id = uid("3", ++n);
  await F.svc(db, `insert into public.ministry_care_cases (id, profile_id, title_en, summary_en) values ('${id}','${prof.c1}','Help ${n}','A family needs help.')`);
  if (consent) await F.svc(db, `insert into public.ministry_care_consents (profile_id, case_id, kind, given_by, method) values ('${prof.c1}','${id}','granted','beneficiary','written')`);
  if (published) await F.svc(db, `update public.ministry_care_cases set status = 'published' where id = '${id}'`);
  return id;
}
/** The guard keeps published_at at the real publish moment, so a time-travel fixture switches the user triggers off for one statement, as the database owner (never possible for an API role). */
async function backdate(db, id, at) {
  await db.exec("alter table public.ministry_testimonies disable trigger user");
  try { await db.exec(`update public.ministry_testimonies set published_at = '${at}' where id = '${id}'`); } finally { await db.exec("alter table public.ministry_testimonies enable trigger user"); }
}
async function testimony(db, o = {}) {
  const id = uid("4", ++n);
  const v = { review: "approved", pub: "published", consent: true, name: false, ...o };
  await F.svc(db, `insert into public.ministry_testimonies (id, profile_id, submission_key, full_name, phone, body, lang, publish_consent, name_consent) values ('${id}','${prof.c1}','${uid("5", n)}','Marie Ngono','237670000111','God healed me from a long illness and I thank Him. (${n})','en',${v.consent},${v.name})`);
  if (v.review === "approved") await F.svc(db, `update public.ministry_testimonies set review_status = 'approved' where id = '${id}'`);
  if (v.pub === "published") await F.svc(db, `update public.ministry_testimonies set publication_status = 'published' where id = '${id}'`);
  if (v.at) await backdate(db, id, v.at);
  return id;
}

// ---------------------------------------------------------------- A. preflight, apply, verify, re-run
section = "A. preflight, apply, verify, re-run: ";
{
  const before = await fresh({ landing: false });
  const pre = await rows(before, PRE);
  check("the preflight is all true BEFORE the migration (clean first run)", allOk(pre), JSON.stringify(pre.filter((x) => !x.ok)));
  check("the preflight is READ-ONLY (a single select)", /^with\b/m.test(PRE.replace(/^--.*$/gm, "").trim()) && !/^\s*(insert|update|delete|drop|alter|create|grant|revoke|truncate)\b/im.test(PRE.replace(/^--.*$/gm, "")));
  await before.exec(MIG);
  const after = await rows(before, VER);
  check("the verify is all true AFTER the migration", allOk(after), JSON.stringify(after.filter((x) => !x.ok)));
  check("the verify is READ-ONLY (a single select)", /^with\b/m.test(VER.replace(/^--.*$/gm, "").trim()) && !/^\s*(insert|update|delete|drop|alter|create|grant|revoke|truncate)\b/im.test(VER.replace(/^--.*$/gm, "")) && (VER.replace(/^--.*$/gm, "").match(/;/g) || []).length === 1);
  const reRun = await attempt(before, MIG);
  check("the migration is re-runnable (a second run changes nothing and does not fail)", reRun === null, reRun);
  check("the verify is still all true after the re-run", allOk(await rows(before, VER)));
  const preAfter = await rows(before, PRE);
  check("the preflight now reports the objects as present (so it is a real before/after check)", preAfter.some((x) => !x.ok));
  const broken = await fresh({ landing: false });
  await broken.exec("alter table public.ministry_events rename to ministry_events_gone");
  check("the migration refuses when an earlier table is missing (precondition)", (await attempt(broken, MIG)) !== null);
}

// ---------------------------------------------------------------- B. what the public can and cannot do
section = "B. public access: ";
{
  const db = await fresh();
  const pubEv = await event(db), draftEv = await event(db, { status: "draft" });
  const pubAn = await announcement(db), draftAn = await announcement(db, { status: "draft" });
  await F.svc(db, `update public.ministry_events set image_url = '${IMG}' where id in ('${pubEv}','${draftEv}')`);
  await F.svc(db, `update public.ministry_announcements set image_url = '${IMG}' where id in ('${pubAn}','${draftAn}')`);
  const anon = S(db, null);
  const ev = await anon.from("ministry_events").select("id, image_url");
  eq("anon reads the picture of a PUBLISHED event and no draft", (ev.data || []).map((r) => [r.id, r.image_url]), [[pubEv, IMG]]);
  const an = await anon.from("ministry_announcements").select("id, image_url");
  eq("anon reads the picture of a PUBLISHED announcement and no draft", (an.data || []).map((r) => [r.id, r.image_url]), [[pubAn, IMG]]);
  const cc = await careCase(db), draftCase = await careCase(db, { published: false, consent: false });
  await F.svc(db, `update public.ministry_care_cases set image_url = '${IMG2}', image_consent = true where id = '${cc}'`);
  const care = await anon.from("ministry_care_cases").select("id, image_url");
  eq("anon reads the picture of a published, consented care case and of no draft", (care.data || []).map((r) => [r.id, r.image_url]), [[cc, IMG2]]);
  const consentRead = await anon.from("ministry_care_cases").select("image_consent");
  check("anon CANNOT read the care picture confirmation", !!consentRead.error && consentRead.error.code === "42501", JSON.stringify(consentRead));
  for (const [t, row] of [["ministry_events", pubEv], ["ministry_announcements", pubAn], ["ministry_care_cases", cc]]) {
    const w = await anon.from(t).update({ image_url: "https://evil.example.com/x.png" }).eq("id", row);
    check(`anon cannot change a picture on ${t}`, !!w.error || (await rows(db, `select image_url from public.${t} where id = '${row}'`))[0].image_url !== "https://evil.example.com/x.png");
  }
  const own = await S(db, u.owner1).from("ministry_care_cases").select("image_url, image_consent").eq("id", cc);
  eq("the church's own staff read the picture AND the confirmation", own.data && own.data[0], { image_url: IMG2, image_consent: true });
  const unpub = await S(db, u.owner1).from("ministry_care_cases").update({ status: "draft" }).eq("id", cc);
  check("(setup) a care case can be unpublished again", !unpub.error, JSON.stringify(unpub.error));
  eq("an UNPUBLISHED care case shows its picture to nobody public", ((await anon.from("ministry_care_cases").select("id, image_url")).data || []).length, 0);
  void draftCase;
}

// ---------------------------------------------------------------- C. the shape of a picture address
section = "C. address shape: ";
{
  const db = await fresh();
  const ev = await event(db), an = await announcement(db);
  const owner = S(db, u.owner1);
  const good = await owner.from("ministry_events").update({ image_url: IMG }).eq("id", ev);
  check("the church can set a picture on its event", !good.error, JSON.stringify(good.error));
  const goodA = await owner.from("ministry_announcements").update({ image_url: IMG }).eq("id", an);
  check("the church can set a picture on its announcement", !goodA.error, JSON.stringify(goodA.error));
  for (const [label, bad] of [["http, not https", "http://example.com/a.jpg"], ["javascript:", "javascript:alert(1)"], ["a data: address", "data:image/png;base64,AAAA"], ["spaces", "https://example.com/a b.jpg"], ["no dot in the host", "https://localhost/a.jpg"], ["credentials", "https://user:pw@example.com/a.jpg"], ["too short", "https://a.b"], ["over 500 characters", "https://example.com/" + "a".repeat(500)], ["an empty string", ""]]) {
    const r = await owner.from("ministry_events").update({ image_url: bad }).eq("id", ev);
    check(`the database refuses ${label}`, code(r) === "23514" || (bad === "" && code(r) === "23514"), JSON.stringify(r.error));
    const r2 = await owner.from("ministry_announcements").update({ image_url: bad }).eq("id", an);
    check(`...on announcements too (${label})`, code(r2) === "23514", JSON.stringify(r2.error));
  }
  const clear = await owner.from("ministry_events").update({ image_url: null }).eq("id", ev);
  check("a picture can be removed (null)", !clear.error);
}

// ---------------------------------------------------------------- D. care pictures and consent
section = "D. care picture and consent: ";
{
  const db = await fresh();
  const owner = S(db, u.owner1);
  const c = await careCase(db);
  const noConsent = await owner.from("ministry_care_cases").update({ image_url: IMG2 }).eq("id", c);
  check("a care picture WITHOUT the recorded confirmation is refused by the database", code(noConsent) === "23514", JSON.stringify(noConsent.error));
  const ok = await owner.from("ministry_care_cases").update({ image_url: IMG2, image_consent: true }).eq("id", c);
  check("with the confirmation it is accepted", !ok.error, JSON.stringify(ok.error));
  const bareConfirm = await owner.from("ministry_care_cases").update({ image_consent: true }).eq("id", c);
  check("(the confirmation alone, without a picture, is harmless)", !bareConfirm.error);
  const rm = await owner.from("ministry_care_cases").update({ image_url: null }).eq("id", c);
  const afterRm = (await rows(db, `select image_url, image_consent from public.ministry_care_cases where id = '${c}'`))[0];
  check("removing the picture clears the confirmation (a new picture needs it again)", !rm.error && afterRm.image_url === null && afterRm.image_consent === false, JSON.stringify(afterRm));
  const again = await owner.from("ministry_care_cases").update({ image_url: IMG2 }).eq("id", c);
  check("so a new picture without confirming again is refused", code(again) === "23514");
  // withdrawing consent clears the picture and unpublishes
  await owner.from("ministry_care_cases").update({ image_url: IMG2, image_consent: true }).eq("id", c);
  await F.svc(db, `insert into public.ministry_care_consents (profile_id, case_id, kind, given_by, method) values ('${prof.c1}','${c}','withdrawn','beneficiary','written')`);
  const w = (await rows(db, `select status, consent_state, image_url, image_consent from public.ministry_care_cases where id = '${c}'`))[0];
  eq("WITHDRAWING consent unpublishes the case AND clears the picture and its confirmation, at once", w, { status: "draft", consent_state: "withdrawn", image_url: null, image_consent: false });
  eq("so the public sees nothing of it", ((await S(db, null).from("ministry_care_cases").select("id, image_url")).data || []).length, 0);
  // granting again does not bring the picture back
  await F.svc(db, `insert into public.ministry_care_consents (profile_id, case_id, kind, given_by, method) values ('${prof.c1}','${c}','granted','beneficiary','written')`);
  eq("a new grant does not bring the old picture back", (await rows(db, `select image_url, image_consent from public.ministry_care_cases where id = '${c}'`))[0], { image_url: null, image_consent: false });
  // a stranger church's staff cannot touch another church's case
  const strangerTry = await S(db, u.owner2).from("ministry_care_cases").update({ image_url: IMG2, image_consent: true }).eq("id", c);
  check("another church's owner changes nothing (row-level security)", (await rows(db, `select image_url from public.ministry_care_cases where id = '${c}'`))[0].image_url === null && (strangerTry.error || (strangerTry.data || []).length === 0 || true));
  const direct = await F.svcErr(db, `insert into public.ministry_care_cases (id, profile_id, title_en, summary_en, image_url) values ('${uid("3", 900)}','${prof.c1}','x','y','${IMG2}')`);
  check("not even the service role can store a care picture without the confirmation", direct && direct.code === "23514", JSON.stringify(direct));
}

// ---------------------------------------------------------------- E. the week function
section = "E. testimonies for the landing page: ";
{
  const db = await fresh();
  const old = "2026-01-05T10:00:00Z", mid = "2026-01-12T10:00:00Z", recent = "2026-01-14T10:00:00Z";
  const a = await testimony(db, { at: old }), b = await testimony(db, { at: mid, name: true }), c = await testimony(db, { at: recent });
  await testimony(db, { pub: "unpublished" });
  await testimony(db, { review: "pending", pub: "unpublished" });
  await testimony(db, { consent: false, pub: "unpublished" });
  const refusedPub = await F.svcErr(db, `update public.ministry_testimonies set publication_status = 'published' where publish_consent = false`);
  check("(existing guard) a testimony without publication consent can never be published, so it can never reach the week function", refusedPub && refusedPub.code === "23514", JSON.stringify(refusedPub));
  const week = async (since, limit, who = null, profile = prof.c1) => (await S(db, who).rpc("ministry_testimonies_public_week", { p_profile_id: profile, p_since: since, p_limit: limit })).data || [];
  eq("from a moment on: only the approved, published, consented testimonies published since then, newest first", (await week("2026-01-10T00:00:00Z", 50)).map((r) => r.id), [c, b]);
  eq("from before everything: all three, newest first", (await week("2020-01-01T00:00:00Z", 50)).map((r) => r.id), [c, b, a]);
  eq("from the future: none", (await week("2099-01-01T00:00:00Z", 50)).length, 0);
  eq("the name only with name consent", (await week("2020-01-01T00:00:00Z", 50)).map((r) => r.display_name), [null, "Marie Ngono", null]);
  check("the columns are exactly id, display_name, body, lang, published_at: no phone, group, note or status", JSON.stringify(Object.keys((await week("2020-01-01T00:00:00Z", 50))[0])) === '["id","display_name","body","lang","published_at"]');
  eq("it matches what the existing function returns for the same set", (await S(db, null).rpc("ministry_testimonies_public", { p_profile_id: prof.c1 })).data.map((r) => r.id), (await week("2020-01-01T00:00:00Z", 50)).map((r) => r.id));
  eq("another church's id returns nothing of this church", (await week("2020-01-01T00:00:00Z", 50, null, prof.c3)).length, 0);
  eq("signed-in visitors read the same", (await week("2020-01-01T00:00:00Z", 50, u.stranger)).length, 3);
  for (const lim of [0, -5, null]) check(`a silly limit (${lim}) still returns at least one and at most 100`, (await week("2020-01-01T00:00:00Z", lim)).length >= 1);
  eq("limit 1 returns the newest only", (await week("2020-01-01T00:00:00Z", 1)).map((r) => r.id), [c]);
  // many: clamped at 100 (inserted as the database owner with the guard off, already approved and published)
  await db.exec("alter table public.ministry_testimonies disable trigger user");
  try {
    await db.exec(`insert into public.ministry_testimonies (id, profile_id, submission_key, full_name, phone, body, lang, publish_consent, review_status, publication_status, published_at)
                   select gen_random_uuid(), '${prof.c1}', gen_random_uuid(), 'Nadia Test', '237670000111', 'God healed me from a long illness and I thank Him. #' || g, 'en', true, 'approved', 'published', now() from generate_series(1, 130) g`);
  } finally { await db.exec("alter table public.ministry_testimonies enable trigger user"); }
  check("however many exist, never more than 100", (await week("2020-01-01T00:00:00Z", 100000)).length === 100);
  const priv = await rows(db, `select (has_function_privilege('anon','public.ministry_testimonies_public_week(uuid, timestamptz, integer)','execute') and has_function_privilege('authenticated','public.ministry_testimonies_public_week(uuid, timestamptz, integer)','execute')) as ok, has_function_privilege('public','public.ministry_testimonies_public_week(uuid, timestamptz, integer)','execute') as pub`);
  check("callable by anon and authenticated, not by PUBLIC", priv[0].ok === true && priv[0].pub === false);
  const before = await rows(db, "select count(*)::int as n from public.ministry_testimonies"); void before;
}

// ---------------------------------------------------------------- F. rollback
section = "F. rollback: ";
{
  const db = await fresh();
  const ev = await event(db);
  await F.svc(db, `update public.ministry_events set image_url = '${IMG}' where id = '${ev}'`);
  const refused = await attempt(db, ROLL);
  check("the rollback REFUSES while a picture address is stored", refused && /rollback refused/.test(refused), refused);
  check("...and the picture is still there", (await rows(db, `select image_url from public.ministry_events where id = '${ev}'`))[0].image_url === IMG);
  await F.svc(db, `update public.ministry_events set image_url = null`);
  const done = await attempt(db, ROLL);
  check("with no picture stored the rollback runs", done === null, done);
  const gone = await rows(db, `select count(*)::int as n from information_schema.columns where table_schema = 'public' and column_name in ('image_url','image_consent') and table_name in ('ministry_events','ministry_announcements','ministry_care_cases')`);
  eq("the columns are gone", gone[0].n, 0);
  check("the existing public testimonies function is untouched by the rollback", (await S(db, null).rpc("ministry_testimonies_public", { p_profile_id: prof.c1 })).error === null);
  check("the events table still works for the public", !(await S(db, null).from("ministry_events").select("id, title_en")).error);
  const again = await attempt(db, ROLL);
  check("the rollback is re-runnable", again === null, again);
  await db.exec(MIG);
  check("and the migration can be applied again after a rollback", allOk(await rows(db, VER)));
  const forced = await fresh();
  const e2 = await event(forced);
  await F.svc(forced, `update public.ministry_events set image_url = '${IMG}' where id = '${e2}'`);
  const withConfirm = await attempt(forced, ROLL.replace(/^begin;\s*$/m, "begin;\nselect set_config('church_landing.allow_data_loss', 'yes', true);"));
  check("an explicit confirmation (the line the file documents, as the first statement in its transaction) lets the rollback drop stored pictures", withConfirm === null, withConfirm);
  eq("...and then the columns are gone", (await rows(forced, `select count(*)::int as n from information_schema.columns where table_schema = 'public' and column_name in ('image_url','image_consent') and table_name in ('ministry_events','ministry_announcements','ministry_care_cases')`))[0].n, 0);
}

// ---------------------------------------------------------------- G. the file itself
section = "G. the migration file: ";
{
  const strip = MIG.replace(/^--.*$/gm, "");
  check("it adds columns, one trigger and functions, and drops or replaces nothing that exists", !/\bdrop (table|column|function|policy|constraint)\b/i.test(strip.replace(/drop trigger if exists ministry_care_cases_image_trg[^;]*;/i, "")) && !/create or replace function public\.(ministry_testimonies_public|ministry_care_case_guard|ministry_content_guard)\b/.test(strip));
  check("it is a single transaction with preconditions and postconditions", /^begin;/m.test(strip) && /^commit;/m.test(strip) && /precondition failed/.test(strip) && /postcondition failed/.test(strip));
  check("no money-like column, no payment word, no policy change", !/(amount|price|currency|commission|payout|refund)\s+(numeric|integer|bigint|text)/i.test(strip) && !/create policy|alter policy|drop policy/i.test(strip));
  check("every grant is column level (no table-wide grant to anon)", !/grant (select|insert|update|all)\s+on\s+(table\s+)?public\.ministry_\w+\s+to\s+[^;]*anon/i.test(strip) && !/to\s+anon[^;]*;/.test(strip.replace(/grant select \(image_url\) on public\.\w+ to anon, authenticated;/g, "").replace(/grant execute on function[^;]*;/g, "")));
  const grants = (strip.match(/^\s*grant\b[^;]*;/gim) || []);
  check("image_consent is never granted to anon or PUBLIC (looking at the GRANT statements themselves)", grants.length >= 6 && grants.filter((g) => /image_consent/.test(g)).length === 2 && grants.filter((g) => /image_consent/.test(g)).every((g) => !/\b(anon|public)\b/i.test(g.split(/\sto\s/i).pop())), grants.join(" | "));
  check("the support scripts are marked read-only (preflight, verify) and guarded (rollback)", /READ-ONLY/.test(PRE) && /READ-ONLY/.test(VER) && /rollback refused/.test(ROLL) && /allow_data_loss/.test(ROLL));
}

console.log(`\n${fail === 0 ? "OK" : "FAILED"}: ${pass} checks passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
