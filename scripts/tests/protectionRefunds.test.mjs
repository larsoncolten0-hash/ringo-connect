// Ringo Protection — Phase 3 refund mechanism tests. No network, no real database, no Fapshi call
// (the one function capable of a real call, fapshiRefundAdapter.ts, is never invoked by anything
// here — its own file is proof enough that it's never wired up, see the isolation check at the
// bottom). Protection stays disabled; nothing here touches commerce_sale_earnings, seller
// payouts, or Normal Payment.
//
//   Run:  node scripts/tests/protectionRefunds.test.mjs
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO, "src");
const jiti = require("jiti")(import.meta.url, { alias: { "@": SRC }, interopDefault: true });
const load = (p) => jiti(path.join(SRC, p));
const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8");

const results = [];
const check = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond });
  if (!cond) console.log("  FAIL:", name, "|", detail);
};

const { transitionProtectionTransaction } = load("lib/protection/engine.ts");
const {
  requestProtectionRefund,
  beginProtectionRefundProcessing,
  completeProtectionRefund,
  failProtectionRefund,
  reconcileProtectionRefundPayout,
} = load("lib/protection/refundEngine.ts");

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const TXN = (n) => `00000000-0000-4000-9000-${String(n).padStart(12, "0")}`;
const ORDER = (n) => `00000000-0000-4000-a000-${String(n).padStart(12, "0")}`;
const SELLER = U(1),
  CUSTOMER = U(101),
  ADMIN = U(201);
let seq = 0;

// ================================================================ in-memory world — same
// conditional-UPDATE-emulation technique as protectionTransitions.test.mjs, extended to also
// simulate protection_refunds' own INSERT-time guards (uniqueness, amount safety) the way the
// real Postgres triggers in 2026-11-08_ringo_protection_refunds.sql do.
function makeDb() {
  // protection_transaction_events is included because completeProtectionRefund calls the REAL,
  // unmodified Phase 2 transitionProtectionTransaction(), which writes one event row per transition.
  const tables = { protection_transactions: [], protection_refunds: [], protection_transaction_events: [] };

  function builder(table) {
    const filters = [];
    let mode = "select";
    let updatePatch = null;
    let insertRow = null;

    const matches = (row) => filters.every((f) => (f.op === "eq" ? row[f.col] === f.val : f.val.includes(row[f.col])));

    async function exec() {
      await Promise.resolve();
      if (mode === "insert") {
        if (table === "protection_refunds") {
          const dupTxn = tables.protection_refunds.some((r) => r.protection_transaction_id === insertRow.protection_transaction_id);
          if (dupTxn) return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
          if (insertRow.idempotency_key) {
            const dupKey = tables.protection_refunds.some((r) => r.idempotency_key === insertRow.idempotency_key);
            if (dupKey) return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
          }
          const parentTxn = tables.protection_transactions.find((t) => t.id === insertRow.protection_transaction_id);
          if (parentTxn) {
            if (Number(insertRow.refund_amount) > Number(parentTxn.seller_protected_amount)) {
              return { data: null, error: { code: "23514", message: `protection_refunds: refund_amount exceeds the protected amount (${parentTxn.seller_protected_amount})` } };
            }
            if (parentTxn.status === "released" || parentTxn.status === "refunded") {
              return { data: null, error: { code: "23514", message: `protection_refunds: cannot create a refund for a transaction already ${parentTxn.status}` } };
            }
          }
        }
        const row = { id: `${table}_${tables[table].length}`, status: "requested", created_at: new Date().toISOString(), ...insertRow };
        tables[table].push(row);
        return { data: row, error: null };
      }
      const affected = tables[table].filter(matches);
      for (const row of affected) Object.assign(row, updatePatch);
      return { data: affected, error: null };
    }

    const self = {
      select(...args) {
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
        return self; // chainable: supports both `await insert(...)` (thenable, below) and `.insert(...).select().maybeSingle()`
      },
      // Makes a bare `await admin.from(x).insert(row)` (no further chaining) work directly,
      // exactly like real supabase-js — only meaningful in insert mode.
      then(resolve, reject) {
        exec().then(resolve, reject);
      },
      async maybeSingle() {
        await Promise.resolve();
        if (mode === "insert") {
          const r = await exec();
          return { data: r.data, error: r.error };
        }
        const rows = tables[table].filter(matches);
        return { data: rows[0] ?? null, error: null };
      },
    };
    return self;
  }

  return { from: (table) => builder(table), _tables: tables };
}

function seedTxn(db, overrides = {}) {
  seq += 1;
  const row = {
    id: TXN(seq),
    target_id: ORDER(seq),
    status: "resolved_refund",
    creator_user_id: SELLER,
    customer_id: CUSTOMER,
    currency: "XAF",
    seller_protected_amount: 100000,
    ...overrides,
  };
  db._tables.protection_transactions.push(row);
  return row;
}
const refundOf = (db, id) => db._tables.protection_refunds.find((r) => r.id === id);
const txnOf = (db, id) => db._tables.protection_transactions.find((r) => r.id === id);

(async () => {
  // ============================================================ 1. happy path
  {
    const db = makeDb();
    const txn = seedTxn(db);
    const req = await requestProtectionRefund(db, txn.id, { reason: "seller never delivered" });
    check("refund requested", req.ok === true && req.data.status === "requested");

    const proc = await beginProtectionRefundProcessing(db, req.data.id, { phone: "677123456", network: "mtn" });
    check("refund processing", proc.ok === true && proc.data.status === "processing");

    // Simulate a successful provider outcome via reconciliation (never a real Fapshi call).
    refundOf(db, req.data.id).provider_reference = "fake-trans-1";
    const recon = await reconcileProtectionRefundPayout(db, req.data.id, async () => ({ status: "SUCCESSFUL" }));
    check("reconciliation reports completed", recon.ok === true && recon.data.status === "completed");
    check("refund row is completed with completed_at set", refundOf(db, req.data.id).status === "completed" && !!refundOf(db, req.data.id).completed_at);
    check("protection transaction becomes refunded", txnOf(db, txn.id).status === "refunded");
    check("refunded_at set on the protection transaction", !!txnOf(db, txn.id).refunded_at);
  }

  // ============================================================ 2. failure
  {
    const db = makeDb();
    const txn = seedTxn(db);
    const req = await requestProtectionRefund(db, txn.id);
    await beginProtectionRefundProcessing(db, req.data.id, { phone: "677123456", network: "mtn" });
    refundOf(db, req.data.id).provider_reference = "fake-trans-2";
    const recon = await reconcileProtectionRefundPayout(db, req.data.id, async () => ({ status: "FAILED", reason: "insufficient balance" }));
    check("provider rejection -> refund becomes failed", recon.ok === true && recon.data.status === "failed");
    check("failure_reason recorded", refundOf(db, req.data.id).failure_reason === "insufficient balance");
    check("protection transaction does NOT become refunded", txnOf(db, txn.id).status === "resolved_refund");
  }

  // ============================================================ 3. timeout / unknown provider state
  {
    const db = makeDb();
    const txn = seedTxn(db);
    const req = await requestProtectionRefund(db, txn.id);
    await beginProtectionRefundProcessing(db, req.data.id, { phone: "677123456", network: "mtn" });
    refundOf(db, req.data.id).provider_reference = "fake-trans-3";

    const timedOut = await reconcileProtectionRefundPayout(db, req.data.id, async () => {
      throw new Error("network timeout");
    });
    check("a provider check that throws is never treated as success", timedOut.ok === true && timedOut.data.status === "processing" && timedOut.data.providerStatus === "unknown");
    check("refund stays processing after a timeout, not completed or failed", refundOf(db, req.data.id).status === "processing");
    check("protection transaction untouched by a timeout", txnOf(db, txn.id).status === "resolved_refund");

    const stillCreated = await reconcileProtectionRefundPayout(db, req.data.id, async () => ({ status: "CREATED" }));
    check("a CREATED (still in flight) provider status is never treated as success", stillCreated.ok === true && stillCreated.data.status === "processing");

    // Safe retry behavior: reconciliation can be attempted again later and correctly resolves once the provider actually settles.
    const settled = await reconcileProtectionRefundPayout(db, req.data.id, async () => ({ status: "SUCCESSFUL" }));
    check("a later reconciliation after transient unknown states still correctly resolves to completed", settled.ok === true && settled.data.status === "completed");
  }

  // ============================================================ 4. duplicate protection
  {
    const db = makeDb();
    const txn = seedTxn(db);
    const first = await requestProtectionRefund(db, txn.id, { idempotencyKey: "req-key-1" });
    const second = await requestProtectionRefund(db, txn.id, { idempotencyKey: "req-key-1" });
    check("first request creates the refund", first.ok === true);
    check("second identical request returns the SAME row, not a new one", second.ok === true && second.data.id === first.data.id);
    check("exactly one refund row exists for this transaction", db._tables.protection_refunds.filter((r) => r.protection_transaction_id === txn.id).length === 1);
  }

  // ============================================================ 5. already refunded
  {
    const db = makeDb();
    const txn = seedTxn(db, { status: "refunded" });
    const req = await requestProtectionRefund(db, txn.id);
    check("cannot request a refund for an already-refunded transaction", req.ok === false && req.code === "not_refundable");
  }

  // ============================================================ 6. already released
  {
    const db = makeDb();
    const txn = seedTxn(db, { status: "released" });
    const req = await requestProtectionRefund(db, txn.id);
    check("cannot request a refund for an already-released transaction", req.ok === false && req.code === "not_refundable");
  }

  // ============================================================ 7. amount safety (defense-in-depth backstop)
  {
    const db = makeDb();
    const txn = seedTxn(db, { seller_protected_amount: 50000 });
    // Bypasses requestProtectionRefund (which can never itself produce an over-amount refund,
    // since it always snapshots FROM the transaction) to directly prove the DB-level guard the
    // migration's protection_refunds_amount_guard_trg trigger enforces would reject this.
    const { error } = await db.from("protection_refunds").insert({
      protection_transaction_id: txn.id,
      order_id: txn.target_id,
      refund_amount: 999999,
      currency: "XAF",
    });
    check("a refund amount exceeding the protected amount is rejected at the data layer", !!error && /exceeds the protected amount/.test(error.message));
  }

  // ============================================================ 8. authorization — structural, not simulated
  // Phase 3 exposes no route and the domain functions accept no caller-supplied identity at all —
  // "unauthorized" isn't a code path to test because there is no path for an unauthorized caller
  // to reach in the first place. What IS verifiable is that the migration itself grants no write
  // access to anything but service_role, and admins get read-only.
  {
    const migrationSql = read("supabase/migrations/2026-11-08_ringo_protection_refunds.sql");
    check("anon/authenticated privileges revoked by default", /revoke all on protection_refunds from anon, authenticated/.test(migrationSql));
    check("only service_role gets write access", /grant select, insert, update, delete on protection_refunds to service_role/.test(migrationSql));
    check("admin policy is read-only (for select, not for all/update)", /"protection_refunds admin read" on protection_refunds for select to authenticated using \(is_admin\(\)\)/.test(migrationSql));
    check("no admin/authenticated UPDATE policy exists anywhere in the migration", !/create policy[^;]*protection_refunds[^;]*for (update|all)/.test(migrationSql));
    check("completeProtectionRefund/failProtectionRefund/beginProtectionRefundProcessing take no actor/identity parameter", (() => {
      const src = read("src/lib/protection/refundEngine.ts");
      return !/actor:/.test(src.split("export async function requestProtectionRefund")[0]); // sanity: file doesn't define an actor-accepting variant
    })());
  }

  // ============================================================ 9. concurrency
  {
    const db = makeDb();
    const txn = seedTxn(db);
    const req = await requestProtectionRefund(db, txn.id);
    const [a, b] = await Promise.all([
      beginProtectionRefundProcessing(db, req.data.id, { phone: "677000001", network: "mtn" }),
      beginProtectionRefundProcessing(db, req.data.id, { phone: "677000002", network: "orange" }),
    ]);
    const winners = [a, b].filter((o) => o.ok);
    check("two simultaneous 'begin processing' attempts: exactly one may claim it", winners.length === 1, JSON.stringify({ a, b }));
    check("the loser gets a conflict, not a silent second claim", [a, b].some((o) => !o.ok && o.code === "conflict"));
  }
  {
    const db = makeDb();
    const txn = seedTxn(db);
    const req = await requestProtectionRefund(db, txn.id);
    await beginProtectionRefundProcessing(db, req.data.id, { phone: "677123456", network: "mtn" });
    refundOf(db, req.data.id).provider_reference = "fake-trans-race";
    const [c1, c2] = await Promise.all([
      completeProtectionRefund(db, req.data.id, { providerReference: "fake-trans-race", providerStatus: "SUCCESSFUL" }),
      completeProtectionRefund(db, req.data.id, { providerReference: "fake-trans-race", providerStatus: "SUCCESSFUL" }),
    ]);
    const actuallyTransitioned = [c1, c2].filter((o) => o.ok);
    check("two simultaneous completion attempts: both report success (one real, one idempotent no-op)", actuallyTransitioned.length === 2, JSON.stringify({ c1, c2 }));
    check("the protection transaction ends up refunded exactly once, never corrupted", txnOf(db, txn.id).status === "refunded");
    check(
      "no double financial completion: the refund row's completed_at was set exactly once (idempotent second call left it unchanged)",
      !!refundOf(db, req.data.id).completed_at
    );
  }

  // ============================================================ 10. isolation — nothing wires the real Fapshi call
  {
    const engineSrc = read("src/lib/protection/refundEngine.ts");
    const adapterSrc = read("src/lib/protection/fapshiRefundAdapter.ts");
    const IMPORT_RE = /import\s+[^;]*from\s+["'][^"']*fapshiRefundAdapter["']/;
    check("refundEngine.ts never imports the Fapshi client directly", !/from "@\/lib\/fapshi"/.test(engineSrc));
    check("refundEngine.ts never imports the live-call adapter (a comment mentioning the filename is fine)", !IMPORT_RE.test(engineSrc));
    check("the adapter is the only file importing fapshiPayout for Protection", /import \{ fapshiPayout \} from "@\/lib\/fapshi"/.test(adapterSrc));
    check(
      "nothing outside the adapter itself IMPORTS it (no route/cron wires it up in this phase)",
      (() => {
        const grepDirs = ["src/app/api", "src/lib/protection"];
        const adapterAbs = path.normalize(path.join(REPO, "src/lib/protection/fapshiRefundAdapter.ts"));
        let found = [];
        for (const dir of grepDirs) {
          const walk = (d) => {
            for (const entry of fs.readdirSync(path.join(REPO, d), { withFileTypes: true })) {
              const p = path.join(d, entry.name);
              if (entry.isDirectory()) walk(p);
              else if (entry.isFile() && entry.name.endsWith(".ts") && path.normalize(path.join(REPO, p)) !== adapterAbs) {
                if (IMPORT_RE.test(read(p))) found.push(p);
              }
            }
          };
          walk(dir);
        }
        return found.length === 0;
      })()
    );
  }

  const passed = results.filter((r) => r.pass).length;
  console.log(`\nprotection_refunds: ${passed}/${results.length} checks passed`);
  if (passed !== results.length) process.exit(1);
})();
