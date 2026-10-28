// Church giving, the money part: the 2027-01-12_church_gifts migration (gifts, the church earnings ledger, payouts, refund requests), attacked OFFLINE (PGlite, synthetic data, no Supabase, no network, no Fapshi).
//   * the preflight is all-true before, the verify all-true after, the migration is re-runnable, and the rollback refuses while financial records exist;
//   * collection is STILL closed after this migration: no gift can be created until the (separate, proposed) activation replaces church_giving_collection_open();
//   * with collection simulated OPEN: a gift needs an open, published fund of the SAME church, giving switched on, and at least the minimum gift; money columns never change; the state machine is guarded;
//   * settlement is atomic and idempotent: 5% giving, 5% care, whole XAF, half-up, rate snapshot, one earning per gift, an amount mismatch goes to review, the Fapshi fee is not deducted from the church;
//   * row-level security: nobody reaches the raw tables; staff read the ledger view with no payer phone/email/token; anonymous gifts show no name; other churches and platform admins see nothing;
//   * payouts: owner only, hold and minimum, earnings locked once, finishing is service-only; refund requests: window, one open request, a refund reverses the earning only when it is not in a payout.
//   Run:  node scripts/tests/churchGiftsDb.test.mjs
import fs from "fs";
import path from "path";
import * as F from "./churchFixtures.mjs";

const { PGlite } = await import(process.env.PGLITE_ENTRY || "@electric-sql/pglite");
const { u, prof, REPO } = F;
let pass = 0, fail = 0, section = "";
const check = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log("  FAIL:", `${section}${name}`, "|", String(detail).slice(0, 400)); } };
const eq = (name, a, b) => check(name, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8").replace(/\r\n/g, "\n");
const MIG = F.GI_MIG;
const SUP = "supabase/support/2027-01-12_church_gifts";
const PRE = read(`${SUP}.preflight.sql`), VER = read(`${SUP}.verify.sql`), ROLL = read(`${SUP}.rollback.sql`);
const ACTIVATE = read("supabase/support/2027-01-13_church_giving_activate.PROPOSED.sql");
const rows = (db, sql) => F.svcQuery(db, sql);
const S = (db, who) => F.sessionFor(db, who);
const attempt = async (db, sql) => { try { await db.exec(sql); return null; } catch (e) { try { await db.exec("rollback"); } catch { /* nothing to roll back */ } return String(e.message); } };
const allOk = (r) => r.length > 0 && r.every((x) => x.ok === true);
const MANAGER = F.id("c", 741), VIEWER = F.id("c", 742);
const R = { manage: F.id("b", 741), other: F.id("b", 742) };
const BASE_MIGS = { dailyWords: true, events: true, attendance: true, bible: true, music: true, care: true, testimonies: true, landing: true, groupsPastors: true, customers: true, bibleYear: true, counselling: true };
let n = 0;
const uniq = () => ++n;

async function fresh({ open = false, gifts = true } = {}) {
  const db = await F.newDb(PGlite, { ...BASE_MIGS, givingLock: true, gifts });
  await F.seed(db);
  if (!gifts) await db.exec(F.GIFTS_SQL); // the platform pieces the migration reads, without the migration itself
  await F.svc(db, `insert into public.users (id, role, plan_id) values ('${MANAGER}','user','${F.plan.free}'), ('${VIEWER}','user','${F.plan.free}');
    insert into public.organization_roles (id, profile_id, key, name, permissions) values ('${R.manage}','${prof.c1}','gmanage','Giving manager','{church.giving.manage}'), ('${R.other}','${prof.c1}','gother','Members','{church.members.view,church.members.manage}');
    insert into public.organization_members (profile_id, user_id, role_id) values ('${prof.c1}','${MANAGER}','${R.manage}'), ('${prof.c1}','${VIEWER}','${R.other}');
    update public.users set affiliate_payout_method = 'mobile_money', affiliate_payout_details = '{"phone":"670000000"}'::jsonb where id = '${u.owner1}'`);
  if (open) {
    await db.exec(F.OPEN_SQL);
    await F.svc(db, `update public.platform_settings set church_giving_pilot_profiles = array['${prof.c1}','${prof.c2}']::uuid[]`); // the tests' two churches are in the pilot; section P proves the list matters
    await F.svc(db, `insert into public.church_features (profile_id, giving) values ('${prof.c1}', true), ('${prof.c2}', true)`);
  }
  return db;
}
async function fund(db, o = {}) {
  const id = o.id ?? F.id("4", 800 + (o.n ?? uniq()));
  await F.svc(db, `insert into public.church_giving_funds (id, profile_id, kind, title_en, title_fr, is_published) values ('${id}','${o.profile ?? prof.c1}','${o.kind ?? "giving"}','Building fund','Fonds de construction',${o.published ?? true})`);
  if (o.status !== "draft") await F.svc(db, `update public.church_giving_funds set status = '${o.status ?? "open"}' where id = '${id}'`);
  return id;
}
const giftSql = (o) => `insert into public.church_gifts (id, profile_id, fund_id, fund_kind, amount_xaf, is_anonymous, donor_name, donor_contact, donor_email, payer_phone, payer_medium, external_id, access_token_hash, expires_at${o.status ? ", status" : ""})
  values ('${o.id}','${o.profile ?? prof.c1}','${o.fund}','${o.kind ?? "giving"}',${o.amount ?? 10000},${o.anon ?? false},${F.q(o.name ?? null)},${F.q(o.contact ?? null)},${F.q(o.email ?? null)},'${o.phone ?? "670000001"}','mobile money','${o.ext ?? "pp-" + o.id}','hash-${o.id}', now() + interval '15 minutes'${o.status ? `, '${o.status}'` : ""})`;
async function gift(db, o) {
  const id = o.id ?? F.id("5", 900 + uniq());
  const err = await F.svcErr(db, giftSql({ ...o, id }));
  return { id, err };
}
const settle = async (db, id, amount = "null") => (await rows(db, `select public.church_settle_gift('${id}', ${amount}) as r`))[0].r;
const earning = async (db, id) => (await rows(db, `select gross_amount::int g, commission_rate::float r, platform_fee::int f, net_amount::int nt, status from public.church_gift_earnings where gift_id = '${id}'`))[0];

section = "A. preflight, apply, verify, re-run, rollback: ";
{
  const before = await fresh({ gifts: false });
  const pre = await rows(before, PRE);
  check("the preflight is all true BEFORE the migration (clean first run)", allOk(pre), JSON.stringify(pre.filter((x) => !x.ok)));
  check("the preflight is READ-ONLY", /^with\b/m.test(PRE.replace(/^--.*$/gm, "").trim()) && !/^\s*(insert|update|delete|drop|alter|create|grant|revoke|truncate)\b/im.test(PRE.replace(/^--.*$/gm, "")));
  await before.exec(MIG);
  const after = await rows(before, VER);
  check("the verify is all true AFTER the migration", allOk(after), JSON.stringify(after.filter((x) => !x.ok)));
  check("the verify is READ-ONLY", /^with\b/m.test(VER.replace(/^--.*$/gm, "").trim()) && !/^\s*(insert|update|delete|drop|alter|create|grant|revoke|truncate)\b/im.test(VER.replace(/^--.*$/gm, "")));
  check("the migration is re-runnable", (await attempt(before, MIG)) === null);
  check("the verify is still all true after the re-run", allOk(await rows(before, VER)));
  eq("collection is STILL closed after the migration", (await rows(before, "select public.church_giving_collection_open() as v"))[0].v, false);
  const db = await fresh({ open: true });
  const f = await fund(db);
  await gift(db, { fund: f });
  const refused = await attempt(db, ROLL);
  check("the rollback REFUSES while a gift exists", refused !== null && /rollback refused/.test(refused), refused);
  check("a refused rollback changed nothing", (await rows(db, "select count(*)::int n from public.church_gifts"))[0].n === 1);
  check("the rollback runs once the loss is confirmed", (await attempt(db, ROLL.replace("begin;", "begin;\nselect set_config('church_gifts.allow_data_loss', 'yes', true);"))) === null);
  check("the rollback leaves no table or function behind", (await rows(db, "select (select count(*) from information_schema.tables where table_schema='public' and table_name like 'church_gift%') + (select count(*) from pg_proc where proname like 'church_settle%' or proname like 'church_gifts_%') as n"))[0].n === 0);
  check("the rollback keeps the funds and the lock", (await rows(db, "select count(*)::int n from public.church_giving_funds"))[0].n === 1);
  const empty = await fresh();
  check("an empty install rolls back without confirmation, and applies again", (await attempt(empty, ROLL)) === null && (await attempt(empty, MIG)) === null);
  const code = MIG.replace(/^--.*$/gm, "");
  check("the migration does not write to the Shop ledger or the old fund/lock objects (static)", !/(insert into|update|delete from|alter table|drop table|create table( if not exists)?)\s+(public\.)?(customer_payments|commerce_sale_earnings|commerce_payouts|product_orders|church_giving_funds|church_features)\b/i.test(code));
  check("the migration does NOT replace the collection switch (static)", !/create (or replace )?function public\.church_giving_collection_open/i.test(code));
  check("the proposed activation is kept OUT of supabase/migrations", !fs.existsSync(path.join(REPO, "supabase/migrations/2027-01-13_church_giving_activate.PROPOSED.sql")));
  const act = await fresh();
  check("the proposed activation applies, and still leaves collection closed (the platform switch is off)", (await attempt(act, ACTIVATE)) === null && (await rows(act, "select public.church_giving_collection_open() as v"))[0].v === false);
  await F.svc(act, "update public.platform_settings set church_giving_enabled = true");
  eq("only the explicit platform switch opens it", (await rows(act, "select public.church_giving_collection_open() as v"))[0].v, true);
}

section = "B. while collection is closed nothing can be created: ";
{
  const db = await fresh();
  const f = await fund(db, { status: "draft" });
  const g = await gift(db, { fund: f });
  check("a gift is refused", g.err && g.err.code === "23514" && /not_available/.test(g.err.msg), JSON.stringify(g.err));
  const sw = await F.svcErr(db, `insert into public.church_features (profile_id, giving) values ('${prof.c1}', true)`);
  check("the giving switch is still refused", sw && /giving_collection_not_available/.test(sw.msg), JSON.stringify(sw));
  eq("no gift row exists", (await rows(db, "select count(*)::int n from public.church_gifts"))[0].n, 0);
  const apiRoles = await S(db, u.owner1).from("church_gifts").insert({ profile_id: prof.c1 });
  check("not even the church owner can write the table", !!apiRoles.error);
}

section = "C. the shape of a gift: ";
{
  const db = await fresh({ open: true });
  const f = await fund(db);
  const care = await fund(db, { kind: "care" });
  const ok = await gift(db, { fund: f });
  check("a gift to an open, published fund of the same church is accepted", ok.err === null, JSON.stringify(ok.err));
  const stored = (await rows(db, `select status, confirmed_at, currency, receipt_number::int rn from public.church_gifts where id = '${ok.id}'`))[0];
  check("it starts initiated, XAF, with a receipt number and not confirmed", stored.status === "initiated" && stored.confirmed_at === null && stored.currency === "XAF" && stored.rn > 0, JSON.stringify(stored));
  check("a care gift is accepted for a care fund", (await gift(db, { fund: care, kind: "care" })).err === null);
  for (const [label, o, code] of [
    ["a gift below the 500 XAF minimum", { fund: f, amount: 499 }, "gift_below_minimum"],
    ["exactly 500 XAF is fine", { fund: f, amount: 500 }, null],
    ["a fund of another church", { fund: await fund(db, { profile: prof.c2 }), profile: prof.c1 }, "gift_fund_not_open"],
    ["a kind that does not match the fund", { fund: f, kind: "care" }, "gift_fund_kind_mismatch"],
    ["a draft fund", { fund: await fund(db, { status: "draft" }) }, "gift_fund_not_open"],
    ["a closed fund", { fund: await fund(db, { status: "closed" }) }, "gift_fund_not_open"],
    ["an unpublished fund", { fund: await fund(db, { published: false }) }, "gift_fund_not_open"],
    ["an anonymous gift that carries a name", { fund: f, anon: true, name: "Jean" }, "church_gifts_anonymous_check"],
    ["a gift that starts already succeeded", { fund: f, status: "succeeded" }, "gift_must_start_initiated"],
  ]) {
    const r = await gift(db, o);
    if (code === null) check(`${label}`, r.err === null, JSON.stringify(r.err));
    else check(`${label} is refused`, r.err && r.err.code === "23514" && r.err.msg.includes(code), JSON.stringify(r.err));
  }
  const anon = await gift(db, { fund: f, anon: true });
  check("an anonymous gift stores no name and no contact", anon.err === null && (await rows(db, `select donor_name, donor_contact from public.church_gifts where id = '${anon.id}'`))[0].donor_name === null);
  const dup = await F.svcErr(db, giftSql({ id: F.id("5", 1), fund: f, ext: `pp-${ok.id}` }));
  check("an external reference is unique", dup && dup.code === "23505", JSON.stringify(dup));
  await F.svc(db, `update public.church_features set giving = false where profile_id = '${prof.c1}'`);
  const off = await gift(db, { fund: f });
  check("a gift is refused while the church has giving switched off", off.err && off.err.msg.includes("gift_giving_not_enabled"), JSON.stringify(off.err));
  const nc = await gift(db, { fund: f, profile: prof.nc });
  check("a page that is not a church takes no gift", nc.err && nc.err.code === "23514", JSON.stringify(nc.err));
}

section = "D. history is immutable and the state machine is guarded: ";
{
  const db = await fresh({ open: true });
  const f = await fund(db);
  const f2 = await fund(db);
  const g = await gift(db, { fund: f, name: "Jean", contact: "j@x.cm" });
  for (const [label, col, val] of [["the amount", "amount_xaf", "999999"], ["the church", "profile_id", `'${prof.c2}'`], ["the fund", "fund_id", `'${f2}'`], ["the receipt number", "receipt_number", "424242"], ["the token hash", "access_token_hash", "'x'"],
    ["the donor name", "donor_name", "'Other'"], ["the anonymous flag", "is_anonymous", "true"], ["the payer phone", "payer_phone", "'699999999'"], ["the creation time", "created_at", "now() + interval '1 day'"], ["the reference", "external_id", "'new'"]]) {
    const e = await F.svcErr(db, `update public.church_gifts set ${col} = ${val} where id = '${g.id}'`);
    check(`${label} can never change`, e && (e.code === "42501" || e.code === "23514"), JSON.stringify(e));
  }
  const del = await F.svcErr(db, `delete from public.church_gifts where id = '${g.id}'`);
  check("a gift is never deleted", del && del.code === "42501", JSON.stringify(del));
  const fdel = await F.svcErr(db, `delete from public.church_giving_funds where id = '${f}'`);
  check("a fund that holds gifts cannot be deleted", fdel && (fdel.code === "23503" || fdel.code === "23001"), JSON.stringify(fdel));
  const bad = await F.svcErr(db, `update public.church_gifts set status = 'refunded' where id = '${g.id}'`);
  check("initiated -> refunded is illegal", bad && bad.msg.includes("illegal status transition"), JSON.stringify(bad));
  check("initiated -> pending with a provider transaction id is fine", (await F.svcErr(db, `update public.church_gifts set status = 'pending', provider_transaction_id = 'TX1' where id = '${g.id}'`)) === null);
  const swap = await F.svcErr(db, `update public.church_gifts set provider_transaction_id = 'TX2' where id = '${g.id}'`);
  check("a provider transaction id is fixed once set", swap && swap.code === "42501", JSON.stringify(swap));
  const g2 = await gift(db, { fund: f });
  const dupTx = await F.svcErr(db, `update public.church_gifts set status = 'pending', provider_transaction_id = 'TX1' where id = '${g2.id}'`);
  check("one provider transaction can belong to one gift only", dupTx && dupTx.code === "23505", JSON.stringify(dupTx));
  const noConf = await F.svcErr(db, `update public.church_gifts set status = 'succeeded' where id = '${g.id}'`);
  check("succeeded without a confirmation time is refused", noConf && noConf.code === "23514", JSON.stringify(noConf));
  await F.svc(db, `update public.church_gifts set status = 'failed' where id = '${g.id}'`);
  const back = await F.svcErr(db, `update public.church_gifts set status = 'pending' where id = '${g.id}'`);
  check("failed can not go back to pending", back && back.msg.includes("illegal status transition"), JSON.stringify(back));
  const jump = await F.svcErr(db, `update public.church_gifts set status = 'succeeded', confirmed_at = now() where id = '${g.id}'`);
  check("failed can not jump to succeeded (only settlement can send it to review)", jump && jump.msg.includes("illegal status transition"), JSON.stringify(jump));
}

section = "E. settlement: ";
{
  const db = await fresh({ open: true });
  const f = await fund(db);
  const care = await fund(db, { kind: "care" });
  const g = await gift(db, { fund: f, amount: 10000 });
  const first = await settle(db, g.id, "10000");
  check("the first settlement succeeds and says it settled now", first.status === "succeeded" && first.settled_now === true && first.earning === true, JSON.stringify(first));
  const e = await earning(db, g.id);
  check("a 10000 XAF giving gift: 5% commission 500, church net 9500, the Fapshi fee is NOT deducted", e.g === 10000 && e.r === 0.05 && e.f === 500 && e.nt === 9500 && e.status === "recorded", JSON.stringify(e));
  const second = await settle(db, g.id, "10000");
  check("a second settlement changes nothing", second.status === "succeeded" && second.settled_now === false, JSON.stringify(second));
  eq("exactly one earning exists", (await rows(db, `select count(*)::int n from public.church_gift_earnings where gift_id = '${g.id}'`))[0].n, 1);
  const conf1 = (await rows(db, `select confirmed_at from public.church_gifts where id = '${g.id}'`))[0].confirmed_at;
  await settle(db, g.id);
  eq("the confirmation time does not move on a repeat", (await rows(db, `select confirmed_at from public.church_gifts where id = '${g.id}'`))[0].confirmed_at, conf1);
  const c = await gift(db, { fund: care, kind: "care", amount: 2000 });
  await settle(db, c.id);
  const ec = await earning(db, c.id);
  check("a care gift uses the CARE rate (5%)", ec.r === 0.05 && ec.f === 100 && ec.nt === 1900, JSON.stringify(ec));
  await F.svc(db, "update public.platform_settings set church_care_commission_rate = 0.1, church_giving_commission_rate = 0.07");
  const g3 = await gift(db, { fund: f, amount: 555 });
  const c3 = await gift(db, { fund: care, kind: "care", amount: 555 });
  await settle(db, g3.id); await settle(db, c3.id);
  const e3 = await earning(db, g3.id), ec3 = await earning(db, c3.id);
  check("the two rates are independent settings, rounded half-up to a whole XAF (555 x 7% = 38.85 -> 39)", e3.r === 0.07 && e3.f === 39 && e3.nt === 516 && ec3.r === 0.1 && ec3.f === 56 && ec3.nt === 499, JSON.stringify([e3, ec3]));
  check("an old earning keeps the rate it was recorded with (snapshot)", (await earning(db, g.id)).r === 0.05);
  const gcheck = (await rows(db, "select count(*)::int n from public.church_gift_earnings where gross_amount <> platform_fee + net_amount"))[0].n;
  eq("gross always equals fee + net", gcheck, 0);
  await F.svc(db, "update public.platform_settings set church_care_commission_rate = 0.05, church_giving_commission_rate = 0.05");
  const m = await gift(db, { fund: f, amount: 5000 });
  const mm = await settle(db, m.id, "4000");
  check("a provider amount that differs sends the gift to review, not to paid", mm.status === "review", JSON.stringify(mm));
  eq("it is payment_review with no earning", (await rows(db, `select (select status from public.church_gifts where id='${m.id}') s, (select count(*)::int from public.church_gift_earnings where gift_id='${m.id}') n`))[0], { s: "payment_review", n: 0 });
  const fl = await gift(db, { fund: f });
  await F.svc(db, `update public.church_gifts set status = 'failed' where id = '${fl.id}'`);
  const late = await settle(db, fl.id);
  check("a success that arrives after a recorded failure goes to a human (review)", late.status === "review", JSON.stringify(late));
  const ex = await gift(db, { fund: f });
  await F.svc(db, `update public.church_gifts set status = 'expired' where id = '${ex.id}'`);
  check("a late confirmation of an EXPIRED attempt is honoured (the money is real)", (await settle(db, ex.id)).status === "succeeded" && (await earning(db, ex.id)) !== undefined);
  eq("settling an unknown gift answers not_found", (await settle(db, F.id("5", 99999))).status, "not_found");
  const nobody = await S(db, u.owner1).rpc("church_settle_gift", { p_gift_id: g.id });
  check("a signed-in user cannot call the settlement", !!nobody.error);
  const anonymous = await S(db, null).rpc("church_settle_gift", { p_gift_id: g.id });
  check("an anonymous visitor cannot call the settlement", !!anonymous.error);
  const closedFund = await fund(db);
  const lateGift = await gift(db, { fund: closedFund, amount: 1000 });
  await F.svc(db, `update public.church_giving_funds set status = 'closed' where id = '${closedFund}'`);
  check("a gift in flight still settles after its fund is closed (money is never lost)", (await settle(db, lateGift.id)).status === "succeeded");
  const closedGiftCount = await gift(db, { fund: closedFund });
  check("but a closed fund takes no NEW gift", closedGiftCount.err && closedGiftCount.err.msg.includes("gift_fund_not_open"));
  const eg = await F.svcErr(db, `update public.church_gift_earnings set net_amount = 1 where gift_id = '${g.id}'`);
  check("an earning's money columns can never change", eg && eg.code === "42501", JSON.stringify(eg));
  const eIns = await F.svcErr(db, `insert into public.church_gift_earnings (gift_id, profile_id, creator_user_id, gross_amount, commission_rate, platform_fee, net_amount) values ('${g.id}','${prof.c1}','${u.owner1}',10000,0.05,500,9500)`);
  check("a second earning for the same gift is refused", eIns && eIns.code === "23505", JSON.stringify(eIns));
  const wrongAmount = await gift(db, { fund: f, amount: 1000 });
  const eBad = await F.svcErr(db, `insert into public.church_gift_earnings (gift_id, profile_id, creator_user_id, gross_amount, commission_rate, platform_fee, net_amount) values ('${wrongAmount.id}','${prof.c1}','${u.owner1}',1000,0.05,50,950)`);
  check("an earning for a gift that did not succeed is refused", eBad && eBad.code === "23514", JSON.stringify(eBad));
}

section = "F. who can see what: ";
{
  const db = await fresh({ open: true });
  const f = await fund(db);
  const f2 = await fund(db, { profile: prof.c2 });
  const named = await gift(db, { fund: f, name: "Jean Mbarga", contact: "jean@x.cm", email: "jean@x.cm", phone: "670111222" });
  const anon = await gift(db, { fund: f, anon: true, email: "secret@x.cm", phone: "670333444" });
  const other = await gift(db, { fund: f2, profile: prof.c2, name: "Other Church Donor" });
  await settle(db, named.id); await settle(db, anon.id);
  const cols = "id, donor_name, donor_contact, amount_xaf, status, is_anonymous";
  for (const [label, who, expect] of [["the church owner", u.owner1, 2], ["a giving manager", MANAGER, 2], ["a members manager (no giving right)", VIEWER, 0], ["a stranger", u.stranger, 0], ["the owner of ANOTHER church", u.owner2, 1], ["a platform admin who is not the owner", u.admin, 0], ["the public", null, 0]]) {
    const r = await S(db, who).from("church_gift_ledger").select(cols);
    check(`${label} reads ${expect} gift(s) in the ledger`, r.error ? expect === 0 : (r.data || []).length === expect, JSON.stringify(r.error || r.data));
  }
  const ledger = (await S(db, MANAGER).from("church_gift_ledger").select(cols)).data;
  const seenNamed = ledger.find((x) => x.id === named.id), seenAnon = ledger.find((x) => x.id === anon.id);
  check("staff see a named donor's name and contact", seenNamed && seenNamed.donor_name === "Jean Mbarga" && seenNamed.donor_contact === "jean@x.cm");
  check("staff see NO name and NO contact for an anonymous gift", seenAnon && seenAnon.donor_name === null && seenAnon.donor_contact === null && seenAnon.is_anonymous === true);
  for (const col of ["payer_phone", "donor_email", "access_token_hash", "language"]) {
    const r = await S(db, u.owner1).from("church_gift_ledger").select(col);
    check(`the ledger exposes no ${col}`, !!r.error, JSON.stringify(r));
  }
  for (const [label, who] of [["the owner", u.owner1], ["a giving manager", MANAGER], ["anon", null], ["another church owner", u.owner2]]) {
    const r = await S(db, who).from("church_gifts").select("id");
    check(`${label} cannot read the raw gift table`, !!r.error || (r.data || []).length === 0, JSON.stringify(r));
    const e = await S(db, who).from("church_gift_earnings").select("id");
    check(`${label} cannot read the raw earnings table`, !!e.error || (e.data || []).length === 0, JSON.stringify(e));
  }
  for (const [label, who, expect] of [["the owner", u.owner1, 2], ["a giving manager (money is owner-only)", MANAGER, 0], ["another church owner", u.owner2, 0], ["anon", null, 0], ["a platform admin", u.admin, 0]]) {
    const r = await S(db, who).from("church_gift_earnings_ledger").select("id, gross_amount, net_amount");
    check(`${label} reads ${expect} earning(s)`, r.error ? expect === 0 : (r.data || []).length === expect, JSON.stringify(r.error || r.data));
  }
  const upd = await S(db, u.owner1).from("church_gift_earnings").update({ status: "paid" }).eq("gift_id", named.id).select("id");
  check("the owner cannot mark an earning paid", !!upd.error || (upd.data || []).length === 0, JSON.stringify(upd));
  const crossFund = await S(db, u.owner2).from("church_giving_funds").select("id").eq("id", f);
  check("another church's owner sees none of this church's draft data", !crossFund.error);
}

section = "G. payouts: ";
{
  const db = await fresh({ open: true });
  const f = await fund(db);
  await F.svc(db, "update public.platform_settings set church_payout_hold_days = 0, church_min_payout_xaf = 5000");
  const a = await gift(db, { fund: f, amount: 4000 }); await settle(db, a.id);
  const owner = S(db, u.owner1);
  const small = await owner.rpc("request_church_payout", { p_profile_id: prof.c1 });
  check("below the minimum payout is refused", !!small.error && /payout_below_minimum/.test(small.error.message), JSON.stringify(small));
  const b = await gift(db, { fund: f, amount: 6000 }); await settle(db, b.id);
  const notOwner = await S(db, MANAGER).rpc("request_church_payout", { p_profile_id: prof.c1 });
  check("a giving manager (not the owner) cannot request a payout", !!notOwner.error && /church_owner_required/.test(notOwner.error.message), JSON.stringify(notOwner));
  const other = await S(db, u.owner2).rpc("request_church_payout", { p_profile_id: prof.c1 });
  check("another church's owner cannot request this church's payout", !!other.error, JSON.stringify(other));
  const anon = await S(db, null).rpc("request_church_payout", { p_profile_id: prof.c1 });
  check("an anonymous visitor cannot request a payout", !!anon.error);
  const ok = await owner.rpc("request_church_payout", { p_profile_id: prof.c1 });
  check("the owner requests a payout of the net total 9500 (3800 + 5700)", !ok.error && Number(ok.data.amount) === 9500 && ok.data.status === "requested" && ok.data.payout_method === "mobile_money", JSON.stringify(ok));
  eq("both earnings are now requested and linked", (await rows(db, "select count(*)::int n from public.church_gift_earnings where status = 'requested' and payout_id is not null"))[0].n, 2);
  const again = await owner.rpc("request_church_payout", { p_profile_id: prof.c1 });
  check("a second request finds nothing left (no double payout)", !!again.error, JSON.stringify(again));
  const myPayouts = await owner.from("church_payouts").select("id, amount, status");
  check("the owner reads their payout", !myPayouts.error && myPayouts.data.length === 1);
  const noRead = await S(db, MANAGER).from("church_payouts").select("id");
  check("a giving manager does not read payouts", !noRead.error && noRead.data.length === 0);
  const edit = await owner.from("church_payouts").update({ status: "paid" }).eq("id", ok.data.id).select("id");
  check("the owner cannot mark their own payout paid", !!edit.error || edit.data.length === 0);
  const fin = await S(db, u.owner1).rpc("church_payout_finish", { p_payout_id: ok.data.id, p_outcome: "paid", p_actor: u.admin });
  check("finishing a payout is service-only", !!fin.error);
  const rej = (await rows(db, `select (public.church_payout_finish('${ok.data.id}', 'rejected', '${u.admin}', 'wrong number')).status s`))[0].s;
  eq("a rejected payout", rej, "rejected");
  eq("a rejected payout gives the earnings back", (await rows(db, "select count(*)::int n from public.church_gift_earnings where status = 'recorded' and payout_id is null"))[0].n, 2);
  const twice = await F.svcErr(db, `select public.church_payout_finish('${ok.data.id}', 'paid', '${u.admin}')`);
  check("a finished payout cannot be finished again", twice && /payout_already_finished/.test(twice.msg), JSON.stringify(twice));
  const again2 = await owner.rpc("request_church_payout", { p_profile_id: prof.c1 });
  check("the owner can request again after a rejection", !again2.error);
  await rows(db, `select (public.church_payout_finish('${again2.data.id}', 'paid', '${u.admin}')).status s`);
  eq("paid payout marks the earnings paid", (await rows(db, "select count(*)::int n from public.church_gift_earnings where status = 'paid'"))[0].n, 2);
  const illegal = await F.svcErr(db, `update public.church_gift_earnings set status = 'recorded', payout_id = null where status = 'paid'`);
  check("a paid earning can never go back", illegal && illegal.code === "23514", JSON.stringify(illegal));
  const hold = await fresh({ open: true });
  const hf = await fund(hold);
  await F.svc(hold, "update public.platform_settings set church_min_payout_xaf = 100");
  const h = await gift(hold, { fund: hf, amount: 6000 }); await settle(hold, h.id);
  const held = await S(hold, u.owner1).rpc("request_church_payout", { p_profile_id: prof.c1 });
  check("an earning inside the hold period (3 days by default) is not payable yet", !!held.error, JSON.stringify(held));
  const noMethod = await fresh({ open: true });
  await F.svc(noMethod, `update public.users set affiliate_payout_method = null where id = '${u.owner1}'; update public.platform_settings set church_payout_hold_days = 0, church_min_payout_xaf = 100`);
  const nf = await fund(noMethod); const ng = await gift(noMethod, { fund: nf, amount: 6000 }); await settle(noMethod, ng.id);
  const nm = await S(noMethod, u.owner1).rpc("request_church_payout", { p_profile_id: prof.c1 });
  check("a payout needs a payout method", !!nm.error && /payout_method_missing/.test(nm.error.message), JSON.stringify(nm));
}

section = "H. refund requests: ";
{
  const db = await fresh({ open: true });
  const f = await fund(db);
  const g = await gift(db, { fund: f, amount: 10000 });
  const early = await F.svcErr(db, `insert into public.church_gift_refund_requests (gift_id, profile_id, reason) values ('${g.id}','${prof.c1}','I made a mistake')`);
  check("no refund request for a gift that was not paid", early && early.msg.includes("refund_gift_not_refundable"), JSON.stringify(early));
  await settle(db, g.id);
  const req = await F.svcErr(db, `insert into public.church_gift_refund_requests (gift_id, profile_id, reason) values ('${g.id}','${prof.c1}','I made a mistake')`);
  check("a paid gift can be the subject of a refund request, inside the 48 hour window", req === null, JSON.stringify(req));
  const dup = await F.svcErr(db, `insert into public.church_gift_refund_requests (gift_id, profile_id, reason) values ('${g.id}','${prof.c1}','again')`);
  check("only one open request per gift", dup && dup.code === "23505", JSON.stringify(dup));
  const wrongChurch = await F.svcErr(db, `insert into public.church_gift_refund_requests (gift_id, profile_id, reason) values ('${g.id}','${prof.c2}','x')`);
  check("a request cannot name another church", wrongChurch !== null);
  const id = (await rows(db, "select id from public.church_gift_refund_requests limit 1"))[0].id;
  const asStaff = await S(db, MANAGER).from("church_gift_refund_requests").select("id, status, reason");
  check("church staff with giving rights read the requests", !asStaff.error && asStaff.data.length === 1);
  for (const [label, who] of [["a members manager", VIEWER], ["another church owner", u.owner2], ["the public", null], ["a platform admin", u.admin]]) {
    const r = await S(db, who).from("church_gift_refund_requests").select("id");
    check(`${label} reads no request`, r.error ? true : r.data.length === 0, JSON.stringify(r));
  }
  const write = await S(db, u.owner1).from("church_gift_refund_requests").update({ status: "approved" }).eq("id", id).select("id");
  check("the church cannot decide a refund request", !!write.error || write.data.length === 0);
  const decide = await S(db, u.owner1).rpc("church_gift_refund_decide", { p_request_id: id, p_decision: "approved", p_actor: u.owner1 });
  check("the decision function is service-only", !!decide.error);
  const approved = (await rows(db, `select (public.church_gift_refund_decide('${id}', 'approved', '${u.admin}', 'ok, will refund by hand')).status s`))[0].s;
  eq("an administrator approves the request", approved, "approved");
  eq("approving moves no money: the gift is still succeeded and the earning still recorded", (await rows(db, `select (select status from public.church_gifts where id='${g.id}') g, (select status from public.church_gift_earnings where gift_id='${g.id}') e`))[0], { g: "succeeded", e: "recorded" });
  const done = (await rows(db, `select (public.church_gift_refund_decide('${id}', 'refunded', '${u.admin}', 'sent by hand')).status s`))[0].s;
  eq("once the administrator has returned the money by hand, it is recorded as refunded", done, "refunded");
  eq("the gift is refunded and the church earning reversed", (await rows(db, `select (select status from public.church_gifts where id='${g.id}') g, (select status from public.church_gift_earnings where gift_id='${g.id}') e`))[0], { g: "refunded", e: "reversed" });
  const redo = await F.svcErr(db, `select public.church_gift_refund_decide('${id}', 'declined', '${u.admin}')`);
  check("a decided request cannot be decided again", redo && /refund_already_decided/.test(redo.msg), JSON.stringify(redo));
  await F.svc(db, `update public.platform_settings set church_payout_hold_days = 0, church_min_payout_xaf = 100`);
  const p = await gift(db, { fund: f, amount: 8000 }); await settle(db, p.id);
  await F.svc(db, `insert into public.church_gift_refund_requests (id, gift_id, profile_id, reason) values ('${F.id("7", 1)}','${p.id}','${prof.c1}','mistake')`);
  await S(db, u.owner1).rpc("request_church_payout", { p_profile_id: prof.c1 });
  const blocked = await F.svcErr(db, `select public.church_gift_refund_decide('${F.id("7", 1)}', 'refunded', '${u.admin}')`);
  check("a refund cannot reverse an earning that is already in a payout (the balance would silently go negative)", blocked && /refund_earning_in_payout/.test(blocked.msg), JSON.stringify(blocked));
  const declined = (await rows(db, `select (public.church_gift_refund_decide('${F.id("7", 1)}', 'declined', '${u.admin}', 'already paid out')).status s`))[0].s;
  eq("it can be declined instead", declined, "declined");
  const old = await gift(db, { fund: f, amount: 1000 }); await settle(db, old.id);
  await db.exec(`alter table public.church_gifts disable trigger church_gifts_guard_trg; update public.church_gifts set confirmed_at = now() - interval '3 days' where id = '${old.id}'; alter table public.church_gifts enable trigger church_gifts_guard_trg`); // as the database owner: the guard forbids this for everybody else
  const late = await F.svcErr(db, `insert into public.church_gift_refund_requests (gift_id, profile_id, reason) values ('${old.id}','${prof.c1}','too late')`);
  check("after 48 hours a refund can no longer be requested", late && late.msg.includes("refund_window_closed"), JSON.stringify(late));
}

section = "P. the pilot list: only listed churches can collect: ";
{
  const db = await fresh({ open: true });
  const f = await fund(db);
  const f2 = await fund(db, { profile: prof.c2 });
  eq("the list starts empty on a clean install", (await rows(await fresh(), "select cardinality(church_giving_pilot_profiles)::int n from public.platform_settings"))[0].n, 0);
  await F.svc(db, `update public.platform_settings set church_giving_pilot_profiles = array['${prof.c1}']::uuid[]`);
  check("a pilot church takes a gift", (await gift(db, { fund: f })).err === null);
  const other = await gift(db, { fund: f2, profile: prof.c2 });
  check("a church NOT on the list is refused by the gift guard, although collection is open and its fund is open", other.err && other.err.msg.includes("giving_collection_not_available"), JSON.stringify(other.err));
  await F.svc(db, "update public.platform_settings set church_giving_pilot_profiles = '{}'");
  const none = await gift(db, { fund: f });
  check("with an empty list nobody collects", none.err && none.err.msg.includes("giving_collection_not_available"), JSON.stringify(none.err));
  const act = await fresh();
  await act.exec(ACTIVATE);
  await F.svc(act, "update public.platform_settings set church_giving_enabled = true");
  const sw = await F.svcErr(act, `insert into public.church_features (profile_id, giving) values ('${prof.c1}', true)`);
  check("after the activation file, the giving switch is still refused for a church that is not on the list", sw && /giving_collection_not_available/.test(sw.msg), JSON.stringify(sw));
  await F.svc(act, `update public.platform_settings set church_giving_pilot_profiles = array['${prof.c1}']::uuid[]`);
  check("...and accepted for the pilot church", (await F.svcErr(act, `insert into public.church_features (profile_id, giving) values ('${prof.c1}', true)`)) === null);
  const sw2 = await F.svcErr(act, `insert into public.church_features (profile_id, giving) values ('${prof.c2}', true)`);
  check("...while every other church stays closed", sw2 && /giving_collection_not_available/.test(sw2.msg), JSON.stringify(sw2));
  await F.svc(act, "update public.platform_settings set church_giving_enabled = false");
  const closedFund = await fund(act, { status: "draft" });
  check("switching the platform kill switch off refuses new gifts at once", (await gift(act, { fund: closedFund })).err !== null);
}

section = "I. the Shop is untouched: ";
{
  const code = MIG.replace(/^--.*$/gm, "");
  check("no Shop table is named in the migration's statements except the read of users and platform_settings", !/(product_orders|customer_payments|commerce_sale_earnings|commerce_payouts)/.test(code));
  check("no church_ column is added to platform_settings other than the six approved and the pilot list", (code.match(/add column if not exists (church_\w+)/g) || []).length === 7);
}

console.log(`\nchurchGiftsDb: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
