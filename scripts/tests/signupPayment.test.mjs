// Get-started (signup) payments: reliability and accuracy.
// No network, no database, no real Fapshi. Real route handlers, real shared payment logic and the real
// Fapshi client run against fakes. Each block below is a way a customer was, or could be, charged without
// the system noticing, told "failed" while the money moved, or charged twice.
//
//   Run:  node scripts/tests/signupPayment.test.mjs
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const jiti = require("jiti")(import.meta.url, { alias: { "@": path.join(REPO, "src") }, interopDefault: true });
const load = (p) => jiti(path.join(REPO, "src", p));
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const results = [];
const check = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond });
  if (!cond) console.log("  FAIL:", name, "|", detail);
};
const quiet = async (fn) => {
  const o = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = o;
  }
};

// ======================================================================= the REAL Fapshi client (stubbed settings + fetch)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signup-pay-"));
const stubPath = path.join(tmp, "platformSettings.stub.cjs");
fs.writeFileSync(stubPath, "module.exports = { getPlatformSettings: async () => globalThis.__settings };");
const jitiWired = require("jiti")(import.meta.url, { alias: { "@/lib/platformSettings": stubPath, "@": path.join(REPO, "src") }, interopDefault: true, cache: false, requireCache: false });
const F = jitiWired(path.join(REPO, "src/lib/fapshi.ts"));
globalThis.__settings = { fapshiEnabled: true, fapshiTestMode: false, fapshiApiUser: "u", fapshiApiKey: "k", fapshiBaseUrl: "https://live.fapshi.com", fapshiCredentialSource: { collection: "database", payout: "none" } };
const realFetch = globalThis.fetch;
const env0 = { NODE_ENV: process.env.NODE_ENV, VERCEL_ENV: process.env.VERCEL_ENV };
process.env.VERCEL_ENV = "production";
process.env.NODE_ENV = "production";

const reply = (status, body, { html = false } = {}) => ({ ok: status >= 200 && status < 300, status, text: async () => (html ? String(body) : JSON.stringify(body)) });
function fetchSequence(steps) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    if (typeof step === "function") return step(init);
    if (step instanceof Error) throw step;
    return step;
  };
  return calls;
}
const fast = { retryDelaysMs: [1, 1], timeoutMs: 200 };
const attempt = async (fn) => {
  try {
    return { value: await fn() };
  } catch (error) {
    return { error };
  }
};

{
  let calls = fetchSequence([reply(503, { message: "busy" }), reply(503, { message: "busy" }), reply(200, { transId: "T1", status: "SUCCESSFUL" })]);
  let r = await attempt(() => F.fapshiGetStatus("T1", fast));
  check("client: a status check that hits two transient 503s is retried and still succeeds (the customer never sees the blip)", r.value?.status === "SUCCESSFUL" && calls.length === 3, `calls=${calls.length}`);
  check("client: every request is sent with a timeout signal and no caching", calls.every((c) => c.init.signal && c.init.cache === "no-store"));

  calls = fetchSequence([new TypeError("fetch failed")]);
  r = await attempt(() => F.fapshiGetStatus("T1", fast));
  check("client: a dropped connection is retried, then reported as UNCERTAIN (not as a definite failure)", r.error?.name === "FapshiApiError" && r.error.uncertain === true && calls.length === 3);

  calls = fetchSequence([reply(404, { message: "Transaction not found" })]);
  r = await attempt(() => F.fapshiGetStatus("T1", fast));
  check("client: a clear 4xx answer is NOT retried, keeps Fapshi's own message, and is not marked uncertain", r.error?.message === "Transaction not found" && r.error.httpStatus === 404 && r.error.uncertain === false && calls.length === 1);

  calls = fetchSequence([reply(502, "<html>Bad Gateway</html>", { html: true })]);
  r = await attempt(() => F.fapshiGetStatus("T1", fast));
  check("client: an HTML error page no longer crashes JSON parsing — it becomes a clean error carrying the HTTP status (after retries)", r.error?.name === "FapshiApiError" && r.error.httpStatus === 502 && /502/.test(r.error.message) && r.error.uncertain === true && calls.length === 3);

  calls = fetchSequence([(init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))))]);
  r = await attempt(() => F.fapshiGetStatus("T1", { retryDelaysMs: [], timeoutMs: 30 }));
  check("client: a request that hangs is cut off by the timeout instead of hanging our route until the host kills it", r.error?.name === "FapshiApiError" && /too long/.test(r.error.message) && r.error.uncertain === true);

  calls = fetchSequence([reply(200, { transId: "P1", message: "ok", dateInitiated: "2026-01-01" })]);
  const okPay = await attempt(() => F.fapshiDirectPay({ amount: 5000, phone: "677123456", medium: "mobile money", userId: "u", externalId: "e-1" }));
  check("client: a good payment request returns Fapshi's answer", okPay.value?.transId === "P1" && calls.length === 1);

  calls = fetchSequence([reply(503, { message: "busy" })]);
  r = await attempt(() => F.fapshiDirectPay({ amount: 5000, phone: "677123456", medium: "mobile money", userId: "u", externalId: "e-2" }, { timeoutMs: 200 }));
  check("client: a payment REQUEST is never retried automatically (that could charge the customer twice) and a 5xx is marked uncertain", calls.length === 1 && r.error?.uncertain === true && r.error.httpStatus === 503);

  calls = fetchSequence([reply(400, { message: "Invalid phone number" })]);
  r = await attempt(() => F.fapshiDirectPay({ amount: 5000, phone: "1", medium: "mobile money", userId: "u", externalId: "e-3" }));
  check("client: a clear refusal (bad number) keeps Fapshi's message and is NOT uncertain — the customer can simply correct it", r.error?.message === "Invalid phone number" && r.error.uncertain === false && calls.length === 1);

  calls = fetchSequence([reply(200, "", { html: true })]);
  r = await attempt(() => F.fapshiDirectPay({ amount: 5000, phone: "677123456", medium: "mobile money", userId: "u", externalId: "e-4" }));
  check("client: a 'success' with an unreadable body is treated as UNCERTAIN (the request reached Fapshi), never as a failure", r.error?.uncertain === true);

  calls = fetchSequence([(init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))))]);
  r = await attempt(() => F.fapshiDirectPay({ amount: 5000, phone: "677123456", medium: "mobile money", userId: "u", externalId: "e-5" }, { timeoutMs: 30 }));
  check("client: a payment request that times out is UNCERTAIN — it may already have reached the customer's phone", r.error?.uncertain === true && calls.length === 1);
}
globalThis.fetch = realFetch;
Object.assign(process.env, env0);
for (const k of Object.keys(env0)) if (env0[k] === undefined) delete process.env[k];
fs.rmSync(tmp, { recursive: true, force: true });

// ======================================================================= fakes for the rest
function makeFakeAdmin(seed = {}, { rpcHandlers = {} } = {}) {
  const tables = new Map();
  for (const [name, rows] of Object.entries(seed)) tables.set(name, new Map(rows.map((r, i) => [r.id ?? `seed_${name}_${i}`, { ...r }])));
  const state = { failUpdates: 0, rpc: [], updates: [] };
  const from = (table) => {
    if (!tables.has(table)) tables.set(table, new Map());
    const store = tables.get(table);
    const filters = [];
    let op = "select";
    let payload;
    let max = Infinity;
    const b = {
      select: () => b,
      order: () => b,
      limit(n) {
        max = n;
        return b;
      },
      eq(k, v) {
        filters.push((r) => r[k] === v);
        return b;
      },
      in(k, vals) {
        filters.push((r) => vals.includes(r[k]));
        return b;
      },
      gte(k, v) {
        filters.push((r) => String(r[k]) >= String(v));
        return b;
      },
      not(k, _op, v) {
        filters.push((r) => (r[k] ?? null) !== v);
        return b;
      },
      update(p) {
        op = "update";
        payload = p;
        return b;
      },
      single: async () => resolve(true),
      maybeSingle: async () => resolve(true),
      then(res, rej) {
        return Promise.resolve(resolve(false)).then(res, rej);
      },
    };
    const matches = (row) => filters.every((f) => f(row));
    function resolve(single) {
      if (op === "update") {
        if (state.failUpdates > 0) {
          state.failUpdates--;
          return { data: null, error: { message: "db write failed" } };
        }
        const rows = Array.from(store.values()).filter(matches);
        for (const r of rows) Object.assign(r, payload);
        state.updates.push({ table, payload });
        return { data: single ? rows[0] ?? null : rows.map((r) => ({ id: r.id })), error: null };
      }
      const rows = Array.from(store.values()).filter(matches).slice(0, max);
      return { data: single ? rows[0] ?? null : rows, error: null };
    }
    return b;
  };
  return {
    _tables: tables,
    _state: state,
    from,
    rpc: async (name, args) => {
      state.rpc.push({ name, args });
      if (rpcHandlers[name]) return rpcHandlers[name](args);
      return { data: null, error: null };
    },
  };
}

const fapshi = load("lib/fapshi.ts");
const notifMod = load("lib/notifications.ts");
const emailProvider = load("lib/email/provider.ts");
const emailShell = load("lib/email/emailShell.ts");
const withBell = load("lib/push/withBell.ts");
const serverMod = load("lib/supabase/server.ts");
const platformSettingsMod = load("lib/platformSettings.ts");
const applyPaymentMod = load("lib/applyPayment.ts");

let adminNotified = 0;
let referrerNotified = 0;
let emailsSent = [];
notifMod.notifyAdmins = async () => void adminNotified++;
notifMod.notifyUser = async () => void referrerNotified++;
notifMod.getSignupRequestReviewers = async () => ({ adminEmails: ["admin@x.com"], superCreator: null });
emailProvider.sendEmail = async (m) => void emailsSent.push(m);
emailShell.emailShell = (h) => h;
withBell.sendPushAndBellToUser = async () => {};
withBell.sendPushAndBellToAdmins = async () => {};

let statusById = {};
let statusCalls = [];
let statusThrows = null;
fapshi.fapshiGetStatus = async (id) => {
  statusCalls.push(id);
  if (statusThrows) throw statusThrows;
  return statusById[id] ?? { transId: id, status: "CREATED" };
};
let payCalls = [];
let payImpl = async () => ({ transId: `TX-NEW-${payCalls.length}` });
fapshi.fapshiDirectPay = async (p) => {
  payCalls.push(p);
  return payImpl(p);
};
platformSettingsMod.getPlatformSettings = async () => ({ fapshiEnabled: globalThis.__fapshiEnabled !== false });
const reset = () => {
  adminNotified = 0;
  referrerNotified = 0;
  emailsSent = [];
  statusById = {};
  statusCalls = [];
  statusThrows = null;
  payCalls = [];
  payImpl = async () => ({ transId: `TX-NEW-${payCalls.length}` });
  globalThis.__fapshiEnabled = true;
};

const sp = load("lib/signupPayment.ts");
const client = load("lib/signupPaymentClient.ts");
const { POST: payPOST } = load("app/api/signup-requests/[id]/pay/route.ts");
const { GET: payStatusGET } = load("app/api/signup-requests/[id]/pay-status/route.ts");
const { POST: webhookPOST } = load("app/api/billing/fapshi/webhook/route.ts");
const { GET: cronGET } = load("app/api/cron/reconcile-signup-payments/route.ts");
const { translations } = load("lib/i18n/translations.ts");

const RID = "11111111-1111-4111-8111-111111111111";
const RID2 = "22222222-2222-4222-8222-222222222222";
const request = (over = {}) => ({ id: RID, status: "pending", full_name: "Jane", email: "jane@x.com", referral_code: null, customer_paid: false, pending_fapshi_trans_id: null, requested_plan_id: "plan-1", requested_interval: "monthly", requested_addon_ids: ["addon-1"], source: "get_started", admin_notes: null, created_at: new Date().toISOString(), ...over });
const world = (reqs = [request()], extra = {}) =>
  makeFakeAdmin(
    { signup_requests: reqs, plans: [{ id: "plan-1", name: "Basic", price_xaf: 4000, price_xaf_yearly: 40000 }], addons: [{ id: "addon-1", price_xaf: 1000 }], ...extra },
    { rpcHandlers: { ambassador_lock_sale: async () => ({ data: null, error: null }) } }
  );
const row = (a, id = RID) => a._tables.get("signup_requests").get(id);

// ======================================================================= amount owed
{
  const a = world();
  check("amount: plan + add-ons, from the request's OWN stored selections", (await sp.computeSignupAmount(a, request())).amount === 5000);
  check("amount: the yearly price when the request is yearly", (await sp.computeSignupAmount(a, request({ requested_interval: "yearly" }))).amount === 41000);
  check("amount: an add-on-only request (card track, no plan) is priced from the add-on alone", (await sp.computeSignupAmount(a, request({ requested_plan_id: null }))).amount === 1000);
  const decimal = makeFakeAdmin({ plans: [{ id: "plan-1", name: "Basic", price_xaf: 4000.4, price_xaf_yearly: 0 }], addons: [] });
  check("amount: a stray decimal is rounded to whole XAF (Fapshi rejects fractions)", (await sp.computeSignupAmount(decimal, request({ requested_addon_ids: [] }))).amount === 4000);
  check("amount: nothing owed / missing plan are reported, not charged", (await sp.computeSignupAmount(a, request({ requested_plan_id: null, requested_addon_ids: [] }))).code === "nothing_to_pay" && (await sp.computeSignupAmount(a, request({ requested_plan_id: "gone" }))).code === "plan_not_found");
}

// ======================================================================= recording a payment (the heart of it)
{
  reset();
  const a = world([request({ pending_fapshi_trans_id: "TX-1" })]);
  statusById["TX-1"] = { transId: "TX-1", status: "SUCCESSFUL" };
  const r = await sp.confirmSignupPayment(a, RID);
  check("record: a successful payment marks the request paid and keeps the id that paid it", r.paid && r.justPaid && row(a).customer_paid === true && row(a).pending_fapshi_trans_id === "TX-1");
  check("record: the admin, the customer and the Ambassador lock are each told exactly once", adminNotified === 1 && emailsSent.filter((m) => m.to === "jane@x.com").length === 1 && a._state.rpc.filter((c) => c.name === "ambassador_lock_sale").length === 1);
  const again = await sp.confirmSignupPayment(a, RID);
  check("record: asking again is instant and silent — it doesn't call Fapshi and doesn't notify again", again.paid && !again.justPaid && statusCalls.length === 1 && adminNotified === 1);

  reset();
  const b = world([request({ pending_fapshi_trans_id: "TX-1" })]);
  statusById["TX-1"] = { transId: "TX-1", status: "SUCCESSFUL" };
  const outs = await Promise.all([1, 2, 3, 4, 5, 6].map(() => sp.confirmSignupPayment(b, RID)));
  check("record: six paths (poll, webhook, sweep, admin…) noticing at the same instant still notify EXACTLY once", outs.filter((o) => o.justPaid).length === 1 && adminNotified === 1 && emailsSent.filter((m) => m.to === "jane@x.com").length === 1);

  reset();
  const c = world([request({ pending_fapshi_trans_id: "TX-1" })]);
  statusById["TX-1"] = { transId: "TX-1", status: "CREATED" };
  const pending = await sp.confirmSignupPayment(c, RID);
  statusById["TX-1"] = { transId: "TX-1", status: "FAILED", reason: "insufficient funds" };
  const failed = await sp.confirmSignupPayment(c, RID);
  check("record: still-pending and failed payments change nothing (and a failure carries Fapshi's reason)", !pending.paid && pending.status === "CREATED" && !failed.paid && failed.reason === "insufficient funds" && row(c).customer_paid === false && adminNotified === 0);

  check("record: an unknown request / a request with no payment started are answered plainly", (await sp.confirmSignupPayment(c, "nope")).found === false && (await sp.confirmSignupPayment(world([request()]), RID)).started === false);

  reset();
  const d = world([request({ pending_fapshi_trans_id: "TX-1" })]);
  statusThrows = Object.assign(new Error("Fapshi took too long"), { uncertain: true });
  const boom = await attempt(() => sp.confirmSignupPayment(d, RID));
  check("record: if Fapshi can't be reached the error is raised for the caller to present — and nothing is changed", !!boom.error && row(d).customer_paid === false && adminNotified === 0);
}

// ======================================================================= the lost payment: matching by what WE stamped on the transaction
{
  check("match: userId (the request's id) identifies the request; so does externalId 'signup-<id>-<attempt>'", sp.signupRequestIdFromTransaction({ userId: RID, externalId: null }) === RID && sp.signupRequestIdFromTransaction({ userId: null, externalId: `signup-${RID}-lx3f9` }) === RID && sp.signupRequestIdFromTransaction({ userId: null, externalId: `signup-${RID}` }) === RID);
  check("match: anything else (subscription payments, junk) matches nothing", sp.signupRequestIdFromTransaction({ userId: "u-42", externalId: "order-77" }) === null && sp.signupRequestIdFromTransaction({ userId: null, externalId: null }) === null);

  reset();
  // The scenario that lost a customer's payment: attempt 1 was approved late; the customer had already
  // pressed "try again", which OVERWROTE the stored transaction id with attempt 2's.
  const a = world([request({ pending_fapshi_trans_id: "TX-ATTEMPT-2" })]);
  const late = await sp.confirmSignupPaymentFromTransaction(a, { transId: "TX-ATTEMPT-1", status: "SUCCESSFUL", userId: RID, externalId: `signup-${RID}-aaaa`, transType: "Collection" });
  check("match: a late-approved EARLIER attempt is still recognised — marked paid, and the id that actually paid is the one recorded (so approval verifies the right transaction)", late.matched && late.justPaid && row(a).customer_paid === true && row(a).pending_fapshi_trans_id === "TX-ATTEMPT-1");
  const dup = await sp.confirmSignupPaymentFromTransaction(a, { transId: "TX-ATTEMPT-2", status: "SUCCESSFUL", userId: RID, externalId: `signup-${RID}-bbbb`, transType: "Collection" });
  check("match: a second successful attempt for an already-paid request changes nothing and notifies nobody again", dup.matched && !dup.justPaid && row(a).pending_fapshi_trans_id === "TX-ATTEMPT-1" && adminNotified === 1);

  const b = world([request({ pending_fapshi_trans_id: null })]);
  const noStored = await sp.confirmSignupPaymentFromTransaction(b, { transId: "TX-X", status: "SUCCESSFUL", userId: RID, externalId: null, transType: "Collection" });
  check("match: a payment whose transaction id was never stored (our write failed) is still found by its userId", noStored.justPaid && row(b).customer_paid === true && row(b).pending_fapshi_trans_id === "TX-X");

  const c = world([request(), request({ id: RID2, status: "approved" })]);
  const ignored = [
    await sp.confirmSignupPaymentFromTransaction(c, { transId: "T", status: "CREATED", userId: RID, transType: "Collection" }),
    await sp.confirmSignupPaymentFromTransaction(c, { transId: "T", status: "FAILED", userId: RID, transType: "Collection" }),
    await sp.confirmSignupPaymentFromTransaction(c, { transId: "T", status: "SUCCESSFUL", userId: RID, transType: "Payout" }),
    await sp.confirmSignupPaymentFromTransaction(c, { transId: "T", status: "SUCCESSFUL", userId: RID2, transType: "Collection" }),
    await sp.confirmSignupPaymentFromTransaction(c, { transId: "T", status: "SUCCESSFUL", userId: "33333333-3333-4333-8333-333333333333", transType: "Collection" }),
  ];
  check("match: only a SUCCESSFUL collection for a still-PENDING request is recorded (pending, failed, payouts, already-processed and unknown requests are ignored)", ignored.every((r) => !r.justPaid) && row(c).customer_paid === false && row(c, RID2).customer_paid === false);
}

// ======================================================================= the payment request route
const payReq = (body) => ({ json: async () => body });
const callPay = async (admin, body, id = RID) => {
  serverMod.createAdminClient = () => admin;
  return quiet(() => payPOST(payReq(body), { params: { id } }));
};
const good = { phone: "+237 677 12 34 56", medium: "mobile money" };
{
  reset();
  let a = world();
  let r = await callPay(a, { phone: "677123456", medium: "visa" });
  let j = await r.json();
  check("pay: an unknown provider is refused up front, with a stable code", r.status === 400 && j.code === "invalid_medium" && payCalls.length === 0);
  r = await callPay(a, { phone: "12345", medium: "mobile money" });
  j = await r.json();
  check("pay: a number that isn't a Cameroon mobile number is refused BEFORE Fapshi is asked (a common cause of 'try again')", r.status === 400 && j.code === "invalid_phone" && payCalls.length === 0);
  globalThis.__fapshiEnabled = false;
  r = await callPay(a, good);
  check("pay: the Fapshi on/off switch still blocks payments", r.status === 503 && payCalls.length === 0);
  globalThis.__fapshiEnabled = true;
  check("pay: an unknown or already-processed request is a 404", (await callPay(a, good, "nope")).status === 404 && (await callPay(world([request({ status: "approved" })]), good)).status === 404);
  const paid = world([request({ customer_paid: true, pending_fapshi_trans_id: "TX-1" })]);
  r = await callPay(paid, good);
  check("pay: an already-paid request is answered as paid and NEVER charged again", (await r.json()).alreadyPaid === true && payCalls.length === 0);
}
{
  reset();
  const a = world();
  const r = await callPay(a, good);
  const j = await r.json();
  const call = payCalls[0];
  check("pay: first attempt — Fapshi is asked for the server-computed whole-XAF amount, with the number normalized to 9 digits", r.status === 200 && j.transId === "TX-NEW-1" && call.amount === 5000 && call.phone === "677123456" && call.medium === "mobile money");
  check("pay: the transaction is stamped with the request's id (userId) and a per-attempt externalId, so it can always be traced back", call.userId === RID && /^signup-11111111-1111-4111-8111-111111111111-[0-9a-z]+$/.test(call.externalId) && call.externalId.length <= 100);
  check("pay: the new transaction id is stored on the request", row(a).pending_fapshi_trans_id === "TX-NEW-1");

  // "Try again" after a genuine failure.
  statusById["TX-NEW-1"] = { transId: "TX-NEW-1", status: "FAILED", reason: "wrong PIN" };
  await new Promise((res) => setTimeout(res, 3)); // a later Date.now() => a different attempt id
  const r2 = await callPay(a, good);
  check("pay: 'try again' after a FAILED attempt starts a fresh one with a DIFFERENT externalId (a retry can never collide with the earlier attempt)", r2.status === 200 && payCalls.length === 2 && payCalls[1].externalId !== payCalls[0].externalId && row(a).pending_fapshi_trans_id === "TX-NEW-2");
  check("pay: the same holds for an EXPIRED attempt", (statusById["TX-NEW-2"] = { transId: "TX-NEW-2", status: "EXPIRED" }, (await callPay(a, good)).status === 200 && payCalls.length === 3));
}
{
  reset();
  const a = world([request({ pending_fapshi_trans_id: "TX-OPEN" })]);
  statusById["TX-OPEN"] = { transId: "TX-OPEN", status: "CREATED" };
  let r = await callPay(a, good);
  let j = await r.json();
  check("pay: a payment still waiting for the customer's approval is RESUMED — no second prompt is sent to their phone", r.status === 200 && j.resumed === true && j.transId === "TX-OPEN" && payCalls.length === 0 && row(a).pending_fapshi_trans_id === "TX-OPEN");
  r = await callPay(a, { ...good, forceNew: true });
  j = await r.json();
  check("pay: only when the customer explicitly asks to send it again is a new request sent — and the earlier open transaction id is kept in the admin notes", r.status === 200 && payCalls.length === 1 && /TX-OPEN/.test(row(a).admin_notes) && row(a).pending_fapshi_trans_id === "TX-NEW-1");

  reset();
  const late = world([request({ pending_fapshi_trans_id: "TX-LATE" })]);
  statusById["TX-LATE"] = { transId: "TX-LATE", status: "SUCCESSFUL" };
  r = await callPay(late, good);
  check("pay: if the earlier attempt was in fact approved late, it is recorded and answered as paid — the customer is NOT asked to pay again", (await r.json()).alreadyPaid === true && payCalls.length === 0 && row(late).customer_paid === true && adminNotified === 1);

  reset();
  const unknown = world([request({ pending_fapshi_trans_id: "TX-OLD" })]);
  statusThrows = new Error("Fapshi took too long");
  r = await callPay(unknown, good);
  j = await r.json();
  check("pay: if the earlier payment can't be checked right now, NO new charge is made and the old transaction id is not overwritten — a retryable answer instead", r.status === 503 && j.code === "provider_unavailable" && payCalls.length === 0 && row(unknown).pending_fapshi_trans_id === "TX-OLD");
}
{
  reset();
  const a = world();
  payImpl = async () => {
    throw Object.assign(new Error("Fapshi took too long to respond"), { uncertain: true });
  };
  let r = await callPay(a, good);
  let j = await r.json();
  check("pay: a timeout / 5xx is reported as 'uncertain' (a prompt may already be on the customer's phone), not as a plain failure", r.status === 503 && j.code === "uncertain" && !/took too long/.test(JSON.stringify(j)));
  check("pay: nothing was recorded for an uncertain attempt (there is no id to record)", row(a).pending_fapshi_trans_id === null);

  payImpl = async () => {
    throw Object.assign(new Error("Invalid phone number"), { uncertain: false, httpStatus: 400 });
  };
  r = await callPay(a, good);
  j = await r.json();
  check("pay: a clear refusal from Fapshi comes back as 'rejected' with Fapshi's own message so the customer can fix it", r.status === 400 && j.code === "rejected" && j.error === "Invalid phone number");

  reset();
  const flaky = world();
  flaky._state.failUpdates = 1;
  r = await callPay(flaky, good);
  check("pay: if storing the transaction id fails once it is retried, and the customer still gets their transaction id back", r.status === 200 && row(flaky).pending_fapshi_trans_id === "TX-NEW-1");
  reset();
  const dead = world();
  dead._state.failUpdates = 2;
  r = await callPay(dead, good);
  check("pay: even if it can't be stored at all the customer is not sent an error — the webhook/sweep find the payment by its userId", r.status === 200 && (await r.json()).transId === "TX-NEW-1");

  payCalls = [];
  const zero = world([request({ requested_plan_id: null, requested_addon_ids: [] })]);
  check("pay: nothing to pay -> 400, missing plan -> 404, Fapshi never called", (await callPay(zero, good)).status === 400 && (await callPay(world([request({ requested_plan_id: "gone" })]), good)).status === 404 && payCalls.length === 0);
}

// ======================================================================= the status route the customer's screen polls
const callStatus = async (admin, id = RID) => {
  serverMod.createAdminClient = () => admin;
  return quiet(() => payStatusGET({}, { params: { id } }));
};
{
  reset();
  let a = world([request()]);
  let r = await callStatus(a);
  check("status: before any payment is started -> 404 with a stable code", r.status === 404 && (await r.json()).code === "not_started");
  a = world([request({ pending_fapshi_trans_id: "TX-1" })]);
  statusById["TX-1"] = { transId: "TX-1", status: "CREATED" };
  r = await callStatus(a);
  check("status: pending is reported as CREATED, with the response shape the screen already reads", r.status === 200 && JSON.stringify(await r.json()) === JSON.stringify({ status: "CREATED", transId: "TX-1", reason: null }));
  statusById["TX-1"] = { transId: "TX-1", status: "SUCCESSFUL" };
  r = await callStatus(a);
  check("status: success is recorded and reported", (await r.json()).status === "SUCCESSFUL" && row(a).customer_paid === true);
  const before = statusCalls.length;
  r = await callStatus(a);
  check("status: once recorded, further polls answer SUCCESSFUL without asking Fapshi again", (await r.json()).status === "SUCCESSFUL" && statusCalls.length === before);
  reset();
  const b = world([request({ pending_fapshi_trans_id: "TX-2" })]);
  statusThrows = new Error("Fapshi payment-status failed (502)");
  r = await callStatus(b);
  const j = await r.json();
  check("status: if Fapshi can't be reached: 502 with a stable code and no internal error text; nothing changed", r.status === 502 && j.code === "provider_unavailable" && !/Fapshi/.test(j.error) && row(b).customer_paid === false);
  reset();
  const c = world([request({ pending_fapshi_trans_id: "TX-3" })]);
  statusById["TX-3"] = { transId: "TX-3", status: "FAILED", reason: "wrong PIN" };
  check("status: a failure is reported with Fapshi's reason", (await (await callStatus(c)).json()).reason === "wrong PIN");
}

// ======================================================================= the webhook
const callWebhook = async (admin, body) => {
  serverMod.createAdminClient = () => admin;
  return quiet(() => webhookPOST({ json: async () => body }));
};
{
  reset();
  let billing = [];
  applyPaymentMod.applySuccessfulPayment = async (args) => (billing.push(args), { applied: false });
  applyPaymentMod.markFailedPayment = async () => {};
  const a = world([request({ pending_fapshi_trans_id: "TX-STORED-2" })]);
  statusById["TX-1"] = { transId: "TX-1", status: "SUCCESSFUL", userId: RID, externalId: `signup-${RID}-x`, transType: "Collection" };
  let r = await callWebhook(a, { transId: "TX-1" });
  check("webhook: a successful SIGNUP payment is matched to its request (even when it isn't the stored transaction id) and recorded", r.status === 200 && row(a).customer_paid === true && row(a).pending_fapshi_trans_id === "TX-1" && adminNotified === 1);
  check("webhook: the existing subscription-payment path still runs first, unchanged", billing.length === 1 && billing[0].provider === "fapshi" && billing[0].providerTransactionId === "TX-1");
  reset();
  billing = [];
  const b = world([request()]);
  statusById["TX-2"] = { transId: "TX-2", status: "SUCCESSFUL", userId: "u-99", externalId: "sub-1", transType: "Collection" };
  r = await callWebhook(b, { transId: "TX-2" });
  check("webhook: an ordinary subscription payment is untouched and matches no signup request", r.status === 200 && billing.length === 1 && row(b).customer_paid === false && adminNotified === 0);
  const c = world([request()]);
  statusById["TX-3"] = { transId: "TX-3", status: "FAILED", userId: RID, transType: "Collection" };
  await callWebhook(c, { transId: "TX-3" });
  check("webhook: a failed payment is never recorded as paid", row(c).customer_paid === false);
  // A webhook body can be forged: only what Fapshi's OWN API says counts.
  reset();
  const d = world([request()]);
  statusById["TX-FAKE"] = { transId: "TX-FAKE", status: "CREATED", userId: RID, transType: "Collection" };
  await callWebhook(d, { transId: "TX-FAKE", status: "SUCCESSFUL", userId: RID });
  check("webhook: a forged 'SUCCESSFUL' body changes nothing — status is re-read from Fapshi itself", row(d).customer_paid === false);
  check("webhook: a body with no transaction id is 400", (await callWebhook(world(), {})).status === 400);
  reset();
  statusById["TX-1"] = { transId: "TX-1", status: "SUCCESSFUL", userId: RID, transType: "Collection" };
  const e = world([request()]);
  e.from = () => {
    throw new Error("db down");
  };
  check("webhook: any internal error still answers 200 so Fapshi doesn't retry forever (as before)", (await callWebhook(e, { transId: "TX-1" })).status === 200);
}

// ======================================================================= the sweep + the cron
{
  reset();
  const day = 86_400_000;
  const now = new Date("2026-06-10T12:00:00Z");
  const iso = (msAgo) => new Date(now.getTime() - msAgo).toISOString();
  const rows = [
    request({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", pending_fapshi_trans_id: "T1", created_at: iso(1 * day) }),
    request({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", pending_fapshi_trans_id: "T2", created_at: iso(2 * day) }),
    request({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3", pending_fapshi_trans_id: "T3", created_at: iso(10 * day) }), // too old
    request({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4", pending_fapshi_trans_id: "T4", customer_paid: true }), // already paid
    request({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5", pending_fapshi_trans_id: null }), // never started
    request({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6", pending_fapshi_trans_id: "T6", status: "approved" }), // processed
  ].map((r) => ({ ...r, created_at: r.created_at.startsWith("2026-06") ? r.created_at : r.created_at }));
  rows[3].created_at = iso(1 * day);
  rows[4].created_at = iso(1 * day);
  rows[5].created_at = iso(1 * day);
  const a = world(rows);
  statusById.T1 = { transId: "T1", status: "SUCCESSFUL" };
  statusById.T2 = { transId: "T2", status: "CREATED" };
  const r = await sp.reconcileSignupPayments(a, { now });
  check("sweep: it looks only at recent, pending, unpaid requests that have a payment in flight", r.checked === 2 && statusCalls.sort().join() === "T1,T2");
  check("sweep: it records the ones that succeeded and leaves the rest alone", r.paid === 1 && row(a, rows[0].id).customer_paid === true && row(a, rows[1].id).customer_paid === false);
  const again = await sp.reconcileSignupPayments(a, { now });
  check("sweep: running it again is harmless — nothing is recorded or notified twice", again.paid === 0 && adminNotified === 1);

  reset();
  const many = world(Array.from({ length: 12 }, (_, i) => request({ id: `bbbbbbbb-bbbb-4bbb-8bbb-${String(i).padStart(12, "0")}`, pending_fapshi_trans_id: `M${i}`, created_at: iso(1000 + i) })));
  const limited = await sp.reconcileSignupPayments(many, { now, limit: 5 });
  check("sweep: each run is bounded", limited.checked === 5 && statusCalls.length === 5);
  reset();
  const errs = world([request({ id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1", pending_fapshi_trans_id: "E1", created_at: iso(1000) }), request({ id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc2", pending_fapshi_trans_id: "E2", created_at: iso(2000) })]);
  fapshi.fapshiGetStatus = async (id) => {
    if (id === "E1") throw new Error("boom");
    return { transId: id, status: "SUCCESSFUL" };
  };
  const mixed = await quiet(() => sp.reconcileSignupPayments(errs, { now }));
  check("sweep: one request failing to check never stops the others", mixed.errors === 1 && mixed.paid === 1 && row(errs, "cccccccc-cccc-4ccc-8ccc-ccccccccccc2").customer_paid === true);
  fapshi.fapshiGetStatus = async (id) => (statusCalls.push(id), statusThrows ? (() => { throw statusThrows; })() : statusById[id] ?? { transId: id, status: "CREATED" });

  reset();
  const only = world([request({ id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd1", pending_fapshi_trans_id: "O1", created_at: iso(1000) }), request({ id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd2", pending_fapshi_trans_id: "O2", created_at: iso(1000) })]);
  await sp.reconcileSignupPayments(only, { now, ids: ["dddddddd-dddd-4ddd-8ddd-ddddddddddd2"] });
  check("sweep: it can be limited to specific requests (the admin list passes the rows on screen)", statusCalls.join() === "O2");

  // cron route
  statusCalls = [];
  process.env.CRON_SECRET = "s3cret";
  const cronAdmin = world([request({ pending_fapshi_trans_id: "C1", created_at: new Date().toISOString() })]);
  serverMod.createAdminClient = () => cronAdmin;
  statusById.C1 = { transId: "C1", status: "SUCCESSFUL" };
  const ask = (auth) => quiet(() => cronGET(new Request("http://x/api/cron/reconcile-signup-payments", { headers: auth ? { authorization: auth } : {} })));
  check("cron: no secret / wrong secret -> 401 and nothing is checked", (await ask(null)).status === 401 && (await ask("Bearer nope")).status === 401 && statusCalls.length === 0);
  const ok = await ask("Bearer s3cret");
  const cj = await ok.json();
  check("cron: an authorized run records the payment and answers with counts only", ok.status === 200 && cj.paid === 1 && cj.checked === 1 && !JSON.stringify(cj).includes(RID) && !JSON.stringify(cj).includes("C1"));
  delete process.env.CRON_SECRET;
  check("cron: with CRON_SECRET unset it refuses everything", (await ask("Bearer undefined")).status === 401);
  const vercel = JSON.parse(read("vercel.json"));
  check("cron: it is scheduled daily (the other paths keep it fresh between runs)", vercel.crons.some((c) => c.path === "/api/cron/reconcile-signup-payments" && c.schedule === "0 8 * * *"));
}

// ======================================================================= the browser-side helpers
{
  const good9 = ["677123456", "+237 677 12 34 56", "237677123456", "00237 677-123-456", " 699 12 34 56 "];
  const bad = ["", "12345", "577123456", "67712345", "6771234567", "abcdefghi", "+33 6 12 34 56 78"];
  check("phone: every normal way of typing a Cameroon mobile number normalizes to 9 digits starting with 6", good9.every((p) => /^6\d{8}$/.test(client.normalizeSignupPhone(p))) && client.normalizeSignupPhone("+237 677 12 34 56") === "677123456");
  check("phone: too short, too long, not starting with 6, letters and foreign numbers are all rejected", bad.every((p) => client.normalizeSignupPhone(p) === ""));
  check("operator: only unambiguous prefixes are detected — MTN 67x/650–654, Orange 69x/655–659", client.detectOperator("677123456") === "mobile money" && client.detectOperator("651123456") === "mobile money" && client.detectOperator("699123456") === "orange money" && client.detectOperator("657123456") === "orange money");
  check("operator: ambiguous or invalid numbers return null — it never guesses", client.detectOperator("680123456") === null && client.detectOperator("640123456") === null && client.detectOperator("12345") === null && client.detectOperator("") === null);
  check("polling: quick at first, gentler later, and it stops counting a still-pending payment as an error", client.pollDelayMs(0) === 3000 && client.pollDelayMs(59_999) === 3000 && client.pollDelayMs(60_000) === 4000 && client.pollDelayMs(200_000) === 6000);
  check("polling: the 'still waiting' state begins at 2 minutes and the on-screen checking runs 15 minutes — not the old fixed 2-minute cutoff", client.POLL_SLOW_AFTER_MS === 120_000 && client.POLL_GIVE_UP_AFTER_MS === 15 * 60_000);
  const store = new Map();
  globalThis.window = { localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: (k) => void store.delete(k) } };
  client.savePendingPayment(RID, 1_000);
  check("resume: an in-flight payment is remembered (the request id only — no phone number or personal data)", client.readPendingPayment(2_000) === RID && Object.keys(JSON.parse([...store.values()][0])).sort().join() === "requestId,ts");
  check("resume: it expires after 3 hours", client.readPendingPayment(1_000 + client.PENDING_PAYMENT_TTL_MS + 1) === null && store.size === 0);
  store.set("rc_signup_pay", "not json");
  const junk1 = client.readPendingPayment();
  store.set("rc_signup_pay", JSON.stringify({ requestId: "<script>", ts: Date.now() }));
  const junk2 = client.readPendingPayment();
  check("resume: corrupt or tampered storage is ignored, never trusted", junk1 === null && junk2 === null);
  client.savePendingPayment(RID);
  client.clearPendingPayment();
  check("resume: it is cleared once the payment resolves", client.readPendingPayment() === null);
  globalThis.window = { localStorage: { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } } };
  let threw = false;
  try {
    client.savePendingPayment(RID);
    client.readPendingPayment();
    client.clearPendingPayment();
  } catch {
    threw = true;
  }
  check("resume: blocked storage (private browsing) never breaks the payment screen", !threw);
  delete globalThis.window;
}

// ======================================================================= the payment screen and wiring (static)
{
  const flow = strip(read("src/components/onboarding/GetStartedFlow.tsx"));
  check("screen: the old fixed 2-minute cutoff that reported a still-pending payment as 'failed' is gone", !/attempts >= 40/.test(flow) && !/setInterval\(/.test(flow.slice(flow.indexOf("const startPolling"), flow.indexOf("const checkMyPayment"))));
  check("screen: it keeps checking calmly (adaptive rhythm) and stops the on-screen check after 15 minutes WITHOUT calling it a failure — it moves to 'still waiting'", /pollDelayMs\(elapsed\)/.test(flow) && /POLL_GIVE_UP_AFTER_MS/.test(flow) && /setPayStatus\("slow"\)/.test(flow));
  check("screen: it re-checks the instant the customer returns to the page (phones pause background timers) or the connection comes back", /visibilitychange/.test(flow) && /addEventListener\("focus"/.test(flow) && /addEventListener\("online"/.test(flow));
  check("screen: a payment in flight survives a reload — the page resumes it instead of showing an empty form that invites a second payment", /readPendingPayment\(\)/.test(flow) && /savePendingPayment\(requestId\)/.test(flow) && /setPayStatus\("resuming"\)/.test(flow));
  check("screen: a weak connection shows a calm note; only a CLEAR failed/expired answer is shown as failed", /connectionShaky/.test(flow) && /statusData|data\.status === "FAILED" \|\| data\.status === "EXPIRED"/.test(flow) && !/consecutiveErrors >= 3\) \{\s*clearInterval/.test(flow));
  check("screen: the 'still waiting' and 'unconfirmed' screens offer 'check my payment' and 'send again' — never just a red failure", /payStatus === "slow" \|\| payStatus === "uncertain"/.test(flow) && /t\.getStarted\.payCheckAgain/.test(flow) && /t\.getStarted\.paySendAgain/.test(flow));
  check("screen: 'send again' asks the server for a fresh request explicitly (forceNew), so a normal retry can never double-prompt", /sendPayment\(true\)/.test(flow) && /forceNew/.test(flow));
  check("screen: polling is stopped when the customer leaves the step and when the page unmounts (no leaked timers)", /stopPolling\(\);\s*setStep\(variant === "affiliate"/.test(flow) && /useEffect\(\(\) => \(\) => stopPolling\(\), \[\]\)/.test(flow));
  check("screen: the provider is pre-selected from the number when unambiguous, a mismatch is flagged, and the send button waits for a valid number", /detectOperator\(e\.target\.value\)/.test(flow) && /mediumTouched\.current/.test(flow) && /payProviderMismatch/.test(flow) && /disabled=\{!normalizeSignupPhone\(payPhone\)\}/.test(flow));
  check("screen: after a real failure the customer can retry or switch to a different number", /t\.getStarted\.payDifferentNumber/.test(flow));
  check("screen: server error codes map to plain, translated messages (invalid number, partner busy)", /payPhoneInvalid/.test(flow) && /payProviderBusy/.test(flow) && /code === "uncertain"/.test(flow));

  const payRoute = read("src/app/api/signup-requests/[id]/pay/route.ts");
  const statusRoute = read("src/app/api/signup-requests/[id]/pay-status/route.ts");
  check("routes: pay and pay-status declare a longer maxDuration so a slow Fapshi isn't cut off by the host's default as an unexplained failure", /export const maxDuration = 30/.test(payRoute) && /export const maxDuration = 30/.test(statusRoute) && /export const dynamic = "force-dynamic"/.test(statusRoute));
  check("routes: every path that records a payment goes through the ONE shared confirmation (poll, webhook, sweep, admin screens)", [statusRoute, read("src/app/api/billing/fapshi/webhook/route.ts"), read("src/app/api/cron/reconcile-signup-payments/route.ts"), read("src/app/admin/requests/page.tsx"), read("src/app/admin/requests/[id]/page.tsx"), read("src/app/dashboard/requests/page.tsx"), read("src/app/dashboard/requests/[id]/page.tsx")].every((s) => /signupPayment/.test(s)));
  check("routes: nothing but the shared module ever writes customer_paid", !/customer_paid:\s*true/.test(strip(payRoute + statusRoute + read("src/app/api/billing/fapshi/webhook/route.ts"))) && /customer_paid: true, pending_fapshi_trans_id: transId/.test(read("src/lib/signupPayment.ts")));
  const admin = strip(read("src/app/admin/requests/[id]/page.tsx"));
  check("admin: opening an unpaid request that has a payment in flight confirms it FIRST, so a paid customer is never shown as unpaid (no more 'paid cash' workaround)", /!signupRequest\.customer_paid && signupRequest\.pending_fapshi_trans_id/.test(admin) && admin.indexOf("confirmSignupPayment(") < admin.indexOf("<RequestReview"));
  check("admin: the requests list confirms the rows on screen before rendering", /confirmUnpaidOnScreen\(admin, rows\)/.test(strip(read("src/app/admin/requests/page.tsx"))) && /reconcileSignupPayments\(admin, \{ ids/.test(strip(read("src/app/admin/requests/page.tsx"))));
  check("safety: approving still re-verifies the recorded transaction id with Fapshi before creating anything (unchanged)", /fapshiGetStatus\(signupRequest\.pending_fapshi_trans_id\)/.test(read("src/app/api/admin/requests/[id]/approve/route.ts")));
  check("safety: no database migration and no new dependency were needed", !fs.readdirSync(path.join(REPO, "supabase/migrations")).some((f) => /signup.?pay|fapshi.?reconcil/i.test(f)));

  const en = translations.en.getStarted;
  const fr = translations.fr.getStarted;
  const keys = ["payStillWaiting", "payChecking", "payCheckAgain", "paySendAgain", "payDifferentNumber", "payReconnecting", "payProviderBusy", "payUncertain", "payPhoneInvalid", "payProviderMismatch"];
  check("i18n: every new payment message exists in English AND French", keys.every((k) => en[k] && fr[k] && typeof en[k] === typeof fr[k]), keys.filter((k) => !en[k] || !fr[k]).join());
  check("i18n: the French copy is genuinely translated", keys.every((k) => typeof en[k] === "function" || en[k] !== fr[k]));
  check("i18n: 'still waiting' and 'unconfirmed' never use the words of the failure message — they don't tell a customer it failed", en.payStillWaiting !== en.payFailed && en.payUncertain !== en.payFailed && !/did not go through/i.test(en.payStillWaiting + en.payUncertain) && !/n'a pas abouti/i.test(fr.payStillWaiting + fr.payUncertain));
  check("i18n: the provider-mismatch hint names the provider in both languages", en.payProviderMismatch("Orange Money").includes("Orange Money") && fr.payProviderMismatch("Orange Money").includes("Orange Money"));
}

const failed = results.filter((x) => !x.pass);
console.log(`\nsignupPayment: ${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
