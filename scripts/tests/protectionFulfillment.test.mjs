// Ringo Protection — Phase 5 fulfillment lifecycle tests. Runs entirely against an IN-MEMORY world
// and the REAL, unmodified Phase 2 engine (transitionProtectionTransaction) — no database, no
// network. Proves: protected -> fulfillment_started -> awaiting_confirmation only ever happens via a
// legitimate seller-owned transition, is idempotent/resumable, never touches
// commerce_sale_earnings/payout/refund, and never changes Normal Payment's own fulfillment behavior.
//   Run:  node scripts/tests/protectionFulfillment.test.mjs
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

const { advanceProtectionOnSellerFulfillment } = L("fulfillment.ts");
const { transitionProtectionTransaction } = L("engine.ts");
const { fulfillOrder } = jiti(path.join(SRC, "lib/productCheckout/fulfillOrder.ts"));

const results = [];
const check = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond });
  if (!cond) console.log("  FAIL:", name, "|", detail);
};
const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SELLER = U(1),
  OTHER_SELLER = U(2),
  CUSTOMER = U(101);
const ORDER = (n) => `00000000-0000-4000-a000-${String(n).padStart(12, "0")}`;

// ---------------------------------------------------------------- in-memory Protection world
// Mirrors protectionCheckout.test.mjs's own makeAdmin/tables convention exactly.
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

function makeWorld() {
  const tables = { protection_transactions: [], protection_transaction_events: [] };
  const admin = makeAdmin(tables);
  const logs = [];
  const fulfillmentStartedCalls = [];
  const awaitingConfirmationCalls = [];

  function seedTxn(overrides = {}) {
    const row = {
      id: U(5000 + tables.protection_transactions.length + 1),
      target_type: "product_order",
      target_id: overrides.target_id ?? ORDER(tables.protection_transactions.length + 1),
      status: "protected",
      creator_user_id: SELLER,
      customer_id: CUSTOMER,
      currency: "XAF",
      product_amount: 10000,
      protection_fee_rate: 0.03,
      protection_fee_amount: 300,
      customer_total: 10300,
      seller_protected_amount: 10000,
      ...overrides,
    };
    tables.protection_transactions.push(row);
    return row;
  }

  const store = {
    async getProtectionTransactionByOrder(orderId) {
      const row = tables.protection_transactions.find((t) => t.target_id === orderId);
      return row ? { id: row.id, status: row.status } : null;
    },
  };

  const deps = {
    store,
    transition: (id, to, actor) => transitionProtectionTransaction(admin, id, to, actor),
    onFulfillmentStarted: async (info) => {
      fulfillmentStartedCalls.push(info);
    },
    onAwaitingConfirmation: async (info) => {
      awaitingConfirmationCalls.push(info);
    },
    log: (event, data) => logs.push({ event, data }),
  };

  const txnOf = (id) => tables.protection_transactions.find((t) => t.id === id);
  return { tables, deps, seedTxn, txnOf, logs, fulfillmentStartedCalls, awaitingConfirmationCalls };
}

(async () => {
  // ---------------------------------------------------------------- 1. happy path: both transitions, both notifications, exactly once
  {
    const { deps, seedTxn, txnOf, fulfillmentStartedCalls, awaitingConfirmationCalls } = makeWorld();
    const txn = seedTxn();
    await advanceProtectionOnSellerFulfillment(deps, txn.target_id, { type: "seller", userId: SELLER });
    check("protected -> fulfillment_started -> awaiting_confirmation", txnOf(txn.id).status === "awaiting_confirmation");
    check("onFulfillmentStarted fired exactly once", fulfillmentStartedCalls.length === 1 && fulfillmentStartedCalls[0].orderId === txn.target_id);
    check("onAwaitingConfirmation fired exactly once", awaitingConfirmationCalls.length === 1 && awaitingConfirmationCalls[0].orderId === txn.target_id);
  }

  // ---------------------------------------------------------------- 2. duplicate fulfillment/completion request is idempotent, no duplicate notification
  {
    const { deps, seedTxn, txnOf, fulfillmentStartedCalls, awaitingConfirmationCalls } = makeWorld();
    const txn = seedTxn();
    await advanceProtectionOnSellerFulfillment(deps, txn.target_id, { type: "seller", userId: SELLER });
    await advanceProtectionOnSellerFulfillment(deps, txn.target_id, { type: "seller", userId: SELLER });
    await advanceProtectionOnSellerFulfillment(deps, txn.target_id, { type: "seller", userId: SELLER });
    check("repeated calls leave the transaction at awaiting_confirmation (no further movement)", txnOf(txn.id).status === "awaiting_confirmation");
    check("onFulfillmentStarted never fires more than once across repeated calls", fulfillmentStartedCalls.length === 1);
    check("onAwaitingConfirmation never fires more than once across repeated calls", awaitingConfirmationCalls.length === 1);
  }

  // ---------------------------------------------------------------- 3. resumable after a crash between the two transitions
  {
    const { deps, seedTxn, txnOf, fulfillmentStartedCalls, awaitingConfirmationCalls } = makeWorld();
    // Simulates a process crash right after the FIRST transition committed but before the second ran.
    const txn = seedTxn({ status: "fulfillment_started" });
    await advanceProtectionOnSellerFulfillment(deps, txn.target_id, { type: "seller", userId: SELLER });
    check("resumes from fulfillment_started and completes to awaiting_confirmation", txnOf(txn.id).status === "awaiting_confirmation");
    check("does NOT re-fire the fulfillment_started notification (that step already happened)", fulfillmentStartedCalls.length === 0);
    check("fires the awaiting_confirmation notification for the resumed completion", awaitingConfirmationCalls.length === 1);
  }

  // ---------------------------------------------------------------- 4. wrong seller cannot advance another seller's transaction
  {
    const { deps, seedTxn, txnOf, fulfillmentStartedCalls } = makeWorld();
    const txn = seedTxn(); // creator_user_id = SELLER
    await advanceProtectionOnSellerFulfillment(deps, txn.target_id, { type: "seller", userId: OTHER_SELLER });
    check("a different seller's actor cannot advance the transaction", txnOf(txn.id).status === "protected");
    check("no notification fires for a refused, unauthorized attempt", fulfillmentStartedCalls.length === 0);
  }

  // ---------------------------------------------------------------- 5. customer cannot trigger seller fulfillment (engine-level defense in depth)
  {
    const { deps, seedTxn, txnOf } = makeWorld();
    const txn = seedTxn();
    const asCustomer = await deps.transition(txn.id, "fulfillment_started", { type: "customer", customerId: CUSTOMER });
    check("the engine itself refuses a customer actor for protected -> fulfillment_started", asCustomer.ok === false && asCustomer.code === "unauthorized");
    check("transaction stays protected", txnOf(txn.id).status === "protected");
  }

  // ---------------------------------------------------------------- 6. invalid source statuses never start fulfillment
  {
    const invalidStatuses = ["awaiting_payment", "payment_failed", "expired", "cancelled", "disputed", "released", "refunded"];
    for (const status of invalidStatuses) {
      const { deps, seedTxn, txnOf, fulfillmentStartedCalls } = makeWorld();
      const txn = seedTxn({ status });
      await advanceProtectionOnSellerFulfillment(deps, txn.target_id, { type: "seller", userId: SELLER });
      check(`'${status}' cannot start fulfillment (untouched, no bypass)`, txnOf(txn.id).status === status);
      check(`'${status}': no notification fires`, fulfillmentStartedCalls.length === 0);
    }
  }

  // ---------------------------------------------------------------- 7. Normal Payment order: guaranteed no-op (no protection_transactions row)
  {
    const { deps, fulfillmentStartedCalls, awaitingConfirmationCalls } = makeWorld();
    await advanceProtectionOnSellerFulfillment(deps, ORDER(999), { type: "seller", userId: SELLER });
    check("an order with no Protection transaction is a pure no-op", fulfillmentStartedCalls.length === 0 && awaitingConfirmationCalls.length === 0);
  }

  // ---------------------------------------------------------------- 8. "concurrent" completion requests: exactly one valid transition path
  {
    const { deps, seedTxn, txnOf, fulfillmentStartedCalls, awaitingConfirmationCalls } = makeWorld();
    const txn = seedTxn();
    await Promise.all([
      advanceProtectionOnSellerFulfillment(deps, txn.target_id, { type: "seller", userId: SELLER }),
      advanceProtectionOnSellerFulfillment(deps, txn.target_id, { type: "seller", userId: SELLER }),
    ]);
    check("two concurrent calls still leave the transaction at exactly awaiting_confirmation", txnOf(txn.id).status === "awaiting_confirmation");
    check("fulfillment_started notification fired exactly once despite the race", fulfillmentStartedCalls.length === 1);
    check("awaiting_confirmation notification fired exactly once despite the race", awaitingConfirmationCalls.length === 1);
  }

  // ---------------------------------------------------------------- 9. append-only event history
  {
    const { deps, seedTxn, tables } = makeWorld();
    const txn = seedTxn();
    await advanceProtectionOnSellerFulfillment(deps, txn.target_id, { type: "seller", userId: SELLER });
    const events = tables.protection_transaction_events.filter((e) => e.protection_transaction_id === txn.id);
    check("exactly two transition events recorded (fulfillment_started, awaiting_confirmation)", events.length === 2);
    check("events record the correct from/to statuses in order", events[0]?.to_status === "fulfillment_started" && events[1]?.to_status === "awaiting_confirmation");
  }

  // ---------------------------------------------------------------- 10. financial isolation — structural
  {
    const fulfillmentSrc = read("src/lib/protection/fulfillment.ts");
    const httpSrc = read("src/lib/protection/fulfillmentHttp.ts");
    const notifSrc = read("src/lib/protection/fulfillmentNotifications.ts");
    check("fulfillment.ts never writes commerce_sale_earnings", !/commerce_sale_earnings/.test(fulfillmentSrc));
    check("fulfillment.ts never calls a payout/release function", !/payout|release_product_order_stock|releaseOrder/i.test(fulfillmentSrc));
    check("fulfillment.ts only ever requests fulfillment_started/awaiting_confirmation, never released/refunded", !/"released"|"refunded"|"resolved_release"/.test(fulfillmentSrc));
    check("fulfillmentHttp.ts never imports the refund adapter/engine", !/fapshiRefundAdapter|refundEngine/.test(httpSrc));
    check("fulfillment notifications never touch payment/provider fields", !/provider_transaction_id|provider_status|customer_payments|protection_payments/.test(notifSrc));
  }

  // ---------------------------------------------------------------- 11. customer visibility — the receipt is scoped to ONE order id, never leaks another's
  {
    const receiptSrc = read("src/lib/productCheckout/receipt.ts");
    check("getShopOrderReceiptData's Protection read is scoped by target_id = the SAME orderId parameter, never a list", /\.eq\("target_id", orderId\)/.test(receiptSrc));
    check("the Protection read never selects by customer_id (would allow enumerating a customer's other orders)", !/protection_transactions[\s\S]{0,200}customer_id/.test(receiptSrc.match(/protection_transactions[\s\S]{0,400}maybeSingle/)?.[0] ?? ""));
  }

  // ---------------------------------------------------------------- 12. Normal Payment regression
  {
    const fulfillOrderSrc = read("src/lib/productCheckout/fulfillOrder.ts");
    check("fulfillOrder.ts still requires status === 'paid' to fulfil (unchanged)", /canFulfil\(order\.status\)/.test(fulfillOrderSrc));
    check("fulfillOrder.ts's hook is optional and defaults to {} (backward compatible)", /hooks: FulfillHooks = \{\}/.test(fulfillOrderSrc));
    check("fulfillOrder.ts never imports anything from src/lib/protection", !/from ["'].*\/protection\//.test(fulfillOrderSrc) && !/from ["']@\/lib\/protection/.test(fulfillOrderSrc));

    // Behavioral: a Normal Payment order fulfils exactly as before when no hook is passed at all.
    const store = {
      order: { id: ORDER(1), status: "paid" },
      claims: 0,
      async getOwnedOrder(id) {
        return this.order.id === id ? { id: this.order.id, status: this.order.status } : null;
      },
      async claimFulfilled(id) {
        if (this.order.status !== "paid") return false;
        this.order.status = "fulfilled";
        this.claims++;
        return true;
      },
    };
    const r1 = await fulfillOrder(store, ORDER(1));
    const r2 = await fulfillOrder(store, ORDER(1));
    check("fulfillOrder() with no hooks arg still works exactly as before", r1.ok === true && r1.data.already === false && r2.ok === true && r2.data.already === true);
    check("claimFulfilled is called exactly once (unchanged exactly-once guarantee)", store.claims === 1);
  }

  const passed = results.filter((r) => r.pass).length;
  console.log(`\nprotection_fulfillment: ${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
})();
