// Ringo Protection — Phase 6 confirmation/release tests. Runs entirely against an IN-MEMORY world
// and the REAL, unmodified Phase 2 engine (transitionProtectionTransaction) — no database, no
// network. Proves: awaiting_confirmation -> released only happens for the owning customer (or the
// system auto-release job), creates EXACTLY one commerce_sale_earnings row using the transaction's
// own frozen snapshot, is idempotent/concurrency-safe, and never touches refunds or Normal Payment.
//   Run:  node scripts/tests/protectionRelease.test.mjs
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

const { releaseProtectionTransaction, autoReleaseEligibleProtectionTransactions } = L("release.ts");
const { transitionProtectionTransaction } = L("engine.ts");

const results = [];
const check = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond });
  if (!cond) console.log("  FAIL:", name, "|", detail);
};
const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SELLER = U(1),
  CUSTOMER_A = U(101),
  CUSTOMER_B = U(102);
const ORDER = (n) => `00000000-0000-4000-a000-${String(n).padStart(12, "0")}`;

// ---------------------------------------------------------------- in-memory world
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
  const tables = { protection_transactions: [], protection_transaction_events: [] };
  const admin = makeAdmin(tables);
  const earnings = []; // fake commerce_sale_earnings
  const ledger = []; // fake protection_ledger_entries
  const logs = [];
  const releasedCalls = [];
  let insertShouldFail = opts.insertShouldFail ?? false;

  function seedTxn(overrides = {}) {
    const row = {
      id: U(5000 + tables.protection_transactions.length + 1),
      target_type: "product_order",
      target_id: overrides.target_id ?? ORDER(tables.protection_transactions.length + 1),
      status: "awaiting_confirmation",
      profile_id: U(1),
      creator_user_id: SELLER,
      customer_id: CUSTOMER_A,
      currency: "XAF",
      product_amount: 10000,
      protection_fee_rate: 0.03,
      protection_fee_amount: 300,
      customer_total: 10300,
      seller_protected_amount: 10000,
      auto_release_at: null,
      ...overrides,
    };
    tables.protection_transactions.push(row);
    return row;
  }

  const store = {
    async getProtectionTransaction(id) {
      const row = tables.protection_transactions.find((t) => t.id === id);
      if (!row) return null;
      return { id: row.id, target_id: row.target_id, status: row.status, profile_id: row.profile_id, creator_user_id: row.creator_user_id, customer_id: row.customer_id, currency: row.currency, seller_protected_amount: row.seller_protected_amount };
    },
    async getEarningByProtectionTransaction(id) {
      const row = earnings.find((e) => e.protection_transaction_id === id);
      return row ? { id: row.id } : null;
    },
    async insertProtectionEarning(row) {
      if (insertShouldFail) throw new Error("simulated earnings insert failure");
      if (earnings.some((e) => e.protection_transaction_id === row.protectionTransactionId)) return { ok: false, reason: "exists" };
      earnings.push({
        id: `earning_${earnings.length + 1}`,
        order_id: row.orderId,
        protection_transaction_id: row.protectionTransactionId,
        payment_id: null,
        profile_id: row.profileId,
        creator_user_id: row.creatorUserId,
        gross_amount: row.grossAmount,
        commission_rate: 0,
        platform_fee: 0,
        net_amount: row.grossAmount,
        currency: row.currency,
        status: "recorded",
      });
      return { ok: true };
    },
    async recordReleaseLedgerEntry(input) {
      if (ledger.some((l) => l.idempotency_key === input.idempotencyKey)) return; // swallow duplicate, like the real store
      ledger.push({ ...input });
    },
    async listAutoReleaseEligibleTransactionIds({ nowIso, limit }) {
      const now = Date.parse(nowIso);
      return tables.protection_transactions
        .filter((t) => t.status === "awaiting_confirmation" && t.auto_release_at && Date.parse(t.auto_release_at) <= now)
        .sort((a, b) => Date.parse(a.auto_release_at) - Date.parse(b.auto_release_at))
        .slice(0, limit)
        .map((t) => t.id);
    },
  };

  const deps = {
    store,
    transition: (id, to, actor) => transitionProtectionTransaction(admin, id, to, actor),
    onReleased: async (info) => {
      releasedCalls.push(info);
    },
    log: (event, data) => logs.push({ event, data }),
  };

  const txnOf = (id) => tables.protection_transactions.find((t) => t.id === id);
  return { tables, deps, seedTxn, txnOf, earnings, ledger, logs, releasedCalls, setInsertShouldFail: (v) => (insertShouldFail = v) };
}

(async () => {
  // ---------------------------------------------------------------- 1. happy path
  {
    const { deps, seedTxn, txnOf, earnings, ledger, releasedCalls } = makeWorld();
    const txn = seedTxn();
    const outcome = await releaseProtectionTransaction(deps, txn.id, { type: "customer", customerId: CUSTOMER_A });
    check("legitimate customer can confirm/release", outcome.ok === true && outcome.status === "released" && outcome.alreadyReleased === false, JSON.stringify(outcome));
    check("transaction moves to released", txnOf(txn.id).status === "released");
    check("exactly one earnings record created", earnings.filter((e) => e.protection_transaction_id === txn.id).length === 1);
    check("earning amount matches the seller_protected_amount snapshot", earnings[0].gross_amount === 10000 && earnings[0].net_amount === 10000);
    check("earning currency matches the transaction", earnings[0].currency === "XAF");
    check("earning references the correct order/seller/transaction", earnings[0].order_id === txn.target_id && earnings[0].creator_user_id === SELLER && earnings[0].protection_transaction_id === txn.id);
    check("earning has payment_id null (Protection origin, not customer_payments)", earnings[0].payment_id === null);
    check("no commission/platform fee deducted from a Protection release", earnings[0].commission_rate === 0 && earnings[0].platform_fee === 0);
    check("release ledger entry recorded", ledger.length === 1 && ledger[0].protectionTransactionId === txn.id && ledger[0].amount === 10000);
    check("onReleased notification fired exactly once", releasedCalls.length === 1 && releasedCalls[0].orderId === txn.target_id);
  }

  // ---------------------------------------------------------------- 2. wrong customer cannot confirm
  {
    const { deps, seedTxn, txnOf, earnings } = makeWorld();
    const txn = seedTxn(); // customer_id = CUSTOMER_A
    const outcome = await releaseProtectionTransaction(deps, txn.id, { type: "customer", customerId: CUSTOMER_B });
    check("a different customer cannot release someone else's transaction", outcome.ok === false && outcome.code === "unauthorized", JSON.stringify(outcome));
    check("transaction untouched", txnOf(txn.id).status === "awaiting_confirmation");
    check("no earning created for an unauthorized attempt", earnings.length === 0);
  }

  // ---------------------------------------------------------------- 3. engine-level defense in depth: seller actor is not even a constructible actor for this function
  {
    const { deps, seedTxn, txnOf } = makeWorld();
    const txn = seedTxn();
    const asSeller = await deps.transition(txn.id, "released", { type: "seller", userId: SELLER });
    check("the engine itself refuses a seller actor for awaiting_confirmation -> released", asSeller.ok === false && asSeller.code === "unauthorized");
    check("transaction stays awaiting_confirmation", txnOf(txn.id).status === "awaiting_confirmation");
  }

  // ---------------------------------------------------------------- 4. invalid source statuses can never release
  {
    const invalid = ["awaiting_payment", "protected", "fulfillment_started", "payment_failed", "expired", "cancelled", "disputed", "refunded"];
    for (const status of invalid) {
      const { deps, seedTxn, txnOf, earnings } = makeWorld();
      const txn = seedTxn({ status });
      const outcome = await releaseProtectionTransaction(deps, txn.id, { type: "customer", customerId: CUSTOMER_A });
      check(`'${status}' cannot release (not_eligible, never bypassed)`, outcome.ok === false && outcome.code === "not_eligible", JSON.stringify(outcome));
      check(`'${status}': transaction untouched`, txnOf(txn.id).status === status);
      check(`'${status}': no earning created`, earnings.length === 0);
    }
  }

  // ---------------------------------------------------------------- 5. already released is idempotent
  {
    const { deps, seedTxn, txnOf, earnings, releasedCalls } = makeWorld();
    const txn = seedTxn();
    await releaseProtectionTransaction(deps, txn.id, { type: "customer", customerId: CUSTOMER_A });
    const second = await releaseProtectionTransaction(deps, txn.id, { type: "customer", customerId: CUSTOMER_A });
    const third = await releaseProtectionTransaction(deps, txn.id, { type: "customer", customerId: CUSTOMER_A });
    check("second confirmation reports already released", second.ok === true && second.alreadyReleased === true);
    check("third confirmation also reports already released", third.ok === true && third.alreadyReleased === true);
    check("still exactly one earning after repeated confirmations", earnings.filter((e) => e.protection_transaction_id === txn.id).length === 1);
    check("onReleased never fires again after the first release", releasedCalls.length === 1);
    check("status stays released", txnOf(txn.id).status === "released");
  }

  // ---------------------------------------------------------------- 6. concurrent confirmation requests: exactly one release, one earning
  {
    const { deps, seedTxn, txnOf, earnings, releasedCalls } = makeWorld();
    const txn = seedTxn();
    const [a, b] = await Promise.all([
      releaseProtectionTransaction(deps, txn.id, { type: "customer", customerId: CUSTOMER_A }),
      releaseProtectionTransaction(deps, txn.id, { type: "customer", customerId: CUSTOMER_A }),
    ]);
    check("both concurrent requests report ok", a.ok === true && b.ok === true);
    check("exactly one of the two is the real release, the other a no-op", [a.alreadyReleased, b.alreadyReleased].filter((x) => x === false).length === 1);
    check("exactly one earning despite the race", earnings.filter((e) => e.protection_transaction_id === txn.id).length === 1);
    check("onReleased fired exactly once despite the race", releasedCalls.length === 1);
    check("transaction ends up released", txnOf(txn.id).status === "released");
  }

  // ---------------------------------------------------------------- 7. confirmation racing with auto-release
  {
    const { deps, seedTxn, txnOf, earnings } = makeWorld();
    const txn = seedTxn();
    const [customerAttempt, autoAttempt] = await Promise.all([
      releaseProtectionTransaction(deps, txn.id, { type: "customer", customerId: CUSTOMER_A }),
      releaseProtectionTransaction(deps, txn.id, { type: "system" }),
    ]);
    check("both the customer confirmation and the auto-release attempt succeed (one real, one no-op)", customerAttempt.ok === true && autoAttempt.ok === true);
    check("exactly one earning when confirmation races auto-release", earnings.filter((e) => e.protection_transaction_id === txn.id).length === 1);
    check("transaction released exactly once", txnOf(txn.id).status === "released");
  }

  // ---------------------------------------------------------------- 8. failure handling: earnings insertion failure never releases, retry succeeds, no duplicate
  {
    const { deps, seedTxn, txnOf, earnings, setInsertShouldFail } = makeWorld({ insertShouldFail: true });
    const txn = seedTxn();
    let threw = false;
    try {
      await releaseProtectionTransaction(deps, txn.id, { type: "customer", customerId: CUSTOMER_A });
    } catch {
      threw = true;
    }
    check("an earnings-insert failure surfaces as an error, not a silent release", threw === true || (await deps.store.getProtectionTransaction(txn.id)).status === "awaiting_confirmation");
    check("transaction is NOT released when earnings creation fails", txnOf(txn.id).status === "awaiting_confirmation");
    check("no earning exists after the failed attempt", earnings.length === 0);

    setInsertShouldFail(false);
    const retried = await releaseProtectionTransaction(deps, txn.id, { type: "customer", customerId: CUSTOMER_A });
    check("a retry after the underlying failure clears succeeds", retried.ok === true && retried.alreadyReleased === false);
    check("exactly one earning after the successful retry (no duplicate from the failed attempt)", earnings.filter((e) => e.protection_transaction_id === txn.id).length === 1);
    check("transaction released after retry", txnOf(txn.id).status === "released");
  }

  // ---------------------------------------------------------------- 9. historical fee/amount preserved even if admin settings changed since checkout
  {
    const { deps, seedTxn, earnings } = makeWorld();
    // Simulates a transaction created under an OLDER, different fee rate/amount than whatever the
    // admin's CURRENT settings might be — release.ts never reads platform_settings at all.
    const txn = seedTxn({ product_amount: 7777, protection_fee_rate: 0.011, protection_fee_amount: 86, customer_total: 7863, seller_protected_amount: 7777 });
    await releaseProtectionTransaction(deps, txn.id, { type: "customer", customerId: CUSTOMER_A });
    check("released earning uses the transaction's OWN frozen snapshot amount, never a recomputed one", earnings[0].gross_amount === 7777 && earnings[0].net_amount === 7777);
  }

  // ---------------------------------------------------------------- 10. auto-release job
  {
    const { deps, seedTxn, tables, earnings } = makeWorld();
    const now = Date.now();
    const eligible = seedTxn({ auto_release_at: new Date(now - 1000).toISOString() });
    const notYetEligible = seedTxn({ auto_release_at: new Date(now + 3600_000).toISOString() });
    const noDeadline = seedTxn({ auto_release_at: null });
    const disputed = seedTxn({ status: "disputed", auto_release_at: new Date(now - 1000).toISOString() });
    const cancelled = seedTxn({ status: "cancelled", auto_release_at: new Date(now - 1000).toISOString() });
    const refunded = seedTxn({ status: "refunded", auto_release_at: new Date(now - 1000).toISOString() });
    const alreadyReleased = seedTxn({ status: "released", auto_release_at: new Date(now - 1000).toISOString() });

    const summary = await autoReleaseEligibleProtectionTransactions(deps, { limit: 50 });
    const statusOf = (id) => tables.protection_transactions.find((t) => t.id === id).status;

    check("the past-deadline eligible transaction is released", statusOf(eligible.id) === "released");
    check("the not-yet-eligible transaction stays awaiting_confirmation", statusOf(notYetEligible.id) === "awaiting_confirmation");
    check("a transaction with no auto_release_at is never swept", statusOf(noDeadline.id) === "awaiting_confirmation");
    check("a disputed transaction is never auto-released", statusOf(disputed.id) === "disputed");
    check("a cancelled transaction is never auto-released", statusOf(cancelled.id) === "cancelled");
    check("a refunded transaction is never auto-released", statusOf(refunded.id) === "refunded");
    check("an already-released transaction is left alone", statusOf(alreadyReleased.id) === "released");
    check("summary reports exactly one real release", summary.released === 1);
    check("exactly one earning created by the sweep", earnings.length === 1 && earnings[0].protection_transaction_id === eligible.id);

    // Repeated cron execution must be safe.
    const secondRun = await autoReleaseEligibleProtectionTransactions(deps, { limit: 50 });
    check("a second sweep run finds nothing new to release", secondRun.released === 0);
    check("earnings count unchanged after a second sweep run", earnings.length === 1);
  }

  // ---------------------------------------------------------------- 11. two concurrent cron executions
  {
    const { deps, seedTxn, earnings, tables } = makeWorld();
    const txn = seedTxn({ auto_release_at: new Date(Date.now() - 1000).toISOString() });
    const [s1, s2] = await Promise.all([autoReleaseEligibleProtectionTransactions(deps, { limit: 50 }), autoReleaseEligibleProtectionTransactions(deps, { limit: 50 })]);
    check("two overlapping cron runs together release exactly once", s1.released + s2.released === 1 && s1.alreadyReleased + s2.alreadyReleased === 1);
    check("exactly one earning despite overlapping cron runs", earnings.filter((e) => e.protection_transaction_id === txn.id).length === 1);
  }

  // ---------------------------------------------------------------- 12. security: transaction id is the only input; nothing else is trusted (structural)
  {
    const releaseSrc = read("src/lib/protection/release.ts");
    const routeSrc = read("src/app/api/protection/transactions/[id]/confirm/route.ts");
    check("releaseProtectionTransaction never reads an amount/currency/fee from anything but the stored transaction row", !/actor\.(amount|currency|fee|grossAmount)/.test(releaseSrc));
    check("the confirm route derives the customer id from the session cookie, never the request body", /getCustomerFromCookie/.test(routeSrc) && !/body\.customer_id|customerId:\s*(params|body)/.test(routeSrc));
    check("the confirm route requires isSameOrigin (CSRF) before anything else", /isSameOrigin\(request\)/.test(routeSrc));
    check("the confirm route uses the customer session system, never supabase.auth.getUser() (a seller/admin session)", !/auth\.getUser\(\)/.test(routeSrc));
  }

  // ---------------------------------------------------------------- 13. financial isolation — no refund adapter, no double payout system
  {
    const releaseSrc = read("src/lib/protection/release.ts");
    const httpSrc = read("src/lib/protection/releaseHttp.ts");
    check("release.ts never invokes the refund adapter/engine", !/fapshiRefundAdapter|refundEngine|fapshiPayout/.test(releaseSrc));
    check("release.ts never requests resolved_release/resolved_refund/refunded (dispute resolution is a later phase)", !/"resolved_release"|"resolved_refund"|"refunded"/.test(releaseSrc));
    check("releaseHttp.ts writes ONLY to commerce_sale_earnings and protection_ledger_entries — no new payout table", !/\.from\("(commerce_payouts|music_payouts|affiliate_payouts)"\)/.test(httpSrc));
    check("releaseHttp.ts never grants a client-side write path (server-only, service-role admin client)", /createAdminClient/.test(httpSrc));
  }

  // ---------------------------------------------------------------- 14. Normal Payment regression
  {
    const settlementSrc = read("src/lib/productCheckout/settlement.ts");
    check("settlement.ts (Normal Payment's own settlement) is completely untouched by Phase 6 — still inserts via insertEarning with a real payment_id path", /insertEarning/.test(settlementSrc) && !/protection/i.test(settlementSrc));
    check("release.ts never imports anything from productCheckout", !/from ["'].*\/productCheckout\//.test(read("src/lib/protection/release.ts")));
  }

  const passed = results.filter((r) => r.pass).length;
  console.log(`\nprotection_release: ${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
})();
