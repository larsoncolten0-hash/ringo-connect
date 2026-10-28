// Church giving, the money part: the REAL gift flow (src/lib/church/giving/gifts/flow.ts), the REAL store and the REAL dashboard handlers, run OFFLINE against scratch in-memory PostgreSQL (PGlite) that holds the REAL
// migrations (2027-01-10 .. 2027-01-12). Fapshi is replaced by a recording double: NO REAL PAYMENT IS MADE, so this proves our side of the contract only. It does NOT prove Fapshi's behaviour.
//   * start: the church comes from the page, the fund must belong to it, nothing from the client decides money, anonymous gifts carry no name; refusals call Fapshi never;
//   * confirm: a gift is paid ONLY after the server asked Fapshi and was told SUCCESSFUL; repeated and parallel checks settle once; failures, mismatches and late confirmations;
//   * receipts, refunds (a record only), reconciliation sweeps, rate limits, XAF arithmetic against the database function;
//   * the dashboard: who sees which gifts, the owner-only balance, cross-church isolation, date ranges in Douala time.
//   Run:  node scripts/tests/churchGiftsFlow.test.mjs
import path from "path";
import { createHarness, kit, SRC } from "./ministryApiHarness.mjs";

const BASE = { dailyWords: true, events: true, attendance: true, bible: true, music: true, care: true, testimonies: true, landing: true, groupsPastors: true, customers: true, bibleYear: true, counselling: true, givingLock: true, gifts: true };
const H = await createHarness(BASE);
const { F, jiti } = H;
const { u, prof } = F;
const { check, eq, is, section, summary } = kit();
console.error = () => {};
console.warn = () => {};

const FLOW = jiti(path.join(SRC, "lib/church/giving/gifts/flow.ts"));
const STORE = jiti(path.join(SRC, "lib/church/giving/gifts/store.ts"));
const RULES = jiti(path.join(SRC, "lib/church/giving/gifts/rules.ts"));
const REPORTS = jiti(path.join(SRC, "lib/church/giving/gifts/reports.ts"));
const POLL = jiti(path.join(SRC, "lib/productCheckout/pollGate.ts"));

const MANAGER = F.id("c", 751), VIEWER = F.id("c", 752);
const R = { manage: F.id("b", 751), other: F.id("b", 752) };
const EXTRA = `
  insert into public.users (id, role, plan_id) values ('${MANAGER}','user','${F.plan.free}'), ('${VIEWER}','user','${F.plan.free}');
  insert into public.organization_roles (id, profile_id, key, name, permissions) values
    ('${R.manage}','${prof.c1}','gmanage','Giving manager','{church.giving.manage}'), ('${R.other}','${prof.c1}','gother','Members','{church.members.view,church.members.manage}');
  insert into public.organization_members (profile_id, user_id, role_id) values ('${prof.c1}','${MANAGER}','${R.manage}'), ('${prof.c1}','${VIEWER}','${R.other}');
  update public.profiles set username = 'grace-church', name = 'Grace Church' where id = '${prof.c1}';
  update public.profiles set username = 'other-church', name = 'Other Church' where id = '${prof.c2}';
  update public.users set affiliate_payout_method = 'mobile_money', affiliate_payout_details = '{"phone":"670000000"}'::jsonb where id = '${u.owner1}';
`;
const PHONE = "670123456";
let seq = 0;
const nid = (k) => F.id(k, 6000 + ++seq);

/** A recording stand-in for Fapshi. `plan` maps a transaction id to what Fapshi would answer. */
function makeProvider() {
  const p = { payCalls: [], statusCalls: [], plan: {}, failPay: false, failStatus: false, next: 0 };
  p.directPay = async (a) => { p.payCalls.push(a); if (p.failPay) throw new Error("fapshi down"); const id = `TX${++p.next}`; p.plan[id] = { status: "CREATED", amount: a.amount }; return { transId: id }; };
  p.getStatus = async (id) => { p.statusCalls.push(id); if (p.failStatus) throw new Error("fapshi timeout"); return p.plan[id] ?? { status: "CREATED", amount: null }; };
  return p;
}

async function world({ open = true, giving = true } = {}) {
  await H.fresh(EXTRA);
  if (open) await H.db.exec(F.OPEN_SQL);
  if (open) await F.svc(H.db, `update public.platform_settings set church_giving_pilot_profiles = array['${prof.c1}','${prof.c2}']::uuid[]`);
  if (open && giving) await F.svc(H.db, `insert into public.church_features (profile_id, giving) values ('${prof.c1}', true), ('${prof.c2}', true)`);
  const admin = F.sessionFor(H.db, null, { role: "service_role" });
  const provider = makeProvider();
  const clock = { t: Date.now() }; // the database stamps confirmations with its own clock, so the test clock starts at the real time
  const paid = [];
  const limiterCalls = [];
  const deps = {
    store: STORE.createSupabaseGiftStore(admin),
    provider,
    now: () => new Date(clock.t),
    newId: () => nid("5"),
    newToken: FLOW.createToken,
    log: () => {},
    onGiftPaid: async (gift) => { paid.push(gift.id); },
    limiter: { async hit(kind, subject) { limiterCalls.push([kind, subject]); return true; } },
  };
  const mkFund = async (o = {}) => {
    const id = o.id ?? nid("4");
    await F.svc(H.db, `insert into public.church_giving_funds (id, profile_id, kind, title_en, title_fr, is_published) values ('${id}','${o.profile ?? prof.c1}','${o.kind ?? "giving"}','Building fund','Fonds de construction',${o.published ?? true})`);
    if (o.status !== "draft") await F.svc(H.db, `update public.church_giving_funds set status = '${o.status ?? "open"}' where id = '${id}'`);
    return id;
  };
  return { admin, provider, clock, paid, limiterCalls, deps, mkFund };
}
const body = (fund, o = {}) => ({ username: "grace-church", fund_id: fund, amount_xaf: 10000, phone: PHONE, medium: "mobile money", ...o });
const giftRow = async (id) => (await H.rows(`select status, provider_transaction_id, amount_xaf, fund_kind, is_anonymous, donor_name, payer_phone, confirmed_at from public.church_gifts where id = '${id}'`))[0];
const earningOf = async (id) => (await H.rows(`select gross_amount::int g, platform_fee::int f, net_amount::int nt, commission_rate::float r, status from public.church_gift_earnings where gift_id = '${id}'`));
const countGifts = async () => (await H.rows("select count(*)::int n from public.church_gifts"))[0].n;

section("A. pure rules: ");
{
  eq("500 XAF is the minimum, a whole number only", [RULES.parseGiftInput(body(F.id("4", 1), { amount_xaf: 499 }).amount_xaf && { fund_id: F.id("4", 1), amount_xaf: 499, phone: PHONE, medium: "mobile money" }).code, RULES.parseGiftInput({ fund_id: F.id("4", 1), amount_xaf: 500, phone: PHONE, medium: "mobile money" }).ok], ["amount_below_minimum", true]);
  for (const [label, v] of [["a decimal amount", 500.5], ["a string amount", "1000"], ["zero", 0], ["a negative amount", -1000], ["NaN", NaN], ["over the ceiling", 1_000_001]]) {
    check(`${label} is refused`, !RULES.parseGiftInput({ fund_id: F.id("4", 1), amount_xaf: v, phone: PHONE, medium: "mobile money" }).ok);
  }
  for (const k of ["profile_id", "church_id", "status", "commission_rate", "fee", "net_amount", "paid", "fund_kind", "is_paid", "currency"]) {
    const r = RULES.parseGiftInput({ fund_id: F.id("4", 1), amount_xaf: 1000, phone: PHONE, medium: "mobile money", [k]: 1 });
    check(`the client cannot send ${k}`, !r.ok && r.code === "invalid_request" && r.field === k, JSON.stringify(r));
  }
  check("a filled hidden field (a bot) is refused", !RULES.parseGiftInput({ fund_id: F.id("4", 1), amount_xaf: 1000, phone: PHONE, medium: "mobile money", website: "http://spam" }).ok);
  const anon = RULES.parseGiftInput({ fund_id: F.id("4", 1), amount_xaf: 1000, phone: "+237 6 70 12 34 56", medium: "orange money", is_anonymous: true, donor_name: "Jean", donor_contact: "x", donor_email: "a@b.cm", language: "fr" });
  check("an anonymous gift drops the name and the contact, keeps the email for the receipt, normalises the phone", anon.ok && anon.value.name === null && anon.value.contact === null && anon.value.email === "a@b.cm" && anon.value.phone === PHONE && anon.value.anonymous, JSON.stringify(anon));
  check("a bad phone, medium, email and language are refused", [{ phone: "12345" }, { medium: "visa" }, { donor_email: "nope" }, { language: "de" }].every((o) => !RULES.parseGiftInput({ fund_id: F.id("4", 1), amount_xaf: 1000, phone: PHONE, medium: "mobile money", ...o }).ok));
  eq("a receipt number is formatted", [RULES.formatGiftReceiptNumber(7), RULES.formatGiftReceiptNumber(0), RULES.formatGiftReceiptNumber("7")], ["CG-000007", null, null]);
  eq("the refund window is 48 hours from the confirmation", [RULES.refundWindowOpen("2026-11-02T10:00:00Z", Date.parse("2026-11-04T09:59:00Z")), RULES.refundWindowOpen("2026-11-02T10:00:00Z", Date.parse("2026-11-04T10:01:00Z")), RULES.refundWindowOpen(null, 0)], [true, false, false]);
  const e = RULES.computeGiftEarnings(10000, 0.05);
  eq("5% of 10000 XAF: fee 500, net 9500", [e.platformFee, e.net, e.gross, e.rate], [500, 9500, 10000, 0.05]);
  eq("XAF rounds half-up to a whole franc (555 x 5% = 27.75 -> 28; 10 x 5% = 0.5 -> 1)", [RULES.computeGiftEarnings(555, 0.05).platformFee, RULES.computeGiftEarnings(10, 0.05).platformFee], [28, 1]);
  check("unusable inputs give nothing", [[0, 0.05], [-5, 0.05], [10.5, 0.05], [100, 1.5], [100, -0.1], [100, NaN], ["100", 0.05]].every(([a, r]) => RULES.computeGiftEarnings(a, r) === null));
  check("gross is always fee + net", Array.from({ length: 300 }, (_, i) => 500 + i * 37).every((a) => { const x = RULES.computeGiftEarnings(a, 0.05); return x.gross === x.platformFee + x.net; }));
}

section("B. the TypeScript arithmetic equals the database function: ");
{
  const w = await world();
  const f = await w.mkFund();
  let mismatches = 0, tested = 0;
  for (const rate of [0.05, 0.07, 0.1, 0, 0.0333]) {
    await F.svc(H.db, `update public.platform_settings set church_giving_commission_rate = ${rate}`);
    for (const amount of [500, 501, 555, 999, 1000, 1010, 1234, 5555, 9999, 12345, 100000, 777777]) {
      const id = nid("5");
      await F.svc(H.db, `insert into public.church_gifts (id, profile_id, fund_id, fund_kind, amount_xaf, payer_phone, external_id, access_token_hash, expires_at) values ('${id}','${prof.c1}','${f}','giving',${amount},'${PHONE}','x-${id}','h', now() + interval '15 minutes')`);
      const out = (await H.rows(`select public.church_settle_gift('${id}', ${amount}) r`))[0].r;
      const sql = (await earningOf(id))[0];
      const ts = RULES.computeGiftEarnings(amount, rate);
      tested++;
      if (!out.earning || sql.f !== ts.platformFee || sql.nt !== ts.net) mismatches++;
    }
  }
  eq(`${tested} amount/rate pairs give the same fee and net in TypeScript and in SQL`, mismatches, 0);
}

section("C. starting a gift: ");
{
  const w = await world();
  const f = await w.mkFund();
  const r = await FLOW.startGift(w.deps, body(f, { donor_name: "Jean Mbarga", donor_email: "jean@x.cm", language: "fr" }), { clientKey: "1.2.3.4" });
  check("a valid gift starts", r.ok && r.data.gift_id && r.data.access_token && r.data.amount_xaf === 10000, JSON.stringify(r));
  const row = await giftRow(r.data.gift_id);
  check("it is PENDING with Fapshi's transaction id, never paid", row.status === "pending" && row.provider_transaction_id === "TX1" && row.confirmed_at === null, JSON.stringify(row));
  eq("Fapshi was asked once, for exactly the validated amount and number", [w.provider.payCalls.length, w.provider.payCalls[0].amount, w.provider.payCalls[0].phone, w.provider.payCalls[0].medium], [1, 10000, PHONE, "mobile money"]);
  check("the Fapshi reference we send is the gift's own", w.provider.payCalls[0].externalId === `cg-${r.data.gift_id}`);
  const stored = (await H.rows(`select access_token_hash h from public.church_gifts where id = '${r.data.gift_id}'`))[0].h;
  check("only the HASH of the token is stored", stored !== r.data.access_token && stored === FLOW.hashToken(r.data.access_token));
  eq("the limiter was asked about the client and the payer", w.limiterCalls.map((c) => c[0]), ["pay_ip", "pay_phone", "pay_phone_day"]);
  const anon = await FLOW.startGift(w.deps, body(f, { is_anonymous: true, donor_name: "Hidden", donor_contact: "secret" }));
  const arow = await giftRow(anon.data.gift_id);
  check("an anonymous gift stores no name; the payer phone is kept for reconciliation", arow.is_anonymous === true && arow.donor_name === null && arow.payer_phone === PHONE, JSON.stringify(arow));
  const care = await w.mkFund({ kind: "care" });
  const c = await FLOW.startGift(w.deps, body(care, { amount_xaf: 2000 }));
  eq("the kind of the gift comes from the FUND, not from the request", (await giftRow(c.data.gift_id)).fund_kind, "care");
}

section("D. what is refused, and that Fapshi is never called: ");
{
  const w = await world();
  const f = await w.mkFund();
  const other = await w.mkFund({ profile: prof.c2 });
  const draft = await w.mkFund({ status: "draft" });
  const closed = await w.mkFund({ status: "closed" });
  const hidden = await w.mkFund({ published: false });
  const cases = [
    ["a fund of ANOTHER church on this church's page", body(other), "fund_unavailable"],
    ["a draft fund", body(draft), "fund_unavailable"],
    ["a closed fund", body(closed), "fund_unavailable"],
    ["an unpublished fund", body(hidden), "fund_unavailable"],
    ["a fund that does not exist", body(F.id("4", 99999)), "fund_unavailable"],
    ["a page that does not exist", body(f, { username: "nobody-here" }), "church_unavailable"],
    ["a profile that is not a church", body(f, { username: "plain-user" }), "church_unavailable"],
    ["an amount under the minimum", body(f, { amount_xaf: 499 }), "amount_below_minimum"],
    ["a decimal amount", body(f, { amount_xaf: 1000.5 }), "invalid_amount"],
    ["a bad phone number", body(f, { phone: "123" }), "invalid_phone"],
    ["a client-supplied church id", body(f, { profile_id: prof.c2 }), "invalid_request"],
    ["a client-supplied status", body(f, { status: "succeeded" }), "invalid_request"],
    ["a client-supplied commission", body(f, { commission_rate: 0 }), "invalid_request"],
    ["no body", null, "invalid_request"],
  ];
  await F.svc(H.db, `update public.profiles set username = 'plain-user', category = 'other' where id = '${prof.nc}'`);
  for (const [label, b, code] of cases) {
    const r = await FLOW.startGift(w.deps, b);
    check(`${label} -> ${code}`, !r.ok && r.code === code, JSON.stringify(r));
  }
  eq("no gift was created and Fapshi was never called", [await countGifts(), w.provider.payCalls.length], [0, 0]);
  await F.svc(H.db, `update public.church_features set giving = false where profile_id = '${prof.c1}'`);
  const off = await FLOW.startGift(w.deps, body(f));
  check("giving switched off by the owner -> giving_unavailable", !off.ok && off.code === "giving_unavailable", JSON.stringify(off));
  await F.svc(H.db, `update public.church_features set giving = true where profile_id = '${prof.c1}'; update public.profiles set published = false where id = '${prof.c1}'`);
  const unpub = await FLOW.startGift(w.deps, body(f));
  check("an unpublished church page takes no gift", !unpub.ok && unpub.code === "church_unavailable", JSON.stringify(unpub));
  await F.svc(H.db, `update public.profiles set published = true where id = '${prof.c1}'; update public.platform_settings set fapshi_enabled = false`);
  const noFapshi = await FLOW.startGift(w.deps, body(f));
  check("Fapshi switched off by the platform -> giving_unavailable", !noFapshi.ok && noFapshi.code === "giving_unavailable", JSON.stringify(noFapshi));
  eq("still nothing created", [await countGifts(), w.provider.payCalls.length], [0, 0]);
}

section("E. collection CLOSED (the real state today): ");
{
  const w = await world({ open: false });
  await F.svc(H.db, "update public.platform_settings set fapshi_enabled = true");
  const f = await w.mkFund({ status: "draft" });
  const r = await FLOW.startGift(w.deps, body(f));
  check("every gift is refused while church_giving_collection_open() answers false", !r.ok && ["giving_unavailable", "fund_unavailable"].includes(r.code), JSON.stringify(r));
  eq("nothing was created and Fapshi was never called", [await countGifts(), w.provider.payCalls.length], [0, 0]);
}

section("F. paid ONLY by a Fapshi confirmation the server asked for: ");
{
  const w = await world();
  const f = await w.mkFund();
  const s = await FLOW.startGift(w.deps, body(f, { donor_name: "Jean", donor_email: "jean@x.cm" }));
  const id = s.data.gift_id, token = s.data.access_token;
  const pending = await FLOW.checkGift(w.deps, id, token);
  check("while Fapshi says CREATED the gift is pending and there is no receipt", pending.ok && pending.data.state === "pending" && !pending.data.receipt, JSON.stringify(pending));
  eq("no earning yet", (await earningOf(id)).length, 0);
  for (const [label, t] of [["a wrong token", "0".repeat(48)], ["no token", undefined], ["a short token", "abc"], ["another gift's token", (await FLOW.startGift(w.deps, body(f))).data.access_token]]) {
    const r = await FLOW.checkGift(w.deps, id, t);
    check(`${label} looks exactly like a missing gift`, !r.ok && r.code === "gift_not_found", JSON.stringify(r));
  }
  check("an unknown gift id and a non-uuid look the same", (await FLOW.checkGift(w.deps, F.id("5", 99999), token)).code === "gift_not_found" && (await FLOW.checkGift(w.deps, "not-a-uuid", token)).code === "gift_not_found");
  w.provider.plan.TX1 = { status: "SUCCESSFUL", amount: 10000 };
  w.clock.t += 60_000;
  const done = await FLOW.checkGift(w.deps, id, token);
  check("once Fapshi says SUCCESSFUL the gift is succeeded with a receipt", done.ok && done.data.state === "succeeded" && done.data.receipt, JSON.stringify(done));
  const rc = done.data.receipt;
  check("the receipt names the church, the fund, the amount, the date and a reference; the fee is zero (Ringo absorbs it)", rc.receipt_number?.startsWith("CG-") && rc.church_name === "Grace Church" && rc.fund_title_en === "Building fund" && rc.fund_title_fr === "Fonds de construction" && rc.amount_xaf === 10000 && rc.fee_xaf === 0 && rc.currency === "XAF" && rc.confirmed_at && rc.reference === `cg-${id}`, JSON.stringify(rc));
  check("the receipt shows no phone, no email, no token", !/670123456|jean@x\.cm|token|hash/i.test(JSON.stringify(done.data)));
  const e = await earningOf(id);
  check("one earning: 5% commission 500, church net 9500, the Fapshi fee is NOT deducted", e.length === 1 && e[0].g === 10000 && e[0].f === 500 && e[0].nt === 9500 && e[0].r === 0.05 && e[0].status === "recorded", JSON.stringify(e));
  eq("the receipt hook ran exactly once", w.paid, [id]);
  for (let i = 0; i < 3; i++) await FLOW.checkGift(w.deps, id, token);
  eq("three more checks: still one earning, still one receipt email", [(await earningOf(id)).length, w.paid.length], [1, 1]);
}

section("G. parallel and repeated checks settle once: ");
{
  const w = await world();
  const f = await w.mkFund();
  const s = await FLOW.startGift(w.deps, body(f));
  w.provider.plan.TX1 = { status: "SUCCESSFUL", amount: 10000 };
  const out = await Promise.all(Array.from({ length: 8 }, () => FLOW.checkGift(w.deps, s.data.gift_id, s.data.access_token)));
  check("eight simultaneous checks all answer succeeded", out.every((r) => r.ok && r.data.state === "succeeded"), JSON.stringify(out.map((r) => r.ok && r.data.state)));
  eq("exactly one earning and one receipt email", [(await earningOf(s.data.gift_id)).length, w.paid.length], [1, 1]);
  const settled = await Promise.all(Array.from({ length: 6 }, () => H.rows(`select public.church_settle_gift('${s.data.gift_id}', 10000) r`)));
  check("six direct settlements in parallel change nothing", settled.every((x) => x[0].r.status === "succeeded" && x[0].r.settled_now === false) && (await earningOf(s.data.gift_id)).length === 1);
}

section("H. failures, mismatches and late confirmations: ");
{
  const w = await world();
  const f = await w.mkFund();
  const a = await FLOW.startGift(w.deps, body(f));
  w.provider.plan.TX1 = { status: "FAILED", amount: null, reason: "insufficient funds" };
  const failed = await FLOW.checkGift(w.deps, a.data.gift_id, a.data.access_token);
  check("a failed payment is failed, with no receipt and no earning", failed.ok && failed.data.state === "failed" && !failed.data.receipt && (await earningOf(a.data.gift_id)).length === 0, JSON.stringify(failed));
  w.provider.plan.TX1 = { status: "SUCCESSFUL", amount: 10000 };
  const stays = await FLOW.checkGift(w.deps, a.data.gift_id, a.data.access_token);
  check("a recorded failure is final for the donor's page (Fapshi is not asked again about a failed attempt)", stays.ok && stays.data.state === "failed" && (await earningOf(a.data.gift_id)).length === 0, JSON.stringify(stays));
  const late = (await H.rows(`select public.church_settle_gift('${a.data.gift_id}', 10000) r`))[0].r;
  check("but if a success is ever reported for it (a direct settlement), it goes to a human (review), never straight to paid", late.status === "review" && (await giftRow(a.data.gift_id)).status === "payment_review" && (await earningOf(a.data.gift_id)).length === 0, JSON.stringify(late));

  const b = await FLOW.startGift(w.deps, body(f, { amount_xaf: 5000 }));
  w.provider.plan.TX2 = { status: "SUCCESSFUL", amount: 4000 };
  const mismatch = await FLOW.checkGift(w.deps, b.data.gift_id, b.data.access_token);
  check("an amount Fapshi reports that differs sends the gift to review", mismatch.ok && mismatch.data.state === "review" && (await earningOf(b.data.gift_id)).length === 0, JSON.stringify(mismatch));
  eq("it says why", (await H.rows(`select failure_reason r from public.church_gifts where id = '${b.data.gift_id}'`))[0].r, "provider_amount_mismatch");

  const c = await FLOW.startGift(w.deps, body(f));
  w.clock.t += 20 * 60_000;
  const expired = await FLOW.checkGift(w.deps, c.data.gift_id, c.data.access_token);
  check("a prompt nobody answered becomes expired after its window", expired.ok && expired.data.state === "expired", JSON.stringify(expired));
  w.provider.plan.TX3 = { status: "SUCCESSFUL", amount: 10000 };
  const lateOk = await FLOW.checkGift(w.deps, c.data.gift_id, c.data.access_token);
  check("a late confirmation of an EXPIRED attempt is honoured (the money is real)", lateOk.ok && lateOk.data.state === "succeeded" && (await earningOf(c.data.gift_id)).length === 1, JSON.stringify(lateOk));

  const d = await FLOW.startGift(w.deps, body(f));
  w.provider.failStatus = true;
  const unknown = await FLOW.checkGift(w.deps, d.data.gift_id, d.data.access_token);
  check("if Fapshi cannot be reached the gift simply stays pending", unknown.ok && unknown.data.state === "pending", JSON.stringify(unknown));
  w.provider.failStatus = false;

  w.provider.failPay = true;
  const before = await countGifts();
  const down = await FLOW.startGift(w.deps, body(f));
  check("if Fapshi refuses to start, the answer is payment_failed", !down.ok && down.code === "payment_failed", JSON.stringify(down));
  const downRow = (await H.rows("select status, failure_reason from public.church_gifts order by created_at desc, id desc limit 1"))[0];
  check("the attempt is recorded as failed (history is kept), never pending, never paid", (await countGifts()) === before + 1 && downRow.status === "failed" && downRow.failure_reason === "provider_error", JSON.stringify(downRow));
  w.provider.failPay = false;
}

section("I. polling respects Fapshi's per-transaction limit: ");
{
  const w = await world();
  w.deps.pollGate = POLL.createProviderPollGate();
  const f = await w.mkFund();
  const s = await FLOW.startGift(w.deps, body(f));
  await FLOW.checkGift(w.deps, s.data.gift_id, s.data.access_token);
  await FLOW.checkGift(w.deps, s.data.gift_id, s.data.access_token);
  await FLOW.checkGift(w.deps, s.data.gift_id, s.data.access_token);
  eq("three checks inside the minimum gap ask Fapshi once", w.provider.statusCalls.length, 1);
}

section("J. abuse limits: ");
{
  const w = await world();
  const f = await w.mkFund();
  w.deps.limiter = { async hit(kind) { return kind !== "pay_phone"; } };
  const r = await FLOW.startGift(w.deps, body(f));
  check("an exhausted limit refuses with rate_limited, creates nothing and prompts nobody", !r.ok && r.code === "rate_limited" && (await countGifts()) === 0 && w.provider.payCalls.length === 0, JSON.stringify(r));
  w.deps.limiter = { async hit() { throw new Error("limiter down"); } };
  const open = await FLOW.startGift(w.deps, body(f));
  check("a limiter outage fails OPEN (a genuine gift is never blocked)", open.ok, JSON.stringify(open));
}

section("K. refund requests are a record, not a payment: ");
{
  const w = await world();
  const f = await w.mkFund();
  const s = await FLOW.startGift(w.deps, body(f));
  const id = s.data.gift_id, t = s.data.access_token;
  const early = await FLOW.requestRefund(w.deps, id, t, "mistake");
  check("a gift that is not paid cannot be the subject of a refund request", !early.ok && early.code === "refund_not_available", JSON.stringify(early));
  w.provider.plan.TX1 = { status: "SUCCESSFUL", amount: 10000 };
  await FLOW.checkGift(w.deps, id, t);
  check("a wrong token is refused", (await FLOW.requestRefund(w.deps, id, "0".repeat(48), "mistake")).code === "gift_not_found");
  check("an empty or huge reason is refused", (await FLOW.requestRefund(w.deps, id, t, "   ")).code === "invalid_reason" && (await FLOW.requestRefund(w.deps, id, t, "x".repeat(501))).code === "invalid_reason");
  const ok1 = await FLOW.requestRefund(w.deps, id, t, "I gave the wrong amount");
  check("inside the window the request is recorded", ok1.ok && ok1.data.status === "requested", JSON.stringify(ok1));
  check("asking again is harmless (one open request)", (await FLOW.requestRefund(w.deps, id, t, "again")).ok && (await H.rows("select count(*)::int n from public.church_gift_refund_requests"))[0].n === 1);
  eq("NO money moved: the gift is still succeeded, the earning still recorded, Fapshi never asked to refund", [(await giftRow(id)).status, (await earningOf(id))[0].status, w.provider.payCalls.length], ["succeeded", "recorded", 1]);
  const rid = (await H.rows("select id from public.church_gift_refund_requests"))[0].id;
  const approved = (await H.rows(`select (public.church_gift_refund_decide('${rid}', 'refunded', '${u.admin}', 'returned by hand')).status s`))[0].s;
  eq("an administrator records the manual refund", [approved, (await giftRow(id)).status, (await earningOf(id))[0].status], ["refunded", "refunded", "reversed"]);
  const view = await FLOW.checkGift(w.deps, id, t);
  check("the donor then sees the gift as refunded, with no receipt", view.ok && view.data.state === "refunded" && !view.data.receipt, JSON.stringify(view));
  const s2 = await FLOW.startGift(w.deps, body(f));
  w.provider.plan.TX2 = { status: "SUCCESSFUL", amount: 10000 };
  await FLOW.checkGift(w.deps, s2.data.gift_id, s2.data.access_token);
  w.clock.t += 49 * 3_600_000;
  const lateReq = await FLOW.requestRefund(w.deps, s2.data.gift_id, s2.data.access_token, "too late");
  check("after 48 hours the request is refused", !lateReq.ok && lateReq.code === "refund_window_closed", JSON.stringify(lateReq));
}

section("L. the reconciliation sweep: ");
{
  const w = await world();
  const f = await w.mkFund();
  const f2 = await w.mkFund({ profile: prof.c2 });
  const a = await FLOW.startGift(w.deps, body(f));
  const b = await FLOW.startGift(w.deps, body(f));
  const c = await FLOW.startGift(w.deps, body(f));
  const o = await FLOW.startGift(w.deps, body(f2, { username: "other-church" }));
  w.provider.plan.TX1 = { status: "SUCCESSFUL", amount: 10000 };
  w.provider.plan.TX2 = { status: "FAILED", amount: null };
  w.provider.plan.TX4 = { status: "SUCCESSFUL", amount: 10000 };
  const sweep = await FLOW.reconcileGifts(w.deps, { profileId: prof.c1 });
  check("the sweep settles what Fapshi confirmed, records what failed, leaves the rest pending", sweep.checked === 3 && sweep.settled === 1 && sweep.failed === 1 && sweep.stillPending === 1, JSON.stringify(sweep));
  eq("the other church's gift was not touched by a sweep scoped to this church", (await giftRow(o.data.gift_id)).status, "pending");
  eq("the confirmed gift has its earning although the donor never came back", (await earningOf(a.data.gift_id)).length, 1);
  const all = await FLOW.reconcileGifts(w.deps, {});
  check("an unscoped sweep (administrators) settles the other church's gift too", all.settled >= 1 && (await giftRow(o.data.gift_id)).status === "succeeded", JSON.stringify(all));
  const again = await FLOW.reconcileGifts(w.deps, {});
  eq("a repeated sweep creates no duplicate earning", (await H.rows("select count(*)::int n from public.church_gift_earnings"))[0].n, 2);
  void b; void c;
}

section("M. the dashboard: who sees what ");
{
  const w = await world();
  const f = await w.mkFund();
  const f2 = await w.mkFund({ profile: prof.c2 });
  const mk = async (fund, o = {}, username = "grace-church", plan = "SUCCESSFUL") => {
    const s = await FLOW.startGift(w.deps, body(fund, { username, ...o }));
    w.provider.plan[`TX${w.provider.next}`] = { status: plan, amount: o.amount_xaf ?? 10000 };
    await FLOW.checkGift(w.deps, s.data.gift_id, s.data.access_token);
    return s.data.gift_id;
  };
  const named = await mk(f, { donor_name: "Jean Mbarga", donor_contact: "jean@x.cm", donor_email: "jean@x.cm" });
  const anon = await mk(f, { is_anonymous: true, amount_xaf: 4000 });
  await mk(f, { amount_xaf: 3000 }, "grace-church", "FAILED");
  const theirs = await mk(f2, { donor_name: "Other Donor" }, "other-church");

  const owner = await H.call(u.owner1, "GET", "church/gifts");
  is("the owner reads the gifts", owner, 200, "ok");
  eq("the owner sees THIS church's 3 gifts only", owner.body.items.map((g) => g.id).sort(), [named, anon, owner.body.items.find((g) => g.status === "failed").id].sort());
  check("the other church's gift never appears", !JSON.stringify(owner.body).includes(theirs) && !JSON.stringify(owner.body).includes("Other Donor"));
  const seenNamed = owner.body.items.find((g) => g.id === named), seenAnon = owner.body.items.find((g) => g.id === anon);
  check("a named donor's name and contact are shown; an anonymous gift shows none", seenNamed.donor_name === "Jean Mbarga" && seenNamed.donor_contact === "jean@x.cm" && seenAnon.donor_name === null && seenAnon.donor_contact === null && seenAnon.is_anonymous === true);
  const shown = JSON.stringify(owner.body).replace(/"donor_contact":"jean@x\.cm"/, "");
  check("no payer phone, no email, no token anywhere in the answer", !shown.includes(PHONE) && !shown.includes("jean@x.cm") && !/payer_phone|donor_email|access_token|token_hash/.test(shown), shown.slice(0, 200));
  const rep = owner.body.report;
  check("the report: 2 paid gifts of 14000 XAF, 1 failed; the owner sees fee 700 and net 13300", rep.paid.count === 2 && rep.paid.gross === 14000 && rep.failed === 1 && rep.earnings.fee === 700 && rep.earnings.net === 13300 && rep.reconciliation.ok === true, JSON.stringify(rep));
  eq("the application flag is on: the dashboard is told", owner.body.giving_available, true);

  const staff = await H.call(MANAGER, "GET", "church/gifts");
  is("a giving manager reads the gifts", staff, 200, "ok");
  check("...but not the commission, the fee or the net (money is owner-only)", staff.body.report.earnings === null && staff.body.items.length === 3);
  is("a members manager without giving rights is refused", await H.call(VIEWER, "GET", "church/gifts"), 403);
  is("a stranger is refused", await H.call(u.stranger, "GET", "church/gifts"), 403);
  is("a platform admin who is not the owner is refused", await H.call(u.admin, "GET", "church/gifts"), 403);
  is("anonymous is refused", await H.call(null, "GET", "church/gifts"), 401);
  const o2 = await H.call(u.owner2, "GET", "church/gifts");
  eq("the other church's owner sees only their own gift", o2.body.items.map((g) => g.id), [theirs]);

  is("a bad date is refused", await H.call(u.owner1, "GET", "church/gifts?from=2026-13-40"), 400, "invalid_range");
  is("an inverted range is refused", await H.call(u.owner1, "GET", "church/gifts?from=2026-12-01&to=2026-11-01"), 400, "invalid_range");
  is("an unknown parameter is refused", await H.call(u.owner1, "GET", "church/gifts?church=x"), 400);
  is("a bad status filter is refused", await H.call(u.owner1, "GET", "church/gifts?status=hacked"), 400, "invalid_status");
  const failedOnly = await H.call(u.owner1, "GET", "church/gifts?status=failed");
  eq("the status filter works", failedOnly.body.items.map((g) => g.status), ["failed"]);
  const day = await H.call(u.owner1, "GET", "church/gifts?from=2099-01-01&to=2099-01-02");
  eq("a range that excludes today is empty", [day.body.items.length, day.body.report.paid.count], [0, 0]);
  eq("Douala day bounds are UTC+1", REPORTS.doualaDayBounds("2026-11-02", "2026-11-02"), { fromIso: "2026-11-01T23:00:00.000Z", toIso: "2026-11-02T22:59:59.999Z" });

  const bal = await H.call(u.owner1, "GET", "church/giving-payouts");
  check("the owner's balance: 13300 XAF is held for the hold period", bal.status === 200 && bal.body.balance.held === 13300 && bal.body.balance.available === 0, JSON.stringify(bal.body));
  is("a giving manager cannot read the balance", await H.call(MANAGER, "GET", "church/giving-payouts"), 403);
  is("a giving manager cannot request a payout", await H.call(MANAGER, "POST", "church/giving-payouts", { body: {} }), 403);
  const early = await H.call(u.owner1, "POST", "church/giving-payouts", { body: {} });
  is("the hold period blocks an early payout request", early, 409, "payout_below_minimum");
  await F.svc(H.db, "update public.church_gift_earnings set status = status"); // no-op: the guard still allows it
  await H.db.exec("alter table public.church_gift_earnings disable trigger church_gift_earnings_guard_trg; update public.church_gift_earnings set available_at = now() - interval '1 day'; alter table public.church_gift_earnings enable trigger church_gift_earnings_guard_trg;");
  await F.svc(H.db, "update public.platform_settings set church_min_payout_xaf = 5000");
  const asked = await H.call(u.owner1, "POST", "church/giving-payouts", { body: {} });
  check("after the hold the owner requests the 13300 XAF net", asked.status === 201 && Number(asked.body.payout.amount) === 13300, JSON.stringify(asked.body));
  const refunds = await H.call(MANAGER, "GET", "church/gift-refunds");
  is("a giving manager reads the refund requests", refunds, 200, "ok");
  is("another church cannot read this church's refund requests", await H.call(u.owner2, "GET", "church/gift-refunds"), 200);
  eq("...and gets none", (await H.call(u.owner2, "GET", "church/gift-refunds")).body.items, []);
}

section("N. reports: ");
{
  const gifts = [
    { id: "a", fund_kind: "giving", amount_xaf: 1000, status: "succeeded", created_at: "2026-11-02T10:00:00Z", confirmed_at: "2026-11-02T10:01:00Z" },
    { id: "b", fund_kind: "care", amount_xaf: 2000, status: "succeeded", created_at: "2026-11-02T10:00:00Z", confirmed_at: "2026-11-02T10:01:00Z" },
    { id: "c", fund_kind: "giving", amount_xaf: 500, status: "refunded", created_at: "2026-11-02T10:00:00Z", confirmed_at: "2026-11-02T10:01:00Z" },
    { id: "d", fund_kind: "giving", amount_xaf: 700, status: "pending", created_at: "2026-11-02T08:00:00Z", confirmed_at: null },
    { id: "e", fund_kind: "giving", amount_xaf: 800, status: "payment_review", created_at: "2026-11-02T10:00:00Z", confirmed_at: null },
    { id: "f", fund_kind: "giving", amount_xaf: 900, status: "failed", created_at: "2026-11-02T10:00:00Z", confirmed_at: null },
  ];
  const earnings = [{ gift_id: "a", gross_amount: "1000.00", platform_fee: "50.00", net_amount: "950.00", status: "recorded" }, { gift_id: "c", gross_amount: "500.00", platform_fee: "25.00", net_amount: "475.00", status: "reversed" }];
  const r = REPORTS.buildGivingReport(gifts, earnings, { nowMs: Date.parse("2026-11-02T10:30:00Z") });
  check("totals by status and kind", r.paid.count === 2 && r.paid.gross === 3000 && r.paid.by_kind.care.gross === 2000 && r.pending === 1 && r.failed === 1 && r.review === 1 && r.refunded.count === 1 && r.refunded.gross === 500, JSON.stringify(r));
  check("earnings count the live ones and show the reversed apart", r.earnings.fee === 50 && r.earnings.net === 950 && r.earnings.reversed === 475);
  eq("reconciliation names a review, a stale attempt and a paid gift with no earning", [r.reconciliation.review_ids, r.reconciliation.stale_pending_ids, r.reconciliation.paid_without_earning_ids, r.reconciliation.ok], [["e"], ["d"], ["b"], false]);
  const staff = REPORTS.buildGivingReport(gifts, null, { nowMs: Date.parse("2026-11-02T10:30:00Z") });
  check("without the earnings (staff) there is no money line and no earning check", staff.earnings === null && staff.reconciliation.paid_without_earning_ids === null);
}

section("O. the routes: ");
{
  const w = await world();
  const f = await w.mkFund();
  globalThis.__adminFactory = () => F.sessionFor(H.db, null, { role: "service_role" });
  const post = async (rel, init, params = {}) => { const mod = jiti(path.join(SRC, "app/api", rel, "route.ts")); const r = await mod.POST(new Request(`http://test.local/api/${rel}`, init), { params }); return { status: r.status, body: await r.json().catch(() => null) }; };
  const get = async (rel, qs = "", params = {}) => { const mod = jiti(path.join(SRC, "app/api", rel, "route.ts")); const r = await mod.GET(new Request(`http://test.local/api/${rel}${qs}`), { params }); return { status: r.status, body: await r.json().catch(() => null) }; };
  const json = { "content-type": "application/json" };
  globalThis.__sameOrigin = false;
  eq("a cross-site POST to start a gift is refused", (await post("public/church-gifts", { method: "POST", headers: json, body: JSON.stringify(body(f)) })).status, 403);
  globalThis.__sameOrigin = true;
  eq("a non-JSON POST is refused", (await post("public/church-gifts", { method: "POST", headers: { "content-type": "text/plain" }, body: "x" })).status, 415);
  eq("broken JSON is refused", (await post("public/church-gifts", { method: "POST", headers: json, body: "{" })).status, 400);
  eq("an oversized body is refused", (await post("public/church-gifts", { method: "POST", headers: json, body: JSON.stringify({ x: "y".repeat(5000) }) })).status, 413);
  const bad = await post("public/church-gifts", { method: "POST", headers: json, body: JSON.stringify({ ...body(f), status: "succeeded" }) });
  check("a client-supplied status is refused with a code and nothing else", bad.status === 400 && bad.body.error === "invalid_request" && !JSON.stringify(bad.body).includes("access_token"), JSON.stringify(bad));
  const unknown = await post("public/church-gifts", { method: "POST", headers: json, body: JSON.stringify(body(f, { username: "nobody-here" })) });
  eq("an unknown church is a 404 with a code", [unknown.status, unknown.body.error], [404, "church_unavailable"]);
  eq("none of that created a gift", await countGifts(), 0);

  const s = await FLOW.startGift(w.deps, body(f, { donor_email: "jean@x.cm" }));
  const id = s.data.gift_id, t = s.data.access_token;
  await H.rows(`select public.church_settle_gift('${id}', 10000)`);
  const wrong = await get("public/church-gifts/[id]", `?t=${"0".repeat(48)}`, { id });
  eq("the status with a wrong token is a plain 404", [wrong.status, wrong.body.error], [404, "gift_not_found"]);
  const right = await get("public/church-gifts/[id]", `?t=${t}`, { id });
  check("the status with the right token returns the receipt, and nothing about the payer", right.status === 200 && right.body.state === "succeeded" && right.body.receipt.receipt_number.startsWith("CG-") && !JSON.stringify(right.body).includes("jean@x.cm") && !JSON.stringify(right.body).includes(PHONE), JSON.stringify(right.body));
  const noTok = await get("public/church-gifts/[id]", "", { id });
  eq("no token is the same plain 404", noTok.status, 404);
  eq("a cross-site refund request is refused", (globalThis.__sameOrigin = false, (await post("public/church-gifts/[id]/refund-request", { method: "POST", headers: json, body: JSON.stringify({ t, reason: "x" }) }, { id })).status), 403);
  globalThis.__sameOrigin = true;
  const ref = await post("public/church-gifts/[id]/refund-request", { method: "POST", headers: json, body: JSON.stringify({ t, reason: "Wrong amount" }) }, { id });
  eq("a refund request with the token is recorded", [ref.status, ref.body.status], [201, "requested"]);

  const asUser = (user) => { globalThis.__churchSession = F.sessionFor(H.db, user); };
  asUser(u.owner1);
  eq("a church owner is refused on the administrator routes", [(await get("admin/church/gift-refunds")).status, (await get("admin/church/payouts")).status, (await post("admin/church/gifts-reconcile", { method: "POST" })).status], [403, 403, 403]);
  asUser(null);
  eq("an anonymous visitor is refused on the administrator routes", (await get("admin/church/gift-refunds")).status, 403);
  asUser(u.admin);
  const list = await get("admin/church/gift-refunds");
  eq("an administrator lists the requests (reason and amount, no payer phone or email)", [list.status, list.body.items.length, JSON.stringify(list.body).includes(PHONE), JSON.stringify(list.body).includes("jean@x.cm")], [200, 1, false, false]);
  const rid = list.body.items[0].id;
  eq("an invalid decision is refused", (await post("admin/church/gift-refunds/[id]", { method: "POST", headers: json, body: JSON.stringify({ decision: "pay_now" }) }, { id: rid })).status, 400);
  eq("an administrator approves the request", (await post("admin/church/gift-refunds/[id]", { method: "POST", headers: json, body: JSON.stringify({ decision: "approved", note: "ok" }) }, { id: rid })).status, 200);
  eq("approving moved no money", [(await giftRow(id)).status, (await earningOf(id))[0].status], ["succeeded", "recorded"]);
  eq("the administrator records the manual refund", (await post("admin/church/gift-refunds/[id]", { method: "POST", headers: json, body: JSON.stringify({ decision: "refunded" }) }, { id: rid })).status, 200);
  eq("the gift is refunded and the earning reversed", [(await giftRow(id)).status, (await earningOf(id))[0].status], ["refunded", "reversed"]);
  eq("deciding twice is a 409", (await post("admin/church/gift-refunds/[id]", { method: "POST", headers: json, body: JSON.stringify({ decision: "declined" }) }, { id: rid })).status, 409);

  asUser(u.admin);
  const sweep = await post("admin/church/gifts-reconcile", { method: "POST" });
  check("the administrator sweep runs and reports what is unaccounted for", sweep.status === 200 && sweep.body.ok === true && Array.isArray(sweep.body.paid_without_earning), JSON.stringify(sweep));
  globalThis.__adminFactory = null;
}

await H.close();
process.exit(summary());
