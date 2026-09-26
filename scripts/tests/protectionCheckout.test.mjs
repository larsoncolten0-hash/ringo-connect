// Ringo Protection — Phase 4 checkout/payment flow tests. Runs entirely against an IN-MEMORY world
// and a SCRIPTED fake Fapshi — no database, no network, no real payments. The in-memory tables mirror
// the rules the 2026-11-09 migration enforces (guarded status transitions, one live payment attempt
// per transaction) and reuse the REAL, unmodified Phase 2 engine (transitionProtectionTransaction) for
// every protection_transactions status change, exactly like productCheckout's own settlement tests
// exercise the real product_orders transition rules. Never touches Normal Payment's own code.
//   Run:  node scripts/tests/protectionCheckout.test.mjs
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO, "src");
const jiti = require("jiti")(import.meta.url, { alias: { "@": SRC }, interopDefault: true });
const L = (f) => jiti(path.join(SRC, "lib/protection", f));
const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8");

const { computeProtectionFee } = L("fee.ts");
const { createProtectionTransaction } = L("createTransaction.ts");
const { initiateProtectionPayment } = L("initiatePayment.ts");
const { checkProtectionPayment, settleProtectionPayment, normalizeProviderStatus } = L("checkPayment.ts");
const { checkProtectionEligibility } = L("checkoutEligibility.ts");
const { transitionProtectionTransaction } = L("engine.ts");

const results = [];
const check = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond });
  if (!cond) console.log("  FAIL:", name, "|", detail);
};
const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PROFILE = U(1),
  USER = U(101),
  CUSTOMER = U(201);

// ---------------------------------------------------------------- in-memory world

const ORDER_TRANSITIONS = {
  awaiting_payment: ["paid", "expired", "cancelled", "payment_review"],
  expired: ["paid", "payment_review"],
  cancelled: ["payment_review"],
  payment_review: ["paid", "refunded", "cancelled"],
  paid: ["fulfilled", "refunded", "payment_review"],
  fulfilled: ["refunded"],
  refunded: [],
};
const PAYMENT_TRANSITIONS = {
  initiated: ["pending", "succeeded", "failed", "expired", "cancelled"],
  pending: ["succeeded", "failed", "expired", "cancelled"],
  expired: ["succeeded"],
  cancelled: ["succeeded"],
  failed: [],
  succeeded: [],
};
const LIVE_PAYMENT = ["initiated", "pending"];

/** Generic admin-client emulation, backed by the SAME tables the hand-rolled store below reads/writes,
 *  used ONLY to drive the real, unmodified engine.transitionProtectionTransaction. */
function makeAdmin(tables) {
  function builder(table) {
    const filters = [];
    let mode = "select";
    let updatePatch = null;
    let insertRow = null;
    const matches = (row) => filters.every((f) => (f.op === "eq" ? row[f.col] === f.val : f.val.includes(row[f.col])));
    async function exec() {
      await Promise.resolve();
      if (mode === "insert") {
        const row = { id: `${table}_${tables[table].length}`, created_at: new Date().toISOString(), ...insertRow };
        tables[table].push(row);
        return { data: row, error: null };
      }
      const affected = tables[table].filter(matches);
      for (const row of affected) Object.assign(row, updatePatch);
      return { data: affected, error: null };
    }
    const self = {
      select() {
        if (mode === "update") return exec();
        return self;
      },
      eq(col, val) {
        filters.push({ col, op: "eq", val });
        return self;
      },
      in(col, val) {
        filters.push({ col, op: "in", val });
        return self;
      },
      update(patch) {
        mode = "update";
        updatePatch = patch;
        return self;
      },
      insert(row) {
        mode = "insert";
        insertRow = row;
        return self;
      },
      then(resolve, reject) {
        exec().then(resolve, reject);
      },
      async maybeSingle() {
        if (mode === "insert") return exec();
        const rows = tables[table].filter(matches);
        return { data: rows[0] ?? null, error: null };
      },
    };
    return self;
  }
  return { from: (t) => builder(t) };
}

function makeWorld(opts = {}) {
  const clock = { t: Date.parse("2026-11-09T10:00:00Z") };
  const now = () => new Date(clock.t);
  const copy = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));

  const tables = { protection_transactions: [], protection_transaction_events: [] };
  const db = {
    protection: { protectionEnabled: true, protectionFeeRate: 0.03, protectionAutoReleaseHours: 48, ...(opts.protection || {}) },
    commerce: { commerceEnabled: true, fapshiEnabled: true, ...(opts.commerce || {}) },
    profile: { id: PROFILE, user_id: USER, username: "shop", currency: "XAF", published: true, is_demo: false, category: "business_ecommerce", categories: [], ...(opts.profile || {}) },
    orders: new Map(),
    payments: [],
    seq: 0,
    releases: 0,
    logs: [],
    onProtectedCalls: [],
  };
  const admin = makeAdmin(tables);

  function seedOrder(overrides = {}) {
    db.seq += 1;
    const order = {
      id: U(1000 + db.seq),
      profile_id: PROFILE,
      customer_id: CUSTOMER,
      currency: "XAF",
      total: 10000,
      status: "awaiting_payment",
      expires_at: new Date(clock.t + 30 * 60000).toISOString(),
      paid_at: null,
      ...overrides,
    };
    db.orders.set(order.id, order);
    return order;
  }

  const store = {
    async getProtectionSettings() {
      return copy(db.protection);
    },
    async getCommerceSettings() {
      return copy(db.commerce);
    },
    async getOrder(id) {
      return copy(db.orders.get(id) || null);
    },
    async getProfile() {
      return copy(db.profile);
    },
    async updateOrder(id, patch, expect) {
      const o = db.orders.get(id);
      if (!o || o.status !== expect) return false;
      if (patch.status && patch.status !== o.status && !ORDER_TRANSITIONS[o.status].includes(patch.status)) throw new Error(`illegal order transition ${o.status} -> ${patch.status}`);
      Object.assign(o, patch);
      return true;
    },
    async releaseOrder(id, status) {
      const o = db.orders.get(id);
      if (!o || o.status !== "awaiting_payment") return false;
      if (status === "expired" && Date.parse(o.expires_at) > clock.t) return false;
      if (db.payments.some((p) => p.protection_transaction_id && LIVE_PAYMENT.includes(p.status) && Date.parse(p.expires_at) > clock.t && tables.protection_transactions.find((t) => t.id === p.protection_transaction_id)?.target_id === id)) return false;
      o.status = status;
      db.releases++;
      return true;
    },
    async getProtectionTransactionByOrder(orderId) {
      return copy(tables.protection_transactions.find((t) => t.target_id === orderId) || null);
    },
    async getProtectionTransaction(id) {
      return copy(tables.protection_transactions.find((t) => t.id === id) || null);
    },
    async insertProtectionTransaction(row) {
      if (tables.protection_transactions.some((t) => t.target_id === row.targetId)) return { ok: false, code: "exists" };
      const inserted = {
        id: U(5000 + tables.protection_transactions.length + 1),
        target_id: row.targetId,
        status: "awaiting_payment",
        profile_id: row.profileId,
        creator_user_id: row.creatorUserId,
        customer_id: row.customerId,
        currency: row.currency,
        product_amount: row.productAmount,
        protection_fee_rate: row.protectionFeeRate,
        protection_fee_amount: row.protectionFeeAmount,
        customer_total: row.customerTotal,
        seller_protected_amount: row.productAmount,
      };
      tables.protection_transactions.push(inserted);
      return { ok: true, row: copy(inserted) };
    },
    async listProtectionPayments(protectionTransactionId) {
      return copy(db.payments.filter((p) => p.protection_transaction_id === protectionTransactionId).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)));
    },
    async getProtectionPayment(id) {
      return copy(db.payments.find((p) => p.id === id) || null);
    },
    async insertProtectionPayment(row) {
      if (db.payments.some((p) => p.external_id === row.external_id)) throw new Error("dup external id");
      if (db.payments.some((p) => p.protection_transaction_id === row.protection_transaction_id && LIVE_PAYMENT.includes(p.status))) return { ok: false, reason: "duplicate_live" };
      db.payments.push({ ...row });
      return { ok: true };
    },
    async updateProtectionPayment(id, patch, expectStatuses) {
      const p = db.payments.find((x) => x.id === id);
      if (!p || !expectStatuses.includes(p.status)) return false;
      if (patch.status && patch.status !== p.status && !PAYMENT_TRANSITIONS[p.status].includes(patch.status)) throw new Error(`illegal payment transition ${p.status} -> ${patch.status}`);
      Object.assign(p, patch);
      return true;
    },
    async listReconcilableProtectionTransactionIds() {
      return [];
    },
  };

  let providerScript = opts.providerScript || { directPay: async () => ({ transId: "fake-trans-1" }), getStatus: async () => ({ status: "SUCCESSFUL", amount: null }) };
  const provider = {
    directPay: (...a) => providerScript.directPay(...a),
    getStatus: (...a) => providerScript.getStatus(...a),
  };

  const deps = {
    store,
    provider,
    now,
    newId: () => U(9000 + Math.floor(Math.random() * 100000)),
    log: (event, data) => db.logs.push({ event, data }),
    transition: (id, to, actor, txOpts) => transitionProtectionTransaction(admin, id, to, actor, txOpts),
    onProtected: async (info) => {
      db.onProtectedCalls.push(info);
    },
    pollGate: { tryAcquire: () => true },
  };

  return { db, tables, deps, seedOrder, setProvider: (s) => (providerScript = s), clock };
}

// ================================================================================ tests
(async () => {
  // ---------------------------------------------------------------- 1. Protection disabled / enabled
  {
    const { deps, seedOrder } = makeWorld({ protection: { protectionEnabled: false } });
    const order = seedOrder();
    const r = await createProtectionTransaction(deps, order.id);
    check("protection disabled -> protection_disabled", r.ok === false && r.code === "protection_disabled", JSON.stringify(r));
  }
  {
    const { deps, seedOrder } = makeWorld({ protection: { protectionFeeRate: null } });
    const order = seedOrder();
    const r = await createProtectionTransaction(deps, order.id);
    check("no fee rate configured -> protection_not_configured", r.ok === false && r.code === "protection_not_configured", JSON.stringify(r));
  }
  {
    const { deps, seedOrder } = makeWorld();
    const order = seedOrder();
    const r = await createProtectionTransaction(deps, order.id);
    check("protection enabled + configured -> transaction created", r.ok === true && r.data.status === "awaiting_payment", JSON.stringify(r));
  }

  // ---------------------------------------------------------------- 2. Fee calculation
  {
    const calc = computeProtectionFee(10000, 0.03);
    check("fee calc: 3% of 10000 = 300", calc && calc.feeAmount === 300 && calc.customerTotal === 10300, JSON.stringify(calc));
    check("fee calc rejects rate > 1", computeProtectionFee(10000, 1.5) === null);
    check("fee calc rejects non-positive amount", computeProtectionFee(0, 0.03) === null);
    check("fee calc never hard-codes 5% (uses whatever rate is passed)", computeProtectionFee(10000, 0.07).feeAmount === 700);
  }

  // ---------------------------------------------------------------- 3. Fee snapshot + total amount
  {
    const { deps, seedOrder } = makeWorld({ protection: { protectionFeeRate: 0.05 } });
    const order = seedOrder({ total: 20000 });
    const r = await createProtectionTransaction(deps, order.id);
    check("snapshot: productAmount = order.total", r.ok === true && r.data.productAmount === 20000);
    check("snapshot: feeRate = the rate at creation time", r.data.protectionFeeRate === 0.05);
    check("snapshot: feeAmount = 5% of 20000 = 1000", r.data.protectionFeeAmount === 1000);
    check("snapshot: customerTotal = product + fee = 21000", r.data.customerTotal === 21000);
  }

  // ---------------------------------------------------------------- 4. awaiting_payment creation is idempotent (no duplicate transaction/order)
  {
    const { deps, seedOrder, tables } = makeWorld();
    const order = seedOrder();
    const first = await createProtectionTransaction(deps, order.id);
    const second = await createProtectionTransaction(deps, order.id);
    check("duplicate checkout returns the SAME transaction id", first.ok && second.ok && first.data.id === second.data.id, JSON.stringify([first, second]));
    check("exactly one protection_transactions row exists for this order", tables.protection_transactions.filter((t) => t.target_id === order.id).length === 1);
  }

  // ---------------------------------------------------------------- 5. Successful payment -> protected, order paid, NO commerce_sale_earnings
  {
    const { deps, seedOrder, db } = makeWorld();
    const order = seedOrder({ total: 15000 });
    const created = await createProtectionTransaction(deps, order.id);
    const started = await initiateProtectionPayment(deps, created.data.id, { phone: "677123456", medium: "mobile money" });
    check("payment initiation succeeds", started.ok === true, JSON.stringify(started));

    const status = await checkProtectionPayment(deps, created.data.id);
    check("checkProtectionPayment settles a succeeded payment", status.ok === true && status.data.status === "succeeded", JSON.stringify(status));
    check("protection transaction is now `protected`", db.orders.get(order.id).status === "paid");
    check("underlying order flips to `paid` with paid_at set", db.orders.get(order.id).paid_at != null);
    check("onProtected fired exactly once", db.onProtectedCalls.length === 1);
    check(
      "no commerce_sale_earnings write, insertEarning or ensureEarning call anywhere in the settlement path (structural)",
      !/\.from\(["']commerce_sale_earnings["']\)|insertEarning|ensureEarning/.test(read("src/lib/protection/checkPayment.ts"))
    );
  }

  // ---------------------------------------------------------------- 6. Failed payment does NOT become protected
  {
    const { deps, seedOrder, db } = makeWorld({ providerScript: { directPay: async () => ({ transId: "fake-trans-2" }), getStatus: async () => ({ status: "FAILED", amount: null, reason: "insufficient funds" }) } });
    const order = seedOrder();
    const created = await createProtectionTransaction(deps, order.id);
    await initiateProtectionPayment(deps, created.data.id, { phone: "677123456", medium: "mobile money" });
    const status = await checkProtectionPayment(deps, created.data.id);
    check("failed payment -> status failed", status.ok === true && status.data.status === "failed", JSON.stringify(status));
    check("transaction stays awaiting_payment (never protected)", status.data.transaction.status === "awaiting_payment");
    check("order stays awaiting_payment", db.orders.get(order.id).status === "awaiting_payment");
  }

  // ---------------------------------------------------------------- 7. Duplicate callback / repeated poll is idempotent
  {
    const { deps, seedOrder, db } = makeWorld();
    const order = seedOrder();
    const created = await createProtectionTransaction(deps, order.id);
    await initiateProtectionPayment(deps, created.data.id, { phone: "677123456", medium: "mobile money" });
    const s1 = await checkProtectionPayment(deps, created.data.id);
    const s2 = await checkProtectionPayment(deps, created.data.id);
    const s3 = await checkProtectionPayment(deps, created.data.id);
    check("repeated status checks all report succeeded", [s1, s2, s3].every((s) => s.ok && s.data.status === "succeeded"));
    check("onProtected still fired exactly once across 3 polls", db.onProtectedCalls.length === 1);
    check("order flipped to paid exactly once (idempotent)", db.orders.get(order.id).status === "paid");
  }

  // ---------------------------------------------------------------- 8. Historical transaction retains its original fee after settings change
  {
    const { deps, seedOrder } = makeWorld({ protection: { protectionFeeRate: 0.02 } });
    const order = seedOrder({ total: 50000 });
    const created = await createProtectionTransaction(deps, order.id);
    check("created at 2% -> fee 1000", created.data.protectionFeeAmount === 1000);
    // Admin changes the rate AFTER creation.
    deps.store.getProtectionSettings = async () => ({ protectionEnabled: true, protectionFeeRate: 0.2, protectionAutoReleaseHours: 48 });
    const resumed = await createProtectionTransaction(deps, order.id); // idempotent resume, not a recompute
    check("resuming the SAME transaction after a settings change still shows the ORIGINAL fee", resumed.ok === true && resumed.data.protectionFeeAmount === 1000, JSON.stringify(resumed));
  }

  // ---------------------------------------------------------------- 9. Invalid client-supplied amount cannot override the server amount (structural)
  {
    const initSrc = read("src/lib/protection/initiatePayment.ts");
    const createSrc = read("src/lib/protection/createTransaction.ts");
    check("initiateProtectionPayment never reads an amount/total from the request body", !/raw\.(amount|total|customer_total)/.test(initSrc));
    check("initiateProtectionPayment charges txn.customerTotal, never a client value", /Number\(txn\.customer_total\)/.test(initSrc));
    check("createProtectionTransaction never reads a fee/amount from the request body", !/orderId.*amount|body\.(amount|fee|total)/.test(createSrc));
  }

  // ---------------------------------------------------------------- 10. Client cannot supply an authoritative customer/profile id (structural)
  {
    const initSrc = read("src/lib/protection/initiatePayment.ts");
    const createSrc = read("src/lib/protection/createTransaction.ts");
    check("initiateProtectionPayment never destructures customerId/profileId from its raw input", !/raw\.(customer_id|profile_id)/.test(initSrc));
    check("createProtectionTransaction never destructures a customerId/profileId parameter from the caller", !/ctx\.(customerId|profileId)/.test(createSrc));
  }

  // ---------------------------------------------------------------- 11. Unauthorized status probing never mutates another transaction (ids are the only handle, mirrors Normal Payment's own model)
  {
    const { deps, seedOrder } = makeWorld();
    const orderA = seedOrder();
    const orderB = seedOrder();
    const txnA = await createProtectionTransaction(deps, orderA.id);
    const txnB = await createProtectionTransaction(deps, orderB.id);
    const probe = await checkProtectionPayment(deps, txnA.data.id);
    check("checking transaction A never changes transaction B", probe.ok === true && (await deps.store.getProtectionTransaction(txnB.data.id)).status === "awaiting_payment");
  }

  // ---------------------------------------------------------------- 12. Payment amount mismatch never protects the transaction (money safety)
  {
    const { deps, seedOrder, db } = makeWorld({ providerScript: { directPay: async () => ({ transId: "fake-trans-3" }), getStatus: async () => ({ status: "SUCCESSFUL", amount: 1 }) } }); // provider reports a mismatched amount
    const order = seedOrder({ total: 10000 });
    const created = await createProtectionTransaction(deps, order.id);
    await initiateProtectionPayment(deps, created.data.id, { phone: "677123456", medium: "mobile money" });
    const status = await checkProtectionPayment(deps, created.data.id);
    check("amount mismatch -> failed, never succeeded/protected", status.ok === true && status.data.status === "failed");
    check("mismatched transaction moves to payment_failed (logged for manual follow-up), not protected", status.data.transaction.status === "payment_failed");
    check("order never flips to paid on a mismatch", db.orders.get(order.id).status === "awaiting_payment");
  }

  // ---------------------------------------------------------------- 13. Eligibility gate mirrors Normal Payment's own platform/profile gates
  {
    const blockedMusic = checkProtectionEligibility({
      protection: { protectionEnabled: true, protectionFeeRate: 0.03, protectionAutoReleaseHours: 48 },
      commerce: { commerceEnabled: true, fapshiEnabled: true },
      profile: { id: PROFILE, user_id: USER, username: "x", currency: "XAF", published: true, is_demo: false, category: "music_entertainment", categories: [] },
      order: { id: U(1), profile_id: PROFILE, customer_id: null, currency: "XAF", total: 1000, status: "awaiting_payment", expires_at: new Date().toISOString(), paid_at: null },
    });
    check("music profile is never eligible for Protection", blockedMusic === "order_not_payable");
    const blockedFapshi = checkProtectionEligibility({
      protection: { protectionEnabled: true, protectionFeeRate: 0.03, protectionAutoReleaseHours: 48 },
      commerce: { commerceEnabled: true, fapshiEnabled: false },
      profile: { id: PROFILE, user_id: USER, username: "x", currency: "XAF", published: true, is_demo: false, category: null, categories: [] },
      order: { id: U(1), profile_id: PROFILE, customer_id: null, currency: "XAF", total: 1000, status: "awaiting_payment", expires_at: new Date().toISOString(), paid_at: null },
    });
    check("Fapshi disabled blocks Protection too (same collection service)", blockedFapshi === "payment_provider_unavailable");
  }

  // ---------------------------------------------------------------- 14. Normal Payment regression / isolation
  {
    const productCheckoutFiles = [
      "src/lib/productCheckout/createOrder.ts",
      "src/lib/productCheckout/initiatePayment.ts",
      "src/lib/productCheckout/checkPayment.ts",
      "src/lib/productCheckout/settlement.ts",
      "src/lib/productCheckout/http.ts",
      "src/lib/productCheckout/supabaseStore.ts",
    ];
    for (const f of productCheckoutFiles) {
      check(`${f} imports nothing from src/lib/protection`, !/from ["'].*\/protection\//.test(read(f)) && !/from ["']@\/lib\/protection/.test(read(f)), f);
    }
    check("ProductCheckout.tsx component file itself is untouched by Phase 4 (no protection import)", !/protection/i.test(read("src/components/checkout/ProductCheckout.tsx")));
    check("settlement.ts still creates exactly one commerce_sale_earnings insert call (unchanged)", (read("src/lib/productCheckout/settlement.ts").match(/insertEarning/g) || []).length >= 1);
  }

  // ---------------------------------------------------------------- 15. Money-movement gates (Phase 4 must not go live on its own)
  {
    const httpSrc = read("src/lib/protection/checkoutHttp.ts");
    check("protection checkout availability is server-computed from protection_enabled + a configured fee rate, never a client flag", /protectionEnabled/.test(read("src/lib/protectionSettings.ts")));
    check("the checkout page gates Protection on getCheckoutBlock === null AND protectionEnabled AND a configured fee rate", (() => {
      const pageSrc = read("src/app/[username]/item/[id]/checkout/page.tsx");
      return /block === null && protectionSettings\.protectionEnabled && protectionSettings\.protectionFeeRate !== null/.test(pageSrc);
    })());
    check("no refund adapter or fapshiPayout is ever called from the checkout lane", !/fapshiPayout|fapshiRefundAdapter/.test(httpSrc));
  }

  const passed = results.filter((r) => r.pass).length;
  console.log(`\nprotection_checkout: ${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
})();
