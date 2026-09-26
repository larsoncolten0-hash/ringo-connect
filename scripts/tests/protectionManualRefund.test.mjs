// Ringo Protection — Phase 12 manual refund operations tests. Covers the new
// parseManualRefundInput/recordManualProtectionRefundOutcome engine additions (against a real,
// unmodified refundEngine.ts and an in-memory fake DB) plus structural checks on the new admin
// route, UI, translations, and cron wiring. No automatic Fapshi call is ever made anywhere in this
// phase — every test that could exercise that path instead proves it is never reached.
//   Run:  node scripts/tests/protectionManualRefund.test.mjs
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

const { requestProtectionRefund, parseManualRefundInput, recordManualProtectionRefundOutcome } = L("refundEngine.ts");

const results = [];
const check = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond });
  if (!cond) console.log("  FAIL:", name, "|", detail);
};
const U = (n) => `00000000-0000-4000-9000-${String(n).padStart(12, "0")}`;

// ---------------------------------------------------------------- 1. parseManualRefundInput (pure)
{
  check("rejects a non-object body", parseManualRefundInput(null).ok === false);
  check("rejects a missing/invalid outcome", parseManualRefundInput({ outcome: "pending" }).ok === false);
  check(
    "rejects a malformed phone number",
    parseManualRefundInput({ outcome: "completed", destinationPhone: "abc", destinationNetwork: "mtn", providerReference: "REF1" }).ok === false
  );
  check(
    "normalizes a +237-prefixed phone the same way the rest of the codebase does",
    (() => {
      const r = parseManualRefundInput({ outcome: "completed", destinationPhone: "+237 6 71 23 45 67", destinationNetwork: "mtn", providerReference: "REF1" });
      return r.ok && r.value.destination.phone === "671234567";
    })()
  );
  check(
    "rejects an unrecognized network",
    parseManualRefundInput({ outcome: "completed", destinationPhone: "671234567", destinationNetwork: "mobile-money", providerReference: "REF1" }).ok === false
  );
  check(
    "rejects a completed outcome with no provider reference",
    parseManualRefundInput({ outcome: "completed", destinationPhone: "671234567", destinationNetwork: "mtn" }).ok === false
  );
  check(
    "rejects a failed outcome with no failure reason",
    parseManualRefundInput({ outcome: "failed", destinationPhone: "671234567", destinationNetwork: "orange" }).ok === false
  );
  check(
    "accepts a valid completed input",
    parseManualRefundInput({ outcome: "completed", destinationPhone: "671234567", destinationNetwork: "mtn", providerReference: " REF-123 " }).ok === true
  );
  check(
    "accepts a valid failed input",
    parseManualRefundInput({ outcome: "failed", destinationPhone: "671234567", destinationNetwork: "orange", failureReason: " wrong number " }).ok === true
  );
  check(
    "never accepts a client-supplied refund amount at all — the parsed shape has no amount field",
    !("amount" in (parseManualRefundInput({ outcome: "completed", destinationPhone: "671234567", destinationNetwork: "mtn", providerReference: "R", amount: 999999 }).value || {}))
  );
}

// ---------------------------------------------------------------- shared in-memory world
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
        if (table === "protection_refunds" && tables.protection_refunds.some((r) => r.protection_transaction_id === insertRow.protection_transaction_id)) {
          return { data: null, error: { code: "23505" } };
        }
        const row = { id: `${table}_${tables[table].length}`, status: table === "protection_refunds" ? "requested" : undefined, created_at: new Date().toISOString(), ...insertRow };
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
  const tables = { protection_transactions: [], protection_transaction_events: [], protection_refunds: [] };
  const admin = makeAdmin(tables);

  function seedTxn(overrides = {}) {
    const row = {
      id: U(tables.protection_transactions.length + 1),
      target_id: U(9000 + tables.protection_transactions.length + 1),
      status: "resolved_refund",
      currency: "XAF",
      seller_protected_amount: 10000,
      customer_id: U(500),
      ...overrides,
    };
    tables.protection_transactions.push(row);
    return row;
  }

  return { tables, admin, seedTxn, txnOf: (id) => tables.protection_transactions.find((t) => t.id === id), refundOf: (id) => tables.protection_refunds.find((r) => r.protection_transaction_id === id) };
}

// ---------------------------------------------------------------- 2. recordManualProtectionRefundOutcome — completed path
{
  const { admin, seedTxn, txnOf, refundOf } = makeWorld();
  const txn = seedTxn();
  const requested = await requestProtectionRefund(admin, txn.id, { reason: "dispute resolved for customer" });
  check("setup: refund request succeeds", requested.ok === true);

  const parsed = parseManualRefundInput({ outcome: "completed", destinationPhone: "671234567", destinationNetwork: "mtn", providerReference: "FAPSHI-REF-1" });
  const outcome = await recordManualProtectionRefundOutcome(admin, requested.data.id, parsed.value);
  check("manual completion reports ok", outcome.ok === true);
  const refund = refundOf(txn.id);
  check("refund status becomes completed", refund.status === "completed");
  check("destination is recorded from the admin's own input", refund.destination_phone === "671234567" && refund.destination_network === "mtn");
  check("provider reference is recorded exactly as given", refund.provider_reference === "FAPSHI-REF-1");
  check("provider status is marked as a manual confirmation, never a fabricated Fapshi status", refund.provider_status === "MANUAL_CONFIRMED");
  check("completed_at is stamped", !!refund.completed_at);
  check("the refund amount is untouched — still the original protected-amount snapshot", Number(refund.refund_amount) === 10000);
  check("the parent transaction moves to refunded", txnOf(txn.id).status === "refunded");
}

// ---------------------------------------------------------------- 3. recordManualProtectionRefundOutcome — failed path never touches the parent transaction
{
  const { admin, seedTxn, txnOf, refundOf } = makeWorld();
  const txn = seedTxn();
  const requested = await requestProtectionRefund(admin, txn.id, {});
  const parsed = parseManualRefundInput({ outcome: "failed", destinationPhone: "671234567", destinationNetwork: "orange", failureReason: "insufficient balance" });
  const outcome = await recordManualProtectionRefundOutcome(admin, requested.data.id, parsed.value);
  check("manual failure recording reports ok", outcome.ok === true);
  const refund = refundOf(txn.id);
  check("refund status becomes failed, never completed", refund.status === "failed");
  check("failure reason is recorded", refund.failure_reason === "insufficient balance");
  check("the parent transaction is NOT moved to refunded on a failed attempt", txnOf(txn.id).status === "resolved_refund");
  check("no completed_at timestamp exists on a failed refund", !refund.completed_at);
}

// ---------------------------------------------------------------- 4. retry after a failed attempt succeeds
{
  const { admin, seedTxn, txnOf, refundOf } = makeWorld();
  const txn = seedTxn();
  const requested = await requestProtectionRefund(admin, txn.id, {});
  await recordManualProtectionRefundOutcome(admin, requested.data.id, parseManualRefundInput({ outcome: "failed", destinationPhone: "671234567", destinationNetwork: "mtn", failureReason: "wrong number" }).value);
  const retry = await recordManualProtectionRefundOutcome(admin, requested.data.id, parseManualRefundInput({ outcome: "completed", destinationPhone: "671111111", destinationNetwork: "mtn", providerReference: "REF-RETRY" }).value);
  check("a retry after a failed attempt succeeds", retry.ok === true);
  check("the retry's corrected destination overwrites the earlier wrong one", refundOf(txn.id).destination_phone === "671111111");
  check("the parent transaction now reaches refunded after the successful retry", txnOf(txn.id).status === "refunded");
}

// ---------------------------------------------------------------- 5. an already-completed refund rejects a second attempt (never silently reprocessed)
{
  const { admin, seedTxn } = makeWorld();
  const txn = seedTxn();
  const requested = await requestProtectionRefund(admin, txn.id, {});
  await recordManualProtectionRefundOutcome(admin, requested.data.id, parseManualRefundInput({ outcome: "completed", destinationPhone: "671234567", destinationNetwork: "mtn", providerReference: "REF-1" }).value);
  const second = await recordManualProtectionRefundOutcome(admin, requested.data.id, parseManualRefundInput({ outcome: "completed", destinationPhone: "679999999", destinationNetwork: "orange", providerReference: "REF-2" }).value);
  check("a second attempt on an already-completed refund is rejected as a conflict, not silently reprocessed", second.ok === false && second.code === "conflict");
}

// ---------------------------------------------------------------- 6. a refund stuck in `processing` (simulated crash between begin and complete) is safely resumed
{
  const { admin, seedTxn, tables, txnOf } = makeWorld();
  const txn = seedTxn();
  const requested = await requestProtectionRefund(admin, txn.id, {});
  const row = tables.protection_refunds.find((r) => r.id === requested.data.id);
  Object.assign(row, { status: "processing", destination_phone: "671234567", destination_network: "mtn", processing_started_at: new Date().toISOString() });

  const resumed = await recordManualProtectionRefundOutcome(admin, requested.data.id, parseManualRefundInput({ outcome: "completed", destinationPhone: "671234567", destinationNetwork: "mtn", providerReference: "REF-RESUME" }).value);
  check("a refund stuck in `processing` from an interrupted call is safely resumed to completed", resumed.ok === true && row.status === "completed");
  check("the parent transaction still reaches refunded after the resumed completion", txnOf(txn.id).status === "refunded");
}

// ---------------------------------------------------------------- 7. structural: the new admin route
{
  const routeSrc = read("src/app/api/admin/protection/transactions/[id]/refund-outcome/route.ts");
  check("the route requires assertAdmin before doing anything else", /assertAdmin\(\)/.test(routeSrc) && /if \(!admin\) return fail\("forbidden"\)/.test(routeSrc));
  check("the route resolves the refund row from the URL's transaction id, never a client-supplied refund id", /\.eq\("protection_transaction_id", params\.id\)/.test(routeSrc));
  check("the route never imports or calls the Fapshi refund adapter", !/fapshiRefundAdapter|fapshiPayout/.test(routeSrc));
  check("the route writes an admin_audit_log entry for every manual outcome", /admin_audit_log/.test(routeSrc) && /protection_refund_manual_outcome/.test(routeSrc));
  check("the route never accepts an amount from the request body", !/body\.amount|body\[.amount.\]/.test(routeSrc));
}

// ---------------------------------------------------------------- 8. structural: refundEngine.ts's new pieces
{
  const src = read("src/lib/protection/refundEngine.ts");
  check("recordManualProtectionRefundOutcome never accepts an amount input", !/input\.amount/.test(src));
  check("refundEngine.ts never IMPORTS fapshiRefundAdapter/fapshiPayout (a filename mention in a comment does not count)", !/^import .*from ["'][^"']*(fapshiRefundAdapter|fapshiPayout)["']/m.test(src));
  check("completeProtectionRefund (still unmodified) is the only place protection_refunds reaches 'completed'", (src.match(/status:\s*"completed"/g) || []).length === 1);
}

// ---------------------------------------------------------------- 9. structural: admin UI never auto-sends
{
  const uiSrc = read("src/components/admin/AdminProtectionDetail.tsx");
  check("the admin UI only ever posts to the manual refund-outcome route, never a send/pay/transfer route", (uiSrc.match(/fetch\(/g) || []).length === 2 && /refund-outcome/.test(uiSrc) && /resolve-dispute/.test(uiSrc));
  check("the admin UI never references fapshiPayout or an automatic transfer call", !/fapshiPayout|fapshi\.pay|initiateRefundPayout/.test(uiSrc));
  check("the destination phone/network are always admin-typed inputs, never pre-filled from product_orders.customer_phone", !/customer_phone/.test(uiSrc));
  check("submitting requires the fields the spec demands (destination, and either a provider reference or a failure reason) before the button is enabled", /!destinationPhone \|\| \(refundOutcome === "completed" \? !providerReference : !failureReason\)/.test(uiSrc));
}

// ---------------------------------------------------------------- 10. bilingual coverage for the two new customer-facing notification strings
{
  const src = read("src/lib/i18n/translations.ts");
  const enBlock = src.slice(0, src.indexOf("fr:"));
  const frBlock = src.slice(src.indexOf("fr:"));
  for (const key of ["protectionRefundCompleted", "protectionRefundFailed"]) {
    check(`en translations define ${key}`, new RegExp(`${key}:\\s*\\{`).test(enBlock));
    check(`fr translations define ${key}`, new RegExp(`${key}:\\s*\\{`).test(frBlock));
  }
  check(
    "the refund-requested copy no longer says the stale 'pending review' (the decision has already been made by the time this fires)",
    !/is pending review/.test(enBlock.match(/protectionRefundRequested:[\s\S]{0,200}/)?.[0] ?? "")
  );
}

// ---------------------------------------------------------------- 11. cron scheduling
{
  const vercelJson = JSON.parse(read("vercel.json"));
  const entry = vercelJson.crons.find((c) => c.path === "/api/cron/protection-auto-release");
  check("protection-auto-release is now scheduled in vercel.json", !!entry);
  check("its schedule is a plausible 5-field cron expression", typeof entry?.schedule === "string" && entry.schedule.split(" ").length === 5);
  check("no duplicate cron schedule was created for the same path", vercelJson.crons.filter((c) => c.path === "/api/cron/protection-auto-release").length === 1);
}

// ---------------------------------------------------------------- 12. the automatic refund capability flag is still never touched by any Phase 12 file
{
  const filesToScan = [
    "src/lib/protection/refundEngine.ts",
    "src/app/api/admin/protection/transactions/[id]/refund-outcome/route.ts",
    "src/components/admin/AdminProtectionDetail.tsx",
    "src/components/admin/AdminProtectionRefundsView.tsx",
    "src/lib/protection/disputeNotifications.ts",
  ];
  for (const f of filesToScan) {
    check(`${f} never sets protection_refund_provider_enabled to true`, !/protection_refund_provider_enabled:\s*true|refundProviderEnabled:\s*true/.test(read(f)), f);
  }
  check("fapshiRefundAdapter.ts's fail-closed gate is unmodified since Phase 7", /protection_refund_provider_enabled.*!== true/.test(read("src/lib/protection/fapshiRefundAdapter.ts").replace(/\n/g, " ")));
}

const passed = results.filter((r) => r.pass).length;
console.log(`\nprotection_manual_refund: ${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
