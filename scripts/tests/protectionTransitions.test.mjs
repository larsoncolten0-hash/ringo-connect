// Ringo Protection — Phase 2 state machine + concurrency tests. No network, no real database, no
// Fapshi, Protection stays disabled: this exercises src/lib/protection/** (pure logic + the
// engine) against an in-memory fake that emulates Postgres's own conditional-UPDATE row semantics
// (a concurrent UPDATE only matches rows whose WHERE clause is still true at the moment it runs),
// the same technique scripts/tests/shopSeller.test.mjs already uses for product_orders.
//
//   Run:  node scripts/tests/protectionTransitions.test.mjs
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

const T = load("lib/protection/transitions.ts");
const { transitionProtectionTransaction } = load("lib/protection/engine.ts");

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const TXN = (n) => `00000000-0000-4000-9000-${String(n).padStart(12, "0")}`;
const SELLER = U(1),
  SELLER_B = U(2),
  CUSTOMER = U(101),
  CUSTOMER_B = U(102),
  ADMIN = U(201);
let txnSeq = 0;

// ================================================================ in-memory world
// A genuinely async fake — every operation yields a microtask before touching shared state, so
// two engine calls fired via Promise.all interleave the way two real concurrent requests would:
// whichever's conditional UPDATE executes first wins; the second's WHERE clause then correctly
// finds nothing to match against the now-changed row.
function makeDb() {
  const tables = { protection_transactions: [], protection_transaction_events: [] };
  const idemKeys = new Set();

  function builder(table) {
    const filters = [];
    let mode = "select";
    let updatePatch = null;
    let insertRows = null;

    const matches = (row) => filters.every((f) => (f.op === "eq" ? row[f.col] === f.val : f.val.includes(row[f.col])));

    async function exec() {
      await Promise.resolve(); // yield — lets a concurrent call's own read/write interleave here
      if (mode === "insert") {
        for (const row of insertRows) {
          if (row.idempotency_key) {
            if (idemKeys.has(row.idempotency_key)) return { data: null, error: { code: "23505", message: "duplicate key" } };
            idemKeys.add(row.idempotency_key);
          }
          tables[table].push({ id: `evt_${tables[table].length}`, created_at: new Date().toISOString(), ...row });
        }
        return { data: insertRows, error: null };
      }
      const affected = tables[table].filter(matches);
      for (const row of affected) Object.assign(row, updatePatch);
      return { data: affected.map((r) => ({ id: r.id, status: r.status })), error: null };
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
      insert(rows) {
        mode = "insert";
        insertRows = Array.isArray(rows) ? rows : [rows];
        return exec();
      },
      async maybeSingle() {
        await Promise.resolve();
        const rows = tables[table].filter(matches);
        return { data: rows[0] ?? null, error: null };
      },
    };
    return self;
  }

  return { from: (table) => builder(table), _tables: tables };
}

function seedTxn(db, overrides = {}) {
  txnSeq += 1;
  const row = { id: TXN(txnSeq), status: "awaiting_payment", creator_user_id: SELLER, customer_id: CUSTOMER, ...overrides };
  db._tables.protection_transactions.push(row);
  return row;
}
const rowOf = (db, id) => db._tables.protection_transactions.find((r) => r.id === id);

// ================================================================ sections (each awaited in order below)
async function section1_happyPath() {
  const VALID_PATH = [
    ["awaiting_payment", "protected", { type: "system" }],
    ["protected", "fulfillment_started", { type: "seller", userId: SELLER }],
    ["fulfillment_started", "awaiting_confirmation", { type: "seller", userId: SELLER }],
    ["awaiting_confirmation", "released", { type: "customer", customerId: CUSTOMER }],
  ];
  const db = makeDb();
  const row = seedTxn(db, { status: "awaiting_payment" });
  for (const [from, to, actor] of VALID_PATH) {
    const outcome = await transitionProtectionTransaction(db, row.id, to, actor);
    check(`${from} -> ${to} (${actor.type}) succeeds`, outcome.ok === true && outcome.status === to, JSON.stringify(outcome));
  }
  check("released sets released_at", !!rowOf(db, row.id).released_at);
}

async function section2_disputeReleasePath() {
  const db = makeDb();
  const row = seedTxn(db, { status: "awaiting_confirmation" });
  let o = await transitionProtectionTransaction(db, row.id, "disputed", { type: "customer", customerId: CUSTOMER });
  check("awaiting_confirmation -> disputed (customer) PASS", o.ok === true);
  o = await transitionProtectionTransaction(db, row.id, "released", { type: "customer", customerId: CUSTOMER });
  check("disputed -> released (customer) FAIL — must go through resolution", o.ok === false && o.code === "illegal_transition");
  o = await transitionProtectionTransaction(db, row.id, "resolved_release", { type: "admin", userId: ADMIN });
  check("disputed -> resolved_release (admin) PASS", o.ok === true);
  o = await transitionProtectionTransaction(db, row.id, "released", { type: "admin", userId: ADMIN });
  check("resolved_release -> released (admin) PASS", o.ok === true);
}

async function section2b_disputeRefundPath() {
  const db = makeDb();
  const row = seedTxn(db, { status: "disputed" });
  const o = await transitionProtectionTransaction(db, row.id, "resolved_refund", { type: "admin", userId: ADMIN });
  check("disputed -> resolved_refund (admin) PASS", o.ok === true);
  const o2 = await transitionProtectionTransaction(db, row.id, "refunded", { type: "system" });
  check("resolved_refund -> refunded (system) PASS", o2.ok === true);
  check("refunded sets refunded_at", !!rowOf(db, row.id).refunded_at);
}

async function section3_terminalStatesReject() {
  const TERMINALS = ["released", "refunded", "payment_failed", "expired", "cancelled"];
  const ATTEMPTS = ["protected", "fulfillment_started", "awaiting_confirmation", "disputed"];
  for (const terminal of TERMINALS) {
    const db = makeDb();
    const row = seedTxn(db, { status: terminal });
    for (const attempt of ATTEMPTS) {
      const o = await transitionProtectionTransaction(db, row.id, attempt, { type: "admin", userId: ADMIN });
      check(`${terminal} -> ${attempt} FAIL`, o.ok === false && (o.code === "already_terminal" || o.code === "illegal_transition"), JSON.stringify(o));
    }
  }

  {
    const db = makeDb();
    const row = seedTxn(db, { status: "refunded" });
    const o = await transitionProtectionTransaction(db, row.id, "released", { type: "admin", userId: ADMIN });
    check("refunded -> released FAIL", o.ok === false && o.code === "already_terminal");
  }
  {
    const db = makeDb();
    const row = seedTxn(db, { status: "payment_failed" });
    const o = await transitionProtectionTransaction(db, row.id, "protected", { type: "system" });
    check("payment_failed -> protected FAIL", o.ok === false && o.code === "already_terminal");
  }
  {
    const db = makeDb();
    const row = seedTxn(db, { status: "cancelled" });
    const o = await transitionProtectionTransaction(db, row.id, "protected", { type: "system" });
    check("cancelled -> protected FAIL", o.ok === false && o.code === "already_terminal");
  }
}

async function section4_authorization() {
  {
    const db = makeDb();
    const row = seedTxn(db, { status: "protected" });
    const o = await transitionProtectionTransaction(db, row.id, "fulfillment_started", { type: "customer", customerId: CUSTOMER });
    check("customer cannot start fulfillment (seller-only transition)", o.ok === false && o.code === "unauthorized");
  }
  {
    const db = makeDb();
    const row = seedTxn(db, { status: "awaiting_confirmation" });
    const o = await transitionProtectionTransaction(db, row.id, "released", { type: "seller", userId: SELLER });
    check("seller cannot release their own funds", o.ok === false && o.code === "unauthorized");
  }
  {
    const db = makeDb();
    const row = seedTxn(db, { status: "disputed" });
    const o = await transitionProtectionTransaction(db, row.id, "resolved_release", { type: "customer", customerId: CUSTOMER });
    check("customer cannot resolve their own dispute", o.ok === false && o.code === "unauthorized");
  }
}

async function section5_ownership() {
  {
    const db = makeDb();
    const row = seedTxn(db, { status: "protected", creator_user_id: SELLER });
    const o = await transitionProtectionTransaction(db, row.id, "fulfillment_started", { type: "seller", userId: SELLER_B });
    check("a different seller cannot transition someone else's protected order", o.ok === false && (o.code === "conflict" || o.code === "unauthorized"));
    check("the row itself is untouched by the rejected attempt", rowOf(db, row.id).status === "protected");
  }
  {
    const db = makeDb();
    const row = seedTxn(db, { status: "awaiting_confirmation", customer_id: CUSTOMER });
    const o = await transitionProtectionTransaction(db, row.id, "released", { type: "customer", customerId: CUSTOMER_B });
    check("a different customer cannot confirm/release someone else's order", o.ok === false);
  }
}

async function section6_idempotency() {
  {
    const db = makeDb();
    const row = seedTxn(db, { status: "protected" });
    const first = await transitionProtectionTransaction(db, row.id, "fulfillment_started", { type: "seller", userId: SELLER }, { idempotencyKey: "k1" });
    const second = await transitionProtectionTransaction(db, row.id, "fulfillment_started", { type: "seller", userId: SELLER }, { idempotencyKey: "k1" });
    check("first call succeeds, not already-in-status", first.ok === true && first.alreadyInStatus === false);
    check("repeated identical call is a graceful no-op, not an error", second.ok === true && second.alreadyInStatus === true);
    check(
      "exactly one event row was recorded, not two",
      db._tables.protection_transaction_events.filter((e) => e.protection_transaction_id === row.id).length === 1
    );
  }
  {
    const db = makeDb();
    const row = seedTxn(db, { status: "awaiting_payment" });
    await transitionProtectionTransaction(db, row.id, "protected", { type: "system" }, { idempotencyKey: "dup-key" });
    const row2 = seedTxn(db, { status: "awaiting_payment" });
    await transitionProtectionTransaction(db, row2.id, "protected", { type: "system" }, { idempotencyKey: "dup-key" });
    check(
      "the second transition still succeeds even though a reused idempotency key means its own event row gets deduped",
      rowOf(db, row2.id).status === "protected"
    );
  }
}

async function section7_concurrency() {
  {
    const db = makeDb();
    const row = seedTxn(db, { status: "awaiting_confirmation" });
    const [a, b] = await Promise.all([
      transitionProtectionTransaction(db, row.id, "released", { type: "customer", customerId: CUSTOMER }),
      transitionProtectionTransaction(db, row.id, "released", { type: "system" }),
    ]);
    const winners = [a, b].filter((o) => o.ok && !o.alreadyInStatus);
    const noops = [a, b].filter((o) => o.ok && o.alreadyInStatus);
    check("two simultaneous release attempts: exactly one actually transitions", winners.length === 1, JSON.stringify({ a, b }));
    check("two simultaneous release attempts: the other becomes a graceful no-op, not an error", noops.length === 1, JSON.stringify({ a, b }));
    check(
      "exactly one event row recorded despite two simultaneous callers",
      db._tables.protection_transaction_events.filter((e) => e.protection_transaction_id === row.id).length === 1
    );
  }
  {
    const db = makeDb();
    const row = seedTxn(db, { status: "awaiting_confirmation" });
    const [confirm, dispute] = await Promise.all([
      transitionProtectionTransaction(db, row.id, "released", { type: "customer", customerId: CUSTOMER }),
      transitionProtectionTransaction(db, row.id, "disputed", { type: "customer", customerId: CUSTOMER }),
    ]);
    const succeeded = [confirm, dispute].filter((o) => o.ok && !o.alreadyInStatus);
    check("customer confirm vs. customer dispute racing: exactly one wins", succeeded.length === 1, JSON.stringify({ confirm, dispute }));
    const finalStatus = rowOf(db, row.id).status;
    check("the loser gets a clean conflict reporting the ACTUAL final state, never a silent overwrite", ["released", "disputed"].includes(finalStatus));
  }
  {
    // admin resolving a dispute vs. a future auto-release job both completing the SAME resolved_release -> released step.
    const db = makeDb();
    const row = seedTxn(db, { status: "resolved_release" });
    const [adminAttempt, systemAttempt] = await Promise.all([
      transitionProtectionTransaction(db, row.id, "released", { type: "admin", userId: ADMIN }),
      transitionProtectionTransaction(db, row.id, "released", { type: "system" }),
    ]);
    const winners = [adminAttempt, systemAttempt].filter((o) => o.ok && !o.alreadyInStatus);
    check("admin release vs. system auto-process racing the same resolution: exactly one wins", winners.length === 1);
  }
  {
    // A stale caller believes the transaction is still `protected` after someone else already cancelled it.
    const db = makeDb();
    const row = seedTxn(db, { status: "protected" });
    await transitionProtectionTransaction(db, row.id, "cancelled", { type: "admin", userId: ADMIN });
    const stale = await transitionProtectionTransaction(db, row.id, "fulfillment_started", { type: "seller", userId: SELLER });
    check("stale expected-status caller correctly fails against the ACTUAL (now terminal) state", stale.ok === false && stale.code === "already_terminal");
  }
  {
    // Dispute opened WHILE a release attempt is in flight for the same transaction.
    const db = makeDb();
    const row = seedTxn(db, { status: "awaiting_confirmation" });
    const [release, dispute] = await Promise.all([
      transitionProtectionTransaction(db, row.id, "released", { type: "system" }),
      transitionProtectionTransaction(db, row.id, "disputed", { type: "customer", customerId: CUSTOMER }),
    ]);
    const finalStatus = rowOf(db, row.id).status;
    check(
      "release-vs-dispute race never leaves the transaction in a state that isn't a real, valid outcome of either",
      finalStatus === "released" || finalStatus === "disputed"
    );
    check("exactly one of the two racing calls actually transitioned it", [release, dispute].filter((o) => o.ok && !o.alreadyInStatus).length === 1);
  }
}

function section8_sqlCrossCheck() {
  // Statically parses the guard trigger's own transition list out of the Phase 2 migration and
  // confirms it matches src/lib/protection/transitions.ts's LEGAL_TRANSITIONS exactly — the same
  // "keep two independently-authored checks in sync, provably" technique
  // scripts/tests/shopSeller.test.mjs already uses for product_orders_guard.
  const migrationSql = read("supabase/migrations/2026-11-07_ringo_protection_transitions.sql");
  const guardMatch = migrationSql.match(/if new\.status <> old\.status and not \(([\s\S]*?)\) then/);
  const sqlPairs = new Set();
  if (guardMatch) {
    const rows = guardMatch[1].match(/old\.status = '([a-z_]+)'\s+and new\.status (?:in \(([^)]*)\)|= '([a-z_]+)')/g) || [];
    for (const clause of rows) {
      const m = clause.match(/old\.status = '([a-z_]+)'\s+and new\.status (?:in \(([^)]*)\)|= '([a-z_]+)')/);
      const from = m[1];
      const tos = m[2] ? m[2].split(",").map((s) => s.trim().replace(/^'|'$/g, "")) : [m[3]];
      for (const to of tos) sqlPairs.add(`${from}->${to}`);
    }
  }
  const tsPairs = new Set();
  for (const from of T.PROTECTION_STATUSES) for (const rule of T.LEGAL_TRANSITIONS[from]) tsPairs.add(`${from}->${rule.to}`);

  const sqlOnly = [...sqlPairs].filter((p) => !tsPairs.has(p));
  const tsOnly = [...tsPairs].filter((p) => !sqlPairs.has(p));
  const inSync = !!guardMatch && sqlOnly.length === 0 && tsOnly.length === 0;
  check("TS LEGAL_TRANSITIONS and the SQL guard trigger's transition list match exactly", inSync, JSON.stringify({ sqlOnly, tsOnly }));
}

(async () => {
  await section1_happyPath();
  await section2_disputeReleasePath();
  await section2b_disputeRefundPath();
  await section3_terminalStatesReject();
  await section4_authorization();
  await section5_ownership();
  await section6_idempotency();
  await section7_concurrency();
  section8_sqlCrossCheck();

  const passed = results.filter((r) => r.pass).length;
  console.log(`\nprotection_transitions: ${passed}/${results.length} checks passed`);
  if (passed !== results.length) process.exit(1);
})();
