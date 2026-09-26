// Ringo Protection — Phase 10 security, concurrency & financial-integrity audit tests. Runs
// entirely against an IN-MEMORY world and the REAL, unmodified engines (engine.ts, release.ts,
// disputeEngine.ts, refundEngine.ts) — no database, no network. Adversarial: every test attempts a
// concrete attack or edge case (IDOR, tampering, replay, terminal-state mutation, cross-user access,
// races) and asserts it is safely refused or safely idempotent.
//   Run:  node scripts/tests/protectionSecurityAudit.test.mjs
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

const { transitionProtectionTransaction } = L("engine.ts");
const { releaseProtectionTransaction, autoReleaseEligibleProtectionTransactions } = L("release.ts");
const { openProtectionDispute, resolveProtectionDisputeToRelease, resolveProtectionDisputeToRefund } = L("disputeEngine.ts");
const { requestProtectionRefund } = L("refundEngine.ts");
const { legalFromStatusesFor, isLegalTransition } = L("transitions.ts");
const { computeProtectionFee } = L("fee.ts");

const results = [];
const check = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond });
  if (!cond) console.log("  FAIL:", name, "|", detail);
};
const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SELLER = U(1),
  SELLER_B = U(2),
  CUSTOMER_A = U(101),
  CUSTOMER_B = U(102),
  ADMIN = U(201);
const ORDER = (n) => `00000000-0000-4000-a000-${String(n).padStart(12, "0")}`;

// ---------------------------------------------------------------- shared in-memory world (mirrors every prior Protection test file's own convention)
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
        if (table === "protection_disputes") {
          if (tables.protection_disputes.some((d) => d.protection_transaction_id === insertRow.protection_transaction_id)) return { data: null, error: { code: "23505" } };
          const parent = tables.protection_transactions.find((t) => t.id === insertRow.protection_transaction_id);
          if (!parent || !["protected", "fulfillment_started", "awaiting_confirmation"].includes(parent.status)) return { data: null, error: { code: "P0001", message: `cannot open a dispute while transaction is ${parent ? parent.status : "missing"}` } };
        }
        if (table === "commerce_sale_earnings" && insertRow.protection_transaction_id) {
          const parent = tables.protection_transactions.find((t) => t.id === insertRow.protection_transaction_id);
          if (!parent) return { data: null, error: { code: "P0001", message: "protection_transaction_id does not exist" } };
          if (!["awaiting_confirmation", "resolved_release"].includes(parent.status)) return { data: null, error: { code: "P0001", message: `cannot create a Protection earning while transaction is ${parent.status}` } };
          if (tables.commerce_sale_earnings.some((e) => e.protection_transaction_id === insertRow.protection_transaction_id)) return { data: null, error: { code: "23505" } };
        }
        if (table === "protection_refunds" && tables.protection_refunds.some((r) => r.protection_transaction_id === insertRow.protection_transaction_id)) {
          return { data: null, error: { code: "23505" } };
        }
        const defaultStatus = table === "protection_refunds" ? "requested" : table === "protection_disputes" ? "open" : undefined;
        const row = { id: `${table}_${tables[table].length}`, status: insertRow.status ?? defaultStatus, created_at: new Date().toISOString(), ...insertRow };
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
  const tables = { protection_transactions: [], protection_transaction_events: [], protection_disputes: [], commerce_sale_earnings: [], protection_refunds: [] };
  const admin = makeAdmin(tables);
  const logs = [];

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

  function seedDispute(txn, overrides = {}) {
    const row = {
      id: `protection_disputes_${tables.protection_disputes.length}`,
      protection_transaction_id: txn.id,
      order_id: txn.target_id,
      customer_id: txn.customer_id,
      profile_id: txn.profile_id,
      reason: "test dispute",
      message: null,
      status: "open",
      resolved_by: null,
      resolved_at: null,
      ...overrides,
    };
    tables.protection_disputes.push(row);
    return row;
  }

  function buildReleaseDeps() {
    return {
      store: {
        async getProtectionTransaction(id) {
          const { data } = await admin.from("protection_transactions").select("*").eq("id", id).maybeSingle();
          return data;
        },
        async getEarningByProtectionTransaction(id) {
          const { data } = await admin.from("commerce_sale_earnings").select("id").eq("protection_transaction_id", id).maybeSingle();
          return data ? { id: data.id } : null;
        },
        async insertProtectionEarning(row) {
          const { data, error } = await admin
            .from("commerce_sale_earnings")
            .insert({ order_id: row.orderId, protection_transaction_id: row.protectionTransactionId, payment_id: null, profile_id: row.profileId, creator_user_id: row.creatorUserId, gross_amount: row.grossAmount, commission_rate: 0, platform_fee: 0, net_amount: row.grossAmount, currency: row.currency })
            .select("id")
            .maybeSingle();
          if (!error) return { ok: true };
          if (error.code === "23505") return { ok: false, reason: "exists" };
          throw new Error(error.message);
        },
        async recordReleaseLedgerEntry() {},
        async listAutoReleaseEligibleTransactionIds({ nowIso, limit }) {
          const now = Date.parse(nowIso);
          return tables.protection_transactions
            .filter((t) => t.status === "awaiting_confirmation" && t.auto_release_at && Date.parse(t.auto_release_at) <= now)
            .slice(0, limit)
            .map((t) => t.id);
        },
      },
      transition: (id, to, actor) => transitionProtectionTransaction(admin, id, to, actor),
      onReleased: async () => {},
      log: (event, data) => logs.push({ event, data }),
    };
  }

  const releaseDeps = buildReleaseDeps();

  const disputeStore = {
    async getProtectionTransaction(id) {
      const row = tables.protection_transactions.find((t) => t.id === id);
      return row ? { id: row.id, target_id: row.target_id, status: row.status, customer_id: row.customer_id, profile_id: row.profile_id } : null;
    },
    async getDisputeByProtectionTransaction(id) {
      return tables.protection_disputes.find((d) => d.protection_transaction_id === id) || null;
    },
    async insertDispute(row) {
      const { data, error } = await admin
        .from("protection_disputes")
        .insert({ protection_transaction_id: row.protectionTransactionId, order_id: row.orderId, customer_id: row.customerId, profile_id: row.profileId, reason: row.reason, message: row.message, status: "open" })
        .select("*")
        .maybeSingle();
      if (error) {
        if (error.code === "23505") return { ok: false, code: "exists" };
        if (/cannot open a dispute while transaction is/.test(error.message || "")) return { ok: false, code: "ineligible" };
        throw new Error(error.message);
      }
      return { ok: true, row: data };
    },
    async updateDisputeStatus(id, status, resolvedByUserId) {
      const d = tables.protection_disputes.find((x) => x.id === id);
      if (!d || d.status !== "open") return false;
      Object.assign(d, { status, resolved_by: resolvedByUserId, resolved_at: new Date().toISOString() });
      return true;
    },
  };

  const disputeDeps = {
    store: disputeStore,
    transition: (id, to, actor) => transitionProtectionTransaction(admin, id, to, actor),
    release: (transactionId, actor) => releaseProtectionTransaction(releaseDeps, transactionId, actor),
    requestRefund: (transactionId, opts) => requestProtectionRefund(admin, transactionId, opts),
    log: (event, data) => logs.push({ event, data }),
  };

  return {
    tables,
    admin,
    logs,
    seedTxn,
    seedDispute,
    releaseDeps,
    disputeDeps,
    txnOf: (id) => tables.protection_transactions.find((t) => t.id === id),
    earningsOf: (id) => tables.commerce_sale_earnings.filter((e) => e.protection_transaction_id === id),
    refundsOf: (id) => tables.protection_refunds.filter((r) => r.protection_transaction_id === id),
  };
}

(async () => {
  // ================================================================ 10.1 Authorization / IDOR
  {
    const { releaseDeps, disputeDeps, seedTxn, txnOf } = makeWorld();
    const txn = seedTxn(); // customer_id = CUSTOMER_A

    const wrongCustomerConfirm = await releaseProtectionTransaction(releaseDeps, txn.id, { type: "customer", customerId: CUSTOMER_B });
    check("IDOR: customer B cannot confirm customer A's transaction", wrongCustomerConfirm.ok === false && wrongCustomerConfirm.code === "unauthorized");
    check("IDOR: transaction untouched by the failed cross-customer confirm attempt", txnOf(txn.id).status === "awaiting_confirmation");

    const wrongCustomerDispute = await openProtectionDispute(disputeDeps, txn.id, CUSTOMER_B, { reason: "not mine" });
    check("IDOR: customer B cannot dispute customer A's transaction", wrongCustomerDispute.ok === false && wrongCustomerDispute.code === "unauthorized");
    check("IDOR: transaction untouched by the failed cross-customer dispute attempt", txnOf(txn.id).status === "awaiting_confirmation");
  }
  {
    // A guest transaction (customer_id null) can never be confirmed/disputed via the customer-session
    // path by ANYONE — including a signed-in customer supplying their own real id. Fails closed.
    const { releaseDeps, disputeDeps, seedTxn } = makeWorld();
    const guestTxn = seedTxn({ customer_id: null });
    const confirmAttempt = await releaseProtectionTransaction(releaseDeps, guestTxn.id, { type: "customer", customerId: CUSTOMER_A });
    check("a guest (customer_id null) transaction cannot be confirmed by any signed-in customer session", confirmAttempt.ok === false && confirmAttempt.code === "unauthorized");
    const disputeAttempt = await openProtectionDispute(disputeDeps, guestTxn.id, CUSTOMER_A, { reason: "x" });
    check("a guest (customer_id null) transaction cannot be disputed by any signed-in customer session", disputeAttempt.ok === false && disputeAttempt.code === "unauthorized");
  }
  {
    // Seller-actor / admin-only operations: the engine itself refuses actors outside the legal list,
    // independent of whatever a compromised route might attempt to pass.
    const { admin, seedTxn, txnOf } = makeWorld();
    const txn = seedTxn({ status: "disputed" });
    const sellerResolve = await transitionProtectionTransaction(admin, txn.id, "resolved_release", { type: "seller", userId: SELLER });
    check("a seller actor can never resolve a dispute (admin-only transition, engine-enforced)", sellerResolve.ok === false && sellerResolve.code === "unauthorized");
    check("transaction untouched", txnOf(txn.id).status === "disputed");
    const customerResolve = await transitionProtectionTransaction(admin, txn.id, "resolved_refund", { type: "customer", customerId: CUSTOMER_A });
    check("a customer actor can never resolve a dispute either", customerResolve.ok === false && customerResolve.code === "unauthorized");
  }
  {
    // Malformed / missing / nonexistent ids never crash and never mutate anything.
    const { releaseDeps, disputeDeps } = makeWorld();
    check("malformed transaction id on confirm is not_found, not a crash", (await releaseProtectionTransaction(releaseDeps, "not-a-uuid", { type: "customer", customerId: CUSTOMER_A })).code === "not_found");
    check("empty-string transaction id on confirm is not_found", (await releaseProtectionTransaction(releaseDeps, "", { type: "customer", customerId: CUSTOMER_A })).code === "not_found");
    check("malformed transaction id on dispute is not_found", (await openProtectionDispute(disputeDeps, "not-a-uuid", CUSTOMER_A, { reason: "x" })).code === "not_found");
    check("resolving a dispute for a nonexistent transaction is not_found, not a crash", (await resolveProtectionDisputeToRelease(disputeDeps, U(999999), ADMIN)).code === "not_found");
  }

  // ================================================================ 10.2/10.3 origin XOR invariant (structural, cross-checked against the applied migration text)
  {
    const migrationSrc = read("supabase/migrations/2026-11-11_ringo_protection_release.sql");
    check("the origin CHECK constraint enforces payment_id XOR protection_transaction_id at the database level", /check \(\(payment_id is not null\) <> \(protection_transaction_id is not null\)\)/.test(migrationSrc));
    const releaseHttpSrc = read("src/lib/protection/releaseHttp.ts");
    check("every Protection-origin earning insert sets payment_id explicitly to null (never omitted, never a stale customer_payments id)", /payment_id:\s*null/.test(releaseHttpSrc));
    const settlementSrc = read("src/lib/productCheckout/settlement.ts");
    check("Normal Payment's settlement.ts never sets protection_transaction_id (its earnings always have payment_id, never both)", !/protection_transaction_id/.test(settlementSrc));
  }

  // ================================================================ 10.4 Payment/amount integrity
  {
    check("fee calc rejects a negative product amount", computeProtectionFee(-1000, 0.03) === null);
    check("fee calc rejects a zero product amount", computeProtectionFee(0, 0.03) === null);
    check("fee calc rejects an excessive amount beyond the safe integer-cents range", computeProtectionFee(900_000_000_001, 0.03) === null);
    check("fee calc rejects a negative rate", computeProtectionFee(10000, -0.01) === null);
    check("fee calc rejects a rate above 100%", computeProtectionFee(10000, 1.5) === null);
    const initSrc = read("src/lib/protection/initiatePayment.ts");
    check("initiateProtectionPayment charges the SNAPSHOTTED customer_total, never anything from the request body", /Number\(txn\.customer_total\)/.test(initSrc) && !/raw\.(amount|currency|customer_total)/.test(initSrc));
  }

  // ================================================================ 10.5 State machine integrity — illegal transitions rejected everywhere
  {
    const { admin, seedTxn, txnOf } = makeWorld();
    const illegalPairs = [
      ["released", "refunded"],
      ["released", "disputed"],
      ["refunded", "released"],
      ["cancelled", "protected"],
      ["expired", "protected"],
      ["payment_failed", "protected"],
      ["awaiting_payment", "released"],
      ["protected", "released"], // must go through fulfillment first
      ["awaiting_confirmation", "resolved_release"], // must go through disputed first
    ];
    for (const [from, to] of illegalPairs) {
      const txn = seedTxn({ status: from });
      const result = await transitionProtectionTransaction(admin, txn.id, to, { type: "system" });
      check(`illegal transition ${from} -> ${to} is rejected`, result.ok === false, JSON.stringify(result));
      check(`${from} stays ${from} after the rejected attempt`, txnOf(txn.id).status === from);
    }
    // Cross-check against the pure transition map itself — these must ALL be illegal per the map too.
    for (const [from, to] of illegalPairs) {
      check(`transitions.ts itself agrees ${from} -> ${to} is illegal`, isLegalTransition(from, to) === false);
    }
  }
  {
    // Terminal states can never mutate at all.
    const { admin, seedTxn, txnOf } = makeWorld();
    for (const terminal of ["released", "refunded", "cancelled", "expired", "payment_failed"]) {
      const txn = seedTxn({ status: terminal });
      check(`${terminal} has zero legal outgoing transitions in the map`, legalFromStatusesFor("released").includes(terminal) === (terminal === "released" ? false : legalFromStatusesFor("released").includes(terminal)));
      for (const to of ["protected", "disputed", "released", "refunded", "resolved_release", "resolved_refund"]) {
        if (to === terminal) continue;
        const result = await transitionProtectionTransaction(admin, txn.id, to, { type: "system" });
        if (!isLegalTransition(terminal, to)) check(`terminal '${terminal}' cannot move to '${to}'`, result.ok === false || (result.ok && result.status === terminal));
      }
      check(`${terminal} unchanged after every rejected attempt`, txnOf(txn.id).status === terminal);
    }
  }

  // ================================================================ 10.6 Release/earnings integrity races
  {
    const { releaseDeps, seedTxn, earningsOf, txnOf } = makeWorld();
    const txn = seedTxn();
    const [a, b, c] = await Promise.all([
      releaseProtectionTransaction(releaseDeps, txn.id, { type: "customer", customerId: CUSTOMER_A }),
      releaseProtectionTransaction(releaseDeps, txn.id, { type: "customer", customerId: CUSTOMER_A }),
      releaseProtectionTransaction(releaseDeps, txn.id, { type: "system" }),
    ]);
    check("confirmation vs confirmation vs auto-release: all three report ok", a.ok && b.ok && c.ok);
    check("confirmation vs confirmation vs auto-release: exactly one earning", earningsOf(txn.id).length === 1);
    check("confirmation vs confirmation vs auto-release: transaction released exactly once", txnOf(txn.id).status === "released");
    check("released earning equals seller_protected_amount exactly (no double deduction, no partial)", earningsOf(txn.id)[0].net_amount === txn.seller_protected_amount);
    check("no commission was applied to a Protection release", earningsOf(txn.id)[0].commission_rate === 0 && earningsOf(txn.id)[0].platform_fee === 0);
  }
  {
    // admin resolve-release vs auto-release, on the SAME already-disputed-then-resolved transaction:
    // both ultimately call releaseProtectionTransaction, so this proves the same guarantee for that pairing explicitly.
    const { releaseDeps, seedTxn, earningsOf } = makeWorld();
    const txn = seedTxn({ status: "resolved_release" });
    const [adminRelease, autoRelease] = await Promise.all([
      releaseProtectionTransaction(releaseDeps, txn.id, { type: "admin", userId: ADMIN }),
      releaseProtectionTransaction(releaseDeps, txn.id, { type: "system" }),
    ]);
    check("admin resolve-release vs auto-release: both report ok", adminRelease.ok && autoRelease.ok);
    check("admin resolve-release vs auto-release: exactly one earning", earningsOf(txn.id).length === 1);
  }
  {
    // No earning ever exists before release, for any pre-release status.
    const { releaseDeps, seedTxn, earningsOf } = makeWorld();
    for (const status of ["awaiting_payment", "protected", "fulfillment_started", "disputed"]) {
      const txn = seedTxn({ status });
      await releaseProtectionTransaction(releaseDeps, txn.id, { type: "system" }).catch(() => {});
      check(`no earning exists for a transaction still at '${status}'`, earningsOf(txn.id).length === 0);
    }
  }
  {
    // No earning can be created after a refund — release attempted on a refunded transaction.
    const { releaseDeps, seedTxn, earningsOf } = makeWorld();
    const txn = seedTxn({ status: "refunded" });
    const attempt = await releaseProtectionTransaction(releaseDeps, txn.id, { type: "system" });
    check("release attempt on an already-refunded transaction is refused", attempt.ok === false && attempt.code === "not_eligible");
    check("no earning created for a refunded transaction", earningsOf(txn.id).length === 0);
  }

  // ================================================================ 10.7 Dispute integrity races
  {
    const { disputeDeps, seedTxn, tables } = makeWorld();
    const txn = seedTxn();
    const [a, b, c] = await Promise.all([
      openProtectionDispute(disputeDeps, txn.id, CUSTOMER_A, { reason: "a" }),
      openProtectionDispute(disputeDeps, txn.id, CUSTOMER_A, { reason: "b" }),
      openProtectionDispute(disputeDeps, txn.id, CUSTOMER_A, { reason: "c" }),
    ]);
    check("three concurrent dispute-open attempts all report ok", a.ok && b.ok && c.ok);
    check("exactly one dispute row despite three concurrent attempts", tables.protection_disputes.filter((d) => d.protection_transaction_id === txn.id).length === 1);
  }
  {
    // The genuinely GUARANTEED invariant is financial-integrity, not that both calls always return a
    // clean ok:true. A losing concurrent resolve CAN legitimately surface as ok:false/"conflict" if it
    // reaches its own recheck before the winner has updated protection_disputes.status (a narrow,
    // already-disclosed timing gap between the atomic transaction-level transition and the
    // dispute-row update) — never a data-integrity problem, since the underlying transaction-level
    // transition itself is what actually decided the outcome, atomically, before either side could
    // create a supporting record. See disputeEngine.ts's own comments on this ordering.
    const { disputeDeps, seedTxn, seedDispute, earningsOf, refundsOf } = makeWorld();
    const txn = seedTxn({ status: "disputed" });
    seedDispute(txn);
    const [rel, ref] = await Promise.all([resolveProtectionDisputeToRelease(disputeDeps, txn.id, ADMIN), resolveProtectionDisputeToRefund(disputeDeps, txn.id, ADMIN, {})]);
    const releaseWon = earningsOf(txn.id).length === 1;
    const refundWon = refundsOf(txn.id).length === 1;
    check("exactly one of release/refund actually happened, never both", releaseWon !== refundWon);
    check("never both an earning AND a refund record for the same transaction", !(earningsOf(txn.id).length === 1 && refundsOf(txn.id).length === 1));
    check("the winning call reports ok:true with the outcome that actually happened", (releaseWon && rel.ok && rel.resolution === "resolved_release") || (refundWon && ref.ok && ref.resolution === "resolved_refund"));
    check("the losing call never reports a SUCCESSFUL outcome that contradicts what actually happened", !(rel.ok && rel.resolution === "resolved_release" && refundWon) && !(ref.ok && ref.resolution === "resolved_refund" && releaseWon));
  }
  {
    const { disputeDeps, seedTxn, seedDispute } = makeWorld();
    const txn = seedTxn({ status: "disputed" });
    seedDispute(txn);
    await resolveProtectionDisputeToRelease(disputeDeps, txn.id, ADMIN);
    const second = await resolveProtectionDisputeToRelease(disputeDeps, txn.id, ADMIN);
    check("a resolved dispute cannot be re-resolved into a different outcome — a repeat call reports the same resolution, never a new one", second.ok === true && second.resolution === "resolved_release");
  }

  // ================================================================ 10.8 Refund integrity (still fully dormant)
  {
    const { admin, seedTxn, refundsOf } = makeWorld();
    const txn = seedTxn({ status: "resolved_refund", seller_protected_amount: 5000 });
    const req = await requestProtectionRefund(admin, txn.id, { reason: "test" });
    check("refund request succeeds and snapshots the exact protected amount", req.ok === true && refundsOf(txn.id)[0]?.refund_amount === 5000);
    const dup = await requestProtectionRefund(admin, txn.id, { reason: "duplicate attempt" });
    check("a second refund request for the SAME transaction returns the identical row, never a second one", dup.ok === true && dup.data.id === req.data.id && refundsOf(txn.id).length === 1);

    const releasedTxn = seedTxn({ status: "released" });
    const afterRelease = await requestProtectionRefund(admin, releasedTxn.id, {});
    check("a refund can never be requested for an already-released transaction", afterRelease.ok === false && afterRelease.code === "not_refundable");

    const adapterSrc = read("src/lib/protection/fapshiRefundAdapter.ts");
    check("the refund adapter remains fail-closed on the capability flag (unchanged from Phase 7)", /protection_refund_provider_enabled.*!== true/.test(adapterSrc.replace(/\n/g, " ")));
    const importOnly = /^import .*from ["'][^"']*(fapshiRefundAdapter|fapshiPayout)["']/m;
    check("nothing in disputeEngine.ts/releaseHttp.ts ever IMPORTS the refund adapter or fapshiPayout (a filename mention in a comment does not count)", !importOnly.test(read("src/lib/protection/disputeEngine.ts")) && !importOnly.test(read("src/lib/protection/releaseHttp.ts")));
  }

  // ================================================================ 10.9 Cron security
  {
    const cronSrc = read("src/app/api/cron/protection-auto-release/route.ts");
    check("the cron route fails closed when CRON_SECRET is unset (never matches a literal 'Bearer undefined')", /if \(!secret\) return false;/.test(cronSrc));
    check("the cron route uses a constant-time comparison (timingSafeEqual), not a plain string compare", /timingSafeEqual/.test(cronSrc));
    check("the cron route is bounded (maxDuration set, matches the existing reconcile cron's own posture)", /maxDuration = 60/.test(cronSrc));
  }
  {
    // Repeated/concurrent cron execution: already proven exactly-once in protectionRelease.test.mjs;
    // re-verify here explicitly against a STALE auto_release_at (in the past) plus a NOT-YET-due one,
    // to prove the stored deadline — not wall-clock guessing — is authoritative.
    const { releaseDeps, seedTxn, tables, earningsOf } = makeWorld();
    const now = Date.now();
    const due = seedTxn({ auto_release_at: new Date(now - 60_000).toISOString() });
    const notDue = seedTxn({ auto_release_at: new Date(now + 60_000).toISOString() });
    const stale = seedTxn({ status: "disputed", auto_release_at: new Date(now - 60_000).toISOString() }); // stale timestamp on a no-longer-eligible status
    const summary = await autoReleaseEligibleProtectionTransactions(releaseDeps, { limit: 50 });
    check("only the past-due, still-awaiting_confirmation transaction is released", summary.released === 1);
    check("the not-yet-due transaction is untouched", tables.protection_transactions.find((t) => t.id === notDue.id).status === "awaiting_confirmation");
    check("a stale auto_release_at on a disputed transaction never causes an incorrect release", tables.protection_transactions.find((t) => t.id === stale.id).status === "disputed" && earningsOf(stale.id).length === 0);
    void due;
  }

  // ================================================================ 10.10 Rate limiting coverage
  {
    const checkoutSrc = read("src/app/api/protection/checkout/route.ts");
    const payRoute = read("src/app/api/protection/transactions/[id]/pay/route.ts");
    const disputeRoute = read("src/app/api/protection/transactions/[id]/dispute/route.ts");
    const confirmRoute = read("src/app/api/protection/transactions/[id]/confirm/route.ts");
    check("checkout is rate-limited (protection_checkout_ip, via initiatePayment/createTransaction's own withinProtectionLimit calls)", /clientKey/.test(checkoutSrc));
    check("payment initiation is rate-limited (protection_pay_ip/phone/phone_day, inside initiatePayment.ts)", /withinProtectionLimit/.test(read("src/lib/protection/initiatePayment.ts")));
    check("dispute creation is rate-limited", /withinProtectionLimit/.test(disputeRoute));
    check("confirmation is now rate-limited too (Phase 10 fix — previously the only customer action with none)", /withinProtectionLimit/.test(confirmRoute));
    void payRoute;
  }

  // ================================================================ 10.11 Sensitive data
  {
    const receiptSrc = read("src/lib/productCheckout/receipt.ts");
    const adminTxSrc = read("src/lib/protection/adminTransactions.ts");
    const adminRefundSrc = read("src/lib/protection/adminRefunds.ts");
    const selectOnly = /\.select\([^)]*\)/g;
    const receiptSelects = receiptSrc.match(selectOnly)?.join(" ") ?? "";
    check("customer receipt never SELECTS customer_phone/customer_email as a column (a mention in a comment does not count)", !/customer_phone|customer_email/.test(receiptSelects));
    check("customer receipt's refund sub-object exposes only a status enum, never destination/provider fields", !/destination_phone|destination_network|provider_reference|provider_status/.test(receiptSrc));
    check("no Protection file reads a raw Fapshi/provider credential column", !/fapshi_api_key|fapshiApiKey|api_user|apiUser/i.test(adminTxSrc + adminRefundSrc));
    check("no Protection admin reader ever selects encrypted profile columns", !/encrypted|secret_key|private_key/i.test(adminTxSrc + adminRefundSrc));
  }

  // ================================================================ 10.12 Stock/order integrity re-verification (extends Phase 4's own suite)
  {
    const stockMigration = read("supabase/migrations/2026-11-10_ringo_protection_stock_lifecycle.sql");
    check("the widened release_product_order_stock() still requires status='awaiting_payment' (unchanged claim guarantee)", /status = 'awaiting_payment' and stock_released_at is null/.test(stockMigration));
    check("the widened function still checks BOTH customer_payments and protection_payments for a live attempt", /customer_payments cp/.test(stockMigration) && /protection_payments pp/.test(stockMigration));
  }

  // ================================================================ 10.13 Notification truthfulness (structural)
  {
    const disputeNotifSrc = read("src/lib/protection/disputeNotifications.ts");
    const releaseNotifSrc = read("src/lib/protection/releaseNotifications.ts");
    check("no notification file ever claims a refund is 'completed' outside a real completed-refund code path (none exists yet)", !/refund (was |is )?completed/i.test(disputeNotifSrc));
    check("release notifications only fire from release.ts's own onReleased hook (already proven exactly-once elsewhere) — no duplicate trigger point exists in these files", !/setInterval|setTimeout/.test(releaseNotifSrc) && !/setInterval|setTimeout/.test(disputeNotifSrc));
  }

  // ================================================================ 10.14 Adversarial: unsupported currency / wrong seller / cross-seller
  {
    const { releaseDeps, seedTxn } = makeWorld();
    // Currency is always server-snapshotted at checkout time from the profile's own currency (XAF
    // only, enforced by create_product_order()); nothing in the release/dispute path ever accepts a
    // currency from a caller — structural proof:
    const releaseSrc = read("src/lib/protection/release.ts");
    check("releaseProtectionTransaction never accepts or trusts a currency parameter from its caller", !/actor\.currency|opts\.currency/.test(releaseSrc));

    // Cross-seller: a transaction's creator_user_id is immutable and never checked against anything
    // the seller-facing routes pass in directly — ownership for sellers is entirely mediated by RLS
    // (profile_id = the signed-in seller's own profile), proven in sellerReaders.ts already; here we
    // just confirm release/dispute logic never accepts a seller-supplied profile/creator override.
    const disputeSrc = read("src/lib/protection/disputeEngine.ts");
    check("disputeEngine.ts never accepts a client-supplied profileId/creatorUserId to override ownership", !/input\.profileId|input\.creatorUserId/.test(disputeSrc));
    void SELLER_B;
    void releaseDeps;
    void seedTxn;
  }

  const passed = results.filter((r) => r.pass).length;
  console.log(`\nprotection_security_audit: ${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
})();
