// Ambassador Program — Phase B (payment confirmation + registration
// milestone) unit checks. No network, no real database, no real API key —
// jiti-loading real TypeScript source and a fake Supabase admin client,
// same conventions as the rest of this suite. The commission math itself
// is NOT faked here (that's the approved PostgreSQL functions' job,
// already validated against the migration SQL) — these tests only verify
// the application-code hook points call the right function, with the
// right arguments, at the right time, and never let Ambassador failures
// affect the existing payment/approval response.
//
//   Run:  node scripts/tests/ambassadorPhaseB.test.mjs
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const jiti = require("jiti")(import.meta.url, { alias: { "@": path.join(REPO, "src") }, interopDefault: true });
const load = (p) => jiti(path.join(REPO, "src", p));

const results = [];
const check = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond });
  if (!cond) console.log("  FAIL:", name, "|", detail);
};

// ------------------------------------------------------------------ generic fake Supabase admin client
// One shared Map-per-table store. Any table not explicitly seeded still
// behaves correctly (starts empty) — this is intentionally permissive so
// the approve route's many unrelated inserts (links/products/social_links/
// payment_transactions/admin_audit_log/...) never error, while the tables
// these tests actually assert on (signup_requests, ambassador_sales) are
// modeled precisely.
function makeFakeAdmin(seed = {}) {
  const tables = new Map();
  for (const [name, rows] of Object.entries(seed)) {
    tables.set(name, new Map(rows.map((r) => [r.id, { ...r }])));
  }
  const calls = { rpc: [] };
  let autoId = 1;

  const from = (table) => {
    if (!tables.has(table)) tables.set(table, new Map());
    const store = tables.get(table);
    const filters = [];
    let op = "select";
    let payload;
    const b = {
      select: () => b,
      order: () => b,
      limit: () => b,
      eq(k, v) {
        filters.push([k, v, null]);
        return b;
      },
      in(k, vals) {
        filters.push([k, "__in__", vals]);
        return b;
      },
      insert(p) {
        op = "insert";
        payload = Array.isArray(p) ? p : [p];
        return b;
      },
      update(p) {
        op = "update";
        payload = p;
        return b;
      },
      delete() {
        op = "delete";
        return b;
      },
      single: async () => resolve(true),
      maybeSingle: async () => resolve(true),
      then(res, rej) {
        return Promise.resolve(resolve(false)).then(res, rej);
      },
    };
    const matches = (row) => filters.every(([k, v, extra]) => (v === "__in__" ? extra.includes(row[k]) : row[k] === v));
    function resolve(single) {
      if (op === "insert") {
        const rows = payload.map((p) => ({ id: p.id || `auto_${autoId++}`, ...p }));
        for (const r of rows) store.set(r.id, r);
        return { data: single ? rows[0] : rows, error: null };
      }
      if (op === "update") {
        const rows = Array.from(store.values()).filter(matches);
        for (const r of rows) Object.assign(r, payload);
        return { data: single ? rows[0] ?? null : rows, error: null };
      }
      if (op === "delete") {
        const rows = Array.from(store.values()).filter(matches);
        for (const r of rows) store.delete(r.id);
        return { data: null, error: null };
      }
      const rows = Array.from(store.values()).filter(matches);
      return { data: single ? rows[0] ?? null : rows, error: null };
    }
    return b;
  };

  return {
    _tables: tables,
    _calls: calls,
    from,
    auth: { admin: { createUser: async () => ({ data: { user: { id: "user-new-1" } }, error: null }) } },
    rpc: async (name, args) => {
      calls.rpc.push({ name, args });
      const handler = makeFakeAdmin.rpcHandlers && makeFakeAdmin.rpcHandlers[name];
      if (handler) return handler(args);
      return { data: { ok: true }, error: null };
    },
  };
}

// ==================================================================
// PAY-STATUS route — payment confirmation hook
// ==================================================================
const fapshiMod = load("lib/fapshi.ts");
const notifMod = load("lib/notifications.ts");
const emailShellMod = load("lib/email/emailShell.ts");
const emailProviderMod = load("lib/email/provider.ts");
notifMod.notifyAdmins = async () => {};
notifMod.notifyUser = async () => {};
notifMod.getSignupRequestReviewers = async () => ({ adminEmails: [], superCreator: null });
emailShellMod.emailShell = () => "";
emailProviderMod.sendEmail = async () => ({ ok: true });

let payStatusResult = { status: "SUCCESSFUL", transId: "tx1", reason: null };
fapshiMod.fapshiGetStatus = async () => payStatusResult;

const serverMod = load("lib/supabase/server.ts");
const { GET: payStatusGET } = load("app/api/signup-requests/[id]/pay-status/route.ts");

const callPayStatus = async (id) => {
  const quiet = console.error;
  console.error = () => {};
  try {
    return await payStatusGET({}, { params: { id } });
  } finally {
    console.error = quiet;
  }
};

// 1 & 2: payment confirmation locks an attributed sale / no-attribution case unaffected
{
  payStatusResult = { status: "SUCCESSFUL", transId: "tx1", reason: null };

  const withSale = makeFakeAdmin({
    signup_requests: [{ id: "sr1", pending_fapshi_trans_id: "tx1", full_name: "Jane", email: "jane@x.com", referral_code: null, customer_paid: false }],
    ambassador_sales: [{ id: "sale1", signup_request_id: "sr1", ambassador_id: "amb1", team_id: null, status: "attributed" }],
  });
  serverMod.createAdminClient = () => withSale;
  const res1 = await callPayStatus("sr1");
  check("1. payment confirmation succeeds (200) with an attributed sale present", res1.status === 200);
  const lockCall = withSale._calls.rpc.find((c) => c.name === "ambassador_lock_sale");
  check("1b. ambassador_lock_sale is called with only the signup_request_id", lockCall && Object.keys(lockCall.args).length === 1 && lockCall.args.p_signup_request_id === "sr1", JSON.stringify(lockCall));
  check("1c. customer_paid is still flipped true regardless", withSale._tables.get("signup_requests").get("sr1").customer_paid === true);

  const withoutSale = makeFakeAdmin({
    signup_requests: [{ id: "sr2", pending_fapshi_trans_id: "tx1", full_name: "Bob", email: "bob@x.com", referral_code: null, customer_paid: false }],
  });
  serverMod.createAdminClient = () => withoutSale;
  const res2 = await callPayStatus("sr2");
  check("2. payment confirmation succeeds exactly the same with NO Ambassador attribution", res2.status === 200);
  check("2b. ambassador_lock_sale is still attempted unconditionally (its own SQL no-ops harmlessly)", withoutSale._calls.rpc.some((c) => c.name === "ambassador_lock_sale"));
  check("2c. customer_paid still flips true, unaffected", withoutSale._tables.get("signup_requests").get("sr2").customer_paid === true);
}

// 3: duplicate payment polling does not duplicate the lock attempt's effect
{
  payStatusResult = { status: "SUCCESSFUL", transId: "tx1", reason: null };
  const admin = makeFakeAdmin({
    signup_requests: [{ id: "sr3", pending_fapshi_trans_id: "tx1", full_name: "Jane", email: "jane@x.com", referral_code: null, customer_paid: false }],
    ambassador_sales: [{ id: "sale3", signup_request_id: "sr3", ambassador_id: "amb1", team_id: null, status: "attributed" }],
  });
  serverMod.createAdminClient = () => admin;

  await callPayStatus("sr3"); // first poll — real confirmation
  const firstLockCalls = admin._calls.rpc.filter((c) => c.name === "ambassador_lock_sale").length;
  await callPayStatus("sr3"); // second poll — same request, already paid
  const secondLockCalls = admin._calls.rpc.filter((c) => c.name === "ambassador_lock_sale").length;

  check("3. exactly one lock attempt on the real confirmation", firstLockCalls === 1);
  check("3b. a repeated poll on an already-paid request never attempts a second lock (justPaid guard)", secondLockCalls === 1, `first=${firstLockCalls} second=${secondLockCalls}`);
}

// 13: unexpected Ambassador DB failure never falsely reports payment failure
{
  payStatusResult = { status: "SUCCESSFUL", transId: "tx1", reason: null };
  makeFakeAdmin.rpcHandlers = { ambassador_lock_sale: async () => ({ data: null, error: { message: "connection reset" } }) };
  const admin = makeFakeAdmin({
    signup_requests: [{ id: "sr4", pending_fapshi_trans_id: "tx1", full_name: "Jane", email: "jane@x.com", referral_code: null, customer_paid: false }],
    ambassador_sales: [{ id: "sale4", signup_request_id: "sr4", ambassador_id: "amb1", team_id: null, status: "attributed" }],
  });
  serverMod.createAdminClient = () => admin;
  const res = await callPayStatus("sr4");
  const json = await res.json();
  check("13. an unexpected ambassador_lock_sale failure never turns payment confirmation into an error", res.status === 200 && json.status === "SUCCESSFUL", JSON.stringify(json));
  check("13b. customer_paid is still correctly recorded despite the Ambassador failure", admin._tables.get("signup_requests").get("sr4").customer_paid === true);
  makeFakeAdmin.rpcHandlers = null;
}

// ==================================================================
// APPROVE route — registration milestone hook
// ==================================================================
const assertAdminMod = load("lib/assertAdmin.ts");
assertAdminMod.assertCanApproveRequests = async () => ({ id: "admin-1", isAdmin: true, affiliateCode: null });
assertAdminMod.canReviewerAccessRequest = () => true;
const pushBellMod = load("lib/push/withBell.ts");
pushBellMod.sendPushAndBellToAdmins = async () => {};
const affiliateNotifyMod = load("lib/push/notifyAffiliateCommission.ts");
affiliateNotifyMod.notifyAffiliateCommissionIfAny = async () => {};
const cardBundleMod = load("lib/cardBundle.ts");
cardBundleMod.applyCardBundleGrant = async () => {};

const { POST: approvePOST } = load("app/api/admin/requests/[id]/approve/route.ts");

const APPROVE_BODY = {
  username: "janedoe",
  email: "jane@x.com",
  password: "hunter22",
  fullName: "Jane Doe",
  whatsappNumber: "+237600000000",
  planId: "plan-free",
  billingInterval: "monthly",
  paymentMethod: "none",
};

function seedApprove(extra = {}) {
  return makeFakeAdmin({
    signup_requests: [
      {
        id: "sr1",
        status: "pending",
        category: null,
        categories: [],
        referral_code: null,
        requested_addon_ids: [],
        requested_links: [],
        requested_products: [],
        requested_social_links: [],
        ...extra.signupRequest,
      },
    ],
    plans: [{ id: "plan-free", name: "Free", price_usd: 0, price_xaf: 0, price_usd_yearly: 0, price_xaf_yearly: 0, bookings_feature_enabled: false }],
    ambassador_sales: extra.ambassadorSale ? [extra.ambassadorSale] : [],
    profiles: [],
  });
}

const callApprove = async (admin, id = "sr1", body = APPROVE_BODY) => {
  serverMod.createAdminClient = () => admin;
  const req = { json: async () => body };
  const quiet = console.error;
  console.error = () => {};
  try {
    return await approvePOST(req, { params: { id } });
  } finally {
    console.error = quiet;
  }
};

// 4, 5: approval evaluates milestone 1; payment-before-approval (sale already locked) works
{
  const admin = seedApprove({ ambassadorSale: { id: "saleA", signup_request_id: "sr1", ambassador_id: "amb1", team_id: "team1", status: "locked" } });
  const res = await callApprove(admin);
  const json = await res.json();
  check("4. approval succeeds with an attributed, already-locked sale present", res.status === 200 && json.ok === true, JSON.stringify(json));
  const call = admin._calls.rpc.find((c) => c.name === "ambassador_evaluate_milestone_1");
  check("4b. ambassador_evaluate_milestone_1 is called", !!call);
  check(
    "5. payment-before-approval: called with the resolved sale_id + the newly created customer_user_id, nothing else",
    call && call.args.p_sale_id === "saleA" && call.args.p_customer_user_id === "user-new-1" && Object.keys(call.args).length === 2,
    JSON.stringify(call?.args)
  );
}

// 2 (approval side): approval with NO ambassador sale behaves exactly as before
{
  const admin = seedApprove();
  const res = await callApprove(admin);
  const json = await res.json();
  check("approve: succeeds exactly the same with no Ambassador attribution at all", res.status === 200 && json.ok === true);
  check("approve: milestone RPC is never called when there's no ambassador_sales row", !admin._calls.rpc.some((c) => c.name === "ambassador_evaluate_milestone_1"));
}

// 6: approval-after-payment — sale is 'attributed' but not yet 'locked' (payment hasn't
// actually confirmed yet, an edge case) — the database function itself is the authority on
// readiness; application code must not gate on this, it should still attempt the call.
{
  const admin = seedApprove({ ambassadorSale: { id: "saleB", signup_request_id: "sr1", ambassador_id: "amb1", team_id: null, status: "attributed" } });
  const res = await callApprove(admin);
  check("6. approval still succeeds even if the sale isn't locked yet (DB decides eligibility, not the route)", res.status === 200);
  check("6b. the route still attempts the call — it never pre-checks sale status itself", admin._calls.rpc.some((c) => c.name === "ambassador_evaluate_milestone_1"));
}

// 7: duplicate approval call — not realistically re-triggerable (status flips to 'approved',
// a second approve attempt 404s before reaching this code at all), but confirm that guard exists.
{
  const admin = seedApprove({ ambassadorSale: { id: "saleC", signup_request_id: "sr1", ambassador_id: "amb1", team_id: null, status: "locked" } });
  await callApprove(admin); // first approval
  const res2 = await callApprove(admin); // second attempt on the same, now-approved request
  const json2 = await res2.json();
  check("7. a second approval attempt on an already-approved request is rejected before any Ambassador call", res2.status === 404 && !json2.ok, JSON.stringify(json2));
  const milestoneCalls = admin._calls.rpc.filter((c) => c.name === "ambassador_evaluate_milestone_1").length;
  check("7b. exactly one milestone evaluation call total, not two", milestoneCalls === 1);
}

// 12: client cannot supply commission amount/percentage through either hook
{
  const admin = seedApprove({ ambassadorSale: { id: "saleD", signup_request_id: "sr1", ambassador_id: "amb1", team_id: "team1", status: "locked" } });
  await callApprove(admin, "sr1", { ...APPROVE_BODY, commission_amount: 999999, commission_percentage: 0.99, ambassador_share: 1 });
  const call = admin._calls.rpc.find((c) => c.name === "ambassador_evaluate_milestone_1");
  check("12. no commission amount/percentage field ever reaches the milestone RPC call", call && !("commission_amount" in call.args) && !("commission_percentage" in call.args) && !("percentage" in call.args), JSON.stringify(call?.args));
}

// 13 (approval side): unexpected Ambassador DB failure never rolls back a successful approval
{
  makeFakeAdmin.rpcHandlers = { ambassador_evaluate_milestone_1: async () => ({ data: null, error: { message: "unexpected failure" } }) };
  const admin = seedApprove({ ambassadorSale: { id: "saleE", signup_request_id: "sr1", ambassador_id: "amb1", team_id: null, status: "locked" } });
  const res = await callApprove(admin);
  const json = await res.json();
  check("13c. an unexpected milestone-1 failure never rolls back the account/approval", res.status === 200 && json.ok === true && json.userId === "user-new-1", JSON.stringify(json));
  check("13d. the signup request is still marked approved despite the Ambassador failure", admin._tables.get("signup_requests").get("sr1").status === "approved");
  makeFakeAdmin.rpcHandlers = null;
}

// 15: legacy affiliate isolation — the existing affiliate hook is untouched by any of this
{
  affiliateNotifyMod.notifyAffiliateCommissionIfAny = async (..._args) => {
    affiliateNotifyMod.__calledWith = _args;
  };
  affiliateNotifyMod.__calledWith = null;
  const admin = seedApprove({ ambassadorSale: { id: "saleF", signup_request_id: "sr1", ambassador_id: "amb1", team_id: null, status: "locked" } });
  await callApprove(admin, "sr1", { ...APPROVE_BODY, paymentMethod: "none" });
  check("15. notifyAffiliateCommissionIfAny still only fires under its own existing isPaidPlan+paymentTransactionId gate (Free plan here) — never called by Ambassador logic", affiliateNotifyMod.__calledWith === null);
}

const failed = results.filter((x) => !x.pass);
console.log(`\nambassadorPhaseB: ${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
