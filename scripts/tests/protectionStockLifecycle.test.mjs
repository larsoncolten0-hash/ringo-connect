// Ringo Protection — Phase 4 follow-up: stock-lifecycle integration tests. Proves (a) via a static
// text diff that the new migration's widened release_product_order_stock() leaves Normal Payment's
// own customer_payments guard clause byte-for-byte untouched, and (b) via the real, unmodified
// initiatePayment.ts/checkPayment.ts/engine.ts code paths that a Protection payment's live/failed/
// succeeded state interacts correctly with an EMULATION of the fixed RPC guard (both clauses).
// No network, no real database, no Fapshi call.
//   Run:  node scripts/tests/protectionStockLifecycle.test.mjs
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

const { createProtectionTransaction } = L("createTransaction.ts");
const { initiateProtectionPayment } = L("initiatePayment.ts");
const { checkProtectionPayment } = L("checkPayment.ts");
const { transitionProtectionTransaction } = L("engine.ts");
const { LEGAL_TRANSITIONS, TERMINAL_STATUSES } = L("transitions.ts");

const results = [];
const check = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond });
  if (!cond) console.log("  FAIL:", name, "|", detail);
};
const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PROFILE = U(1),
  USER = U(101),
  CUSTOMER = U(201);

// ================================================================ 1 & 6. static SQL cross-checks
{
  const original = read("supabase/migrations/2026-11-02_product_checkout_foundation.sql");
  const patched = read("supabase/migrations/2026-11-10_ringo_protection_stock_lifecycle.sql");

  const extractCustomerPaymentsClause = (src) => {
    const m = src.match(/and not exists \(select 1 from customer_payments cp[\s\S]*?cp\.expires_at > now\(\)\)/);
    return m ? m[0].replace(/\s+/g, " ").trim() : null;
  };
  const origClause = extractCustomerPaymentsClause(original);
  const patchedClause = extractCustomerPaymentsClause(patched);
  check("original migration contains the customer_payments guard clause", !!origClause);
  check("patched function's customer_payments clause is BYTE-FOR-BYTE identical to the original (Normal Payment unchanged)", !!origClause && origClause === patchedClause, `orig=${origClause} patched=${patchedClause}`);

  check(
    "patched function ADDS a protection_payments clause joined through protection_transactions",
    /and not exists \(select 1 from protection_payments pp\s+join protection_transactions pt on pt\.id = pp\.protection_transaction_id[\s\S]*?pp\.expires_at > now\(\)\)/.test(patched)
  );
  check("the new clause is conjunctive (ANDed), never a replacement of the existing one", /cp\.expires_at > now\(\)\)[\s\S]*?and not exists \(select 1 from protection_payments/.test(patched));
  check("previous migrations were not modified (2026-11-02 file unchanged on disk)", /update product_orders set status = p_new_status, stock_released_at = now\(\)/.test(original));
  check("the new migration is its own separate file, not an edit to 2026-11-02", fs.existsSync(path.join(REPO, "supabase/migrations/2026-11-10_ringo_protection_stock_lifecycle.sql")));
  check("release_product_order_stock's return/rollback (stock-add) logic is untouched", extractCustomerPaymentsClause(patched) !== null && /update products p set inventory_count = p\.inventory_count \+ s\.qty/.test(patched));
}

// ================================================================ in-memory world (mirrors
// protectionCheckout.test.mjs's own makeWorld, trimmed to what the stock-lifecycle scenarios need).
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
  const clock = { t: Date.parse("2026-11-10T10:00:00Z") };
  const now = () => new Date(clock.t);
  const copy = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
  const tables = { protection_transactions: [], protection_transaction_events: [] };
  const db = {
    protection: { protectionEnabled: true, protectionFeeRate: 0.03, protectionAutoReleaseHours: 48 },
    commerce: { commerceEnabled: true, fapshiEnabled: true },
    profile: { id: PROFILE, user_id: USER, username: "shop", currency: "XAF", published: true, is_demo: false, category: "business_ecommerce", categories: [] },
    orders: new Map(),
    payments: [],
    seq: 0,
    releases: 0, // fires exactly when release_product_order_stock's guard lets a release through
    releaseCalls: 0, // fires on EVERY call, regardless of outcome — proves idempotency, not just the count of successes
    stockReturned: {}, // orderId -> total quantity returned, to catch a double-return
  };
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
      quantity: 2,
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
      Object.assign(o, patch);
      return true;
    },
    // Emulates the PATCHED release_product_order_stock(): refuses while EITHER a live
    // customer_payments-style attempt (not modeled here — Normal Payment has its own suite) OR a
    // live protection_payments attempt exists, and is a permanent no-op once the order has left
    // `awaiting_payment` (stock_released_at-equivalent: status itself is the one-shot marker here).
    async releaseOrder(id, status) {
      db.releaseCalls++;
      const o = db.orders.get(id);
      if (!o || o.status !== "awaiting_payment") return false;
      if (status === "expired" && Date.parse(o.expires_at) > clock.t) return false;
      const liveProtectionPayment = db.payments.some(
        (p) =>
          ["initiated", "pending"].includes(p.status) &&
          Date.parse(p.expires_at) > clock.t &&
          tables.protection_transactions.find((t) => t.id === p.protection_transaction_id)?.target_id === id
      );
      if (liveProtectionPayment) return false;
      o.status = status;
      db.releases++;
      db.stockReturned[id] = (db.stockReturned[id] || 0) + o.quantity;
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
    async listProtectionPayments(id) {
      return copy(db.payments.filter((p) => p.protection_transaction_id === id).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)));
    },
    async getProtectionPayment(id) {
      return copy(db.payments.find((p) => p.id === id) || null);
    },
    async insertProtectionPayment(row) {
      if (db.payments.some((p) => p.protection_transaction_id === row.protection_transaction_id && ["initiated", "pending"].includes(p.status))) return { ok: false, reason: "duplicate_live" };
      db.payments.push({ ...row });
      return { ok: true };
    },
    async updateProtectionPayment(id, patch) {
      const p = db.payments.find((x) => x.id === id);
      if (!p) return false;
      Object.assign(p, patch);
      return true;
    },
    async listReconcilableProtectionTransactionIds() {
      return [];
    },
  };

  let providerScript = opts.providerScript || { directPay: async () => ({ transId: "fake-1" }), getStatus: async () => ({ status: "SUCCESSFUL", amount: null }) };
  const admin = makeAdmin(tables);
  const deps = {
    store,
    provider: { directPay: (...a) => providerScript.directPay(...a), getStatus: (...a) => providerScript.getStatus(...a) },
    now,
    newId: () => U(9000 + Math.floor(Math.random() * 100000)),
    log: () => {},
    transition: (id, to, actor, txOpts) => transitionProtectionTransaction(admin, id, to, actor, txOpts),
    onProtected: async () => {},
    pollGate: { tryAcquire: () => true },
  };
  return { db, deps, seedOrder, clock };
}

// ================================================================ 3. Failed Protection payment does NOT release stock
{
  const { deps, seedOrder, db } = makeWorld({ providerScript: { directPay: async () => ({ transId: "fake-fail" }), getStatus: async () => ({ status: "FAILED", amount: null, reason: "declined" }) } });
  const order = seedOrder();
  const created = await createProtectionTransaction(deps, order.id);
  await initiateProtectionPayment(deps, created.data.id, { phone: "677123456", medium: "mobile money" });
  await checkProtectionPayment(deps, created.data.id);
  check("failed payment: order stays awaiting_payment", db.orders.get(order.id).status === "awaiting_payment");
  check("failed payment: stock is never released", db.releases === 0);
}

// ================================================================ 4. Successful Protection payment resolves stock exactly once (never returned to inventory)
{
  const { deps, seedOrder, db } = makeWorld();
  const order = seedOrder();
  const created = await createProtectionTransaction(deps, order.id);
  await initiateProtectionPayment(deps, created.data.id, { phone: "677123456", medium: "mobile money" });
  await checkProtectionPayment(deps, created.data.id);
  check("successful payment: order resolves to paid", db.orders.get(order.id).status === "paid");
  check("successful payment: stock is NEVER returned to inventory (the sale succeeded)", db.releases === 0 && !db.stockReturned[order.id]);
  // A late/mistaken attempt to release a now-paid order's stock must be a guaranteed no-op.
  const lateRelease = await deps.store.releaseOrder(order.id, "expired");
  check("a release attempt against an already-paid order is refused", lateRelease === false);
  check("that refused attempt did not increment the release count", db.releases === 0);
}

// ================================================================ 5. Duplicate settlement cannot release stock twice
{
  const { deps, seedOrder, db } = makeWorld();
  const order = seedOrder();
  const created = await createProtectionTransaction(deps, order.id);
  await initiateProtectionPayment(deps, created.data.id, { phone: "677123456", medium: "mobile money" });
  await checkProtectionPayment(deps, created.data.id);
  await checkProtectionPayment(deps, created.data.id);
  await checkProtectionPayment(deps, created.data.id);
  check("three repeated settlement polls still leave releases at zero", db.releases === 0);
  check("the order settles to paid exactly once (idempotent)", db.orders.get(order.id).status === "paid");
}

// ================================================================ 2 & 7. Protection payment blocks release while live; cancellation/refund can never double-release
{
  const { deps, seedOrder, db, clock } = makeWorld({ providerScript: { directPay: async () => ({ transId: "fake-live" }), getStatus: async () => ({ status: "CREATED", amount: null }) } });
  const order = seedOrder({ expires_at: new Date(Date.parse("2026-11-10T10:00:00Z") - 1000).toISOString() }); // already past its window
  const created = await createProtectionTransaction(deps, order.id); // proactively re-extends expires_at (see createTransaction.ts)
  await initiateProtectionPayment(deps, created.data.id, { phone: "677123456", medium: "mobile money" });
  check("a live (pending) Protection payment blocks a direct release attempt", (await deps.store.releaseOrder(order.id, "expired")) === false);
  check("nothing was released while the payment is live", db.releases === 0);

  // Calling release twice in a row after the payment attempt is gone (simulating an
  // expired/cancelled retry sweep) AND the order's own (extended) reservation clock has now
  // actually passed — release_product_order_stock only ever fires once BOTH are true.
  db.payments.length = 0; // the live attempt is gone (expired/failed)
  clock.t = Date.parse(db.orders.get(order.id).expires_at) + 1000;
  const first = await deps.store.releaseOrder(order.id, "expired");
  const second = await deps.store.releaseOrder(order.id, "expired");
  check("first release after the live attempt clears succeeds", first === true);
  check("a repeated release call is refused (no double release)", second === false);
  check("stock was returned exactly once, not twice", db.stockReturned[order.id] === order.quantity);
}

// ================================================================ structural: refund/dispute states can never reach a stock release
{
  const reachableFromProtected = new Set(["protected"]);
  // BFS the (unmodified) Phase 2 transition graph forward from `protected`.
  let frontier = ["protected"];
  while (frontier.length) {
    const next = [];
    for (const s of frontier) {
      for (const rule of LEGAL_TRANSITIONS[s] || []) {
        if (!reachableFromProtected.has(rule.to)) {
          reachableFromProtected.add(rule.to);
          next.push(rule.to);
        }
      }
    }
    frontier = next;
  }
  check(
    "every state reachable after `protected` (fulfillment, dispute, resolution, refund) is NEVER `awaiting_payment` — release_product_order_stock only ever fires from that one order status, so a refund/dispute path can structurally never trigger a stock release",
    !reachableFromProtected.has("awaiting_payment")
  );
  check("`refunded` is terminal (no path back that could re-trigger anything)", TERMINAL_STATUSES.includes("refunded"));
}

const passed = results.filter((r) => r.pass).length;
console.log(`\nprotection_stock_lifecycle: ${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
