// Ambassador Program — Phase I (lifecycle hardening & reconciliation) unit
// checks. No network, no real database, no real Fapshi. The SQL functions'
// state guards are emulated with small stateful stand-ins so repeated and
// concurrent reconciliation can be exercised at the application level; the
// real guards (WHERE status = ..., unique indexes) live in the unapplied
// migrations and still need live verification (see the Phase I report).
//
//   Run:  node scripts/tests/ambassadorPhaseI.test.mjs
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const jiti = require("jiti")(import.meta.url, { alias: { "@": path.join(REPO, "src") }, interopDefault: true });
const load = (p) => jiti(path.join(REPO, "src", p));
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8");

const results = [];
const check = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond });
  if (!cond) console.log("  FAIL:", name, "|", detail);
};
const captureErrors = async (fn) => {
  const o = console.error;
  const lines = [];
  console.error = (...a) => lines.push(a.map(String).join(" "));
  try {
    return { value: await fn(), lines };
  } finally {
    console.error = o;
  }
};

// ------------------------------------------------------------------ fake admin client
const getPath = (row, key) => key.split(".").reduce((o, k) => (o == null ? o : Array.isArray(o) ? o[0]?.[k] : o[k]), row);
function makeFakeAdmin(seed = {}, rpcHandlers = {}) {
  const tables = new Map();
  for (const [name, rows] of Object.entries(seed)) tables.set(name, new Map(rows.map((r) => [r.id, { ...r }])));
  const calls = { rpc: [], writes: [], selects: [] };
  let autoId = 1;
  const from = (table) => {
    if (!tables.has(table)) tables.set(table, new Map());
    const store = tables.get(table);
    const filters = [];
    let op = "select";
    let payload;
    let max = Infinity;
    let range = null;
    let head = false;
    let wantCount = false;
    let sortBy = null;
    let throwOnRun = null;
    const b = {
      select(_cols, opts) {
        if (opts?.head) head = true;
        if (opts?.count) wantCount = true;
        return b;
      },
      order(k) {
        sortBy = k;
        return b;
      },
      limit(n) {
        max = n;
        return b;
      },
      range(a, z) {
        range = [a, z];
        return b;
      },
      eq(k, v) {
        filters.push((r) => getPath(r, k) === v);
        return b;
      },
      in(k, vals) {
        filters.push((r) => vals.includes(getPath(r, k)));
        return b;
      },
      is(k, v) {
        filters.push((r) => (getPath(r, k) ?? null) === v);
        return b;
      },
      not(k, _op, v) {
        filters.push((r) => (getPath(r, k) ?? null) !== v);
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
        try {
          return Promise.resolve(resolve(false)).then(res, rej);
        } catch (e) {
          return Promise.reject(e).then(res, rej);
        }
      },
    };
    const matches = (row) => filters.every((f) => f(row));
    function resolve(single) {
      if (admin._throwOn === table) throw new Error(`simulated failure reading ${table}`);
      if (op !== "select") calls.writes.push({ table, op, payload });
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
        for (const r of Array.from(store.values()).filter(matches)) store.delete(r.id);
        return { data: null, error: null };
      }
      calls.selects.push(table);
      let rows = Array.from(store.values()).filter(matches);
      if (sortBy) rows.sort((x, y) => String(x[sortBy] ?? "").localeCompare(String(y[sortBy] ?? "")));
      const count = wantCount ? rows.length : undefined;
      if (range) rows = rows.slice(range[0], range[1] + 1);
      rows = rows.slice(0, max);
      if (head) return { data: null, count, error: null };
      return { data: single ? rows[0] ?? null : rows, count, error: null };
    }
    return b;
  };
  const admin = {
    _tables: tables,
    _calls: calls,
    _throwOn: null,
    from,
    rpc: async (name, args) => {
      calls.rpc.push({ name, args });
      if (rpcHandlers[name]) return rpcHandlers[name](args, admin);
      return { data: { ok: true }, error: null };
    },
  };
  return admin;
}

// ------------------------------------------------------------------ mocks
const withBell = load("lib/push/withBell.ts");
let sent = [];
withBell.sendPushAndBellToUser = async (admin, userId, payload) => {
  sent.push({ userId, ...payload });
  await admin.from("notifications").insert({ audience: "user", user_id: userId, type: payload.category, link: payload.url });
};
withBell.sendPushAndBellToAdmins = async () => {};
const fapshi = load("lib/fapshi.ts");
let fapshiStatusImpl = async () => ({ status: "SUCCESSFUL" });
let fapshiPayoutCalled = 0;
fapshi.fapshiGetStatus = async (id, o) => fapshiStatusImpl(id, o);
fapshi.fapshiPayout = async () => {
  fapshiPayoutCalled++;
  return { transId: "NEVER" };
};

const { reconcileAmbassadorLifecycle, findIntegrityIssues } = load("lib/ambassador/reconcile.ts");
const { sweepAmbassadorActivation } = load("lib/ambassador/activationSweep.ts");

// Emulations of the SQL state guards (lock: attributed->locked; M1: locked->milestone_1_earned + ledger rows off the
// sale's OWN snapshotted team; unique ledger key per (sale, recipient, milestone)).
const sqlEmulation = () => ({
  ambassador_lock_sale: async ({ p_signup_request_id }, admin) => {
    const sale = Array.from(admin._tables.get("ambassador_sales").values()).find((s) => s.signup_request_id === p_signup_request_id && s.status === "attributed");
    if (!sale) return { data: null, error: null };
    sale.status = "locked";
    return { data: { ok: true, sale_id: sale.id }, error: null };
  },
  ambassador_evaluate_milestone_1: async ({ p_sale_id, p_customer_user_id }, admin) => {
    const sale = admin._tables.get("ambassador_sales").get(p_sale_id);
    if (!sale || sale.status !== "locked") return { data: { ok: false, reason: "sale_not_locked" }, error: null };
    sale.status = "milestone_1_earned";
    sale.customer_user_id = p_customer_user_id;
    const ledger = admin._tables.get("ambassador_commission_ledger");
    const add = (recipient_type, recipient_user_id) => {
      const key = `${p_sale_id}:${recipient_type}:sale_registration`;
      if (Array.from(ledger.values()).some((l) => `${l.sale_id}:${l.recipient_type}:${l.milestone}` === key)) return;
      ledger.set(key, { id: key, sale_id: p_sale_id, recipient_type, recipient_user_id, milestone: "sale_registration", entry_type: "commission", commission_amount: 1000, currency: "XAF", status: "earned" });
    };
    const amb = Array.from(admin._tables.get("ambassador_profiles").values()).find((a) => a.id === sale.ambassador_id);
    add("ambassador", amb.user_id);
    if (sale.team_id) add("team_leader", admin._tables.get("ambassador_teams").get(sale.team_id).team_leader_user_id);
    return { data: { ok: true, sale_id: p_sale_id }, error: null };
  },
});

const seed = (extra = {}) => ({
  ambassador_profiles: [{ id: "amb1", user_id: "uAmb", team_id: "team-new" }],
  ambassador_teams: [
    { id: "team-old", team_leader_user_id: "uOld" },
    { id: "team-new", team_leader_user_id: "uNew" },
  ],
  ambassador_sales: [],
  ambassador_commission_ledger: [],
  ambassador_payouts: [],
  ...extra,
});
const sale = (id, status, req, over = {}) => ({ id, ambassador_id: "amb1", team_id: "team-old", status, signup_request_id: `sr-${id}`, attributed_at: `2026-01-0${id.length}`, locked_at: "2026-01-02", signup_requests: req, ...over });
const ledgerCount = (admin) => admin._tables.get("ambassador_commission_ledger").size;
const rpcCount = (admin, name) => admin._calls.rpc.filter((c) => c.name === name).length;

// ================================================================== A: paid but never locked
{
  sent = [];
  const admin = makeFakeAdmin(
    seed({
      ambassador_sales: [sale("a", "attributed", { customer_paid: true, status: "pending" }), sale("bb", "attributed", { customer_paid: false, status: "pending" })],
    }),
    sqlEmulation()
  );
  const s = await reconcileAmbassadorLifecycle(admin);
  check("lock: a sale whose payment is confirmed but never locked is locked", s.salesLocked === 1 && admin._tables.get("ambassador_sales").get("a").status === "locked");
  check("lock: an unpaid attributed sale is left alone (no lock call for it)", admin._tables.get("ambassador_sales").get("bb").status === "attributed" && admin._calls.rpc.filter((c) => c.name === "ambassador_lock_sale").every((c) => c.args.p_signup_request_id === "sr-a"));
  check("lock: recovery notifies the Ambassador and the SNAPSHOTTED Team Leader (not the current one)", sent.some((n) => n.userId === "uAmb" && n.category === "ambassador_sale_confirmed") && sent.some((n) => n.userId === "uOld") && !sent.some((n) => n.userId === "uNew"));
}

// ================================================================== B: locked + approved, milestone 1 never recorded
{
  sent = [];
  const admin = makeFakeAdmin(
    seed({
      ambassador_sales: [
        sale("b1", "locked", { status: "approved", created_user_id: "uCust1" }),
        sale("b2", "locked", { status: "pending", created_user_id: null }),
        sale("b3", "locked", { status: "approved", created_user_id: null }),
      ],
    }),
    sqlEmulation()
  );
  const s = await reconcileAmbassadorLifecycle(admin);
  const calls = admin._calls.rpc.filter((c) => c.name === "ambassador_evaluate_milestone_1");
  check("registration: only the locked+approved sale with a recorded user is evaluated", s.registrationsCompleted === 1 && calls.length === 1 && calls[0].args.p_sale_id === "b1" && calls[0].args.p_customer_user_id === "uCust1", JSON.stringify(calls.map((c) => c.args)));
  check("registration: not-yet-approved and approved-without-user sales are NOT touched", admin._tables.get("ambassador_sales").get("b2").status === "locked" && admin._tables.get("ambassador_sales").get("b3").status === "locked");
  check("registration: commissions follow the sale's historical team (uOld), never the Ambassador's current team (uNew)", ledgerCount(admin) === 2 && Array.from(admin._tables.get("ambassador_commission_ledger").values()).some((l) => l.recipient_user_id === "uOld") && !Array.from(admin._tables.get("ambassador_commission_ledger").values()).some((l) => l.recipient_user_id === "uNew"));
  check("registration: recovery notifies exactly the ledger recipients", sent.filter((n) => n.category === "ambassador_registration_completed").length === 2);
  check("registration: reconciliation itself writes nothing to ledger/payout/sale tables (only approved RPCs do)", !admin._calls.writes.some((w) => ["ambassador_commission_ledger", "ambassador_payouts", "ambassador_sales"].includes(w.table) && w.op !== "insert") && !admin._calls.writes.some((w) => w.table === "ambassador_payouts"));
}

// ================================================================== repeated + concurrent reconciliation
{
  sent = [];
  const admin = makeFakeAdmin(
    seed({ ambassador_sales: [sale("r1", "attributed", { customer_paid: true, status: "approved", created_user_id: "uC" })] }),
    sqlEmulation()
  );
  await reconcileAmbassadorLifecycle(admin);
  const afterFirst = { ledger: ledgerCount(admin), sent: sent.length, lock: rpcCount(admin, "ambassador_lock_sale"), m1: rpcCount(admin, "ambassador_evaluate_milestone_1") };
  await reconcileAmbassadorLifecycle(admin);
  await reconcileAmbassadorLifecycle(admin);
  check("repeat: a second and third run make no further lock/milestone calls (recovered sales no longer qualify)", rpcCount(admin, "ambassador_lock_sale") === afterFirst.lock && rpcCount(admin, "ambassador_evaluate_milestone_1") === afterFirst.m1);
  check("repeat: repeated reconciliation creates no extra ledger rows and no extra notifications", ledgerCount(admin) === afterFirst.ledger && sent.length === afterFirst.sent && afterFirst.ledger === 2, JSON.stringify({ afterFirst, now: ledgerCount(admin), sent: sent.length }));

  sent = [];
  const racy = makeFakeAdmin(seed({ ambassador_sales: [sale("c1", "locked", { status: "approved", created_user_id: "uC" })] }), sqlEmulation());
  await Promise.all([reconcileAmbassadorLifecycle(racy), reconcileAmbassadorLifecycle(racy), reconcileAmbassadorLifecycle(racy)]);
  check("concurrent: three overlapping runs still yield one commission row per recipient", ledgerCount(racy) === 2);
  check("concurrent: only the run that won the SQL transition notifies (one per recipient)", sent.filter((n) => n.category === "ambassador_registration_completed").length === 2, `sent=${sent.length}`);
}

// ================================================================== failure isolation + recovery
{
  sent = [];
  const handlers = sqlEmulation();
  const admin = makeFakeAdmin(
    seed({
      ambassador_sales: [sale("f1", "locked", { status: "approved", created_user_id: "u1" }), sale("f2", "locked", { status: "approved", created_user_id: "u2" })],
    }),
    {
      ...handlers,
      ambassador_evaluate_milestone_1: async (args, a) => (args.p_sale_id === "f1" ? { data: null, error: { message: "deadlock detected" } } : handlers.ambassador_evaluate_milestone_1(args, a)),
    }
  );
  const { value: s, lines } = await captureErrors(() => reconcileAmbassadorLifecycle(admin));
  check("failure: one sale's RPC error does not stop the next sale", s.registrationsCompleted === 1 && admin._tables.get("ambassador_sales").get("f2").status === "milestone_1_earned" && admin._tables.get("ambassador_sales").get("f1").status === "locked");
  check("failure: the error is logged with the sale id and the database message only", lines.some((l) => l.includes("f1") && l.includes("deadlock")));
  // Recovery: the next run (fault cleared) finishes it.
  const fixed = makeFakeAdmin(seed({ ambassador_sales: [sale("f1", "locked", { status: "approved", created_user_id: "u1" })] }), sqlEmulation());
  const s2 = await reconcileAmbassadorLifecycle(fixed);
  check("recovery: once the fault clears the interrupted sale completes on the next run", s2.registrationsCompleted === 1);

  const broken = makeFakeAdmin(seed({ ambassador_sales: [sale("g1", "attributed", { customer_paid: true, status: "pending" })] }), sqlEmulation());
  broken._throwOn = "ambassador_payouts";
  const { value: s3 } = await captureErrors(() => reconcileAmbassadorLifecycle(broken));
  check("failure: a step that throws is contained — earlier steps still ran and the failure is reported", s3.salesLocked === 1 && s3.stepErrors.includes("payouts"));
}

// ================================================================== activation sweep fairness
{
  const pendingSales = Array.from({ length: 5 }, (_, i) => ({ id: `s${i + 1}`, status: "milestone_1_earned" }));
  const day = (n) => new Date(n * 86_400_000);
  const seen = new Set();
  let maxPerRun = 0;
  for (const n of [0, 1, 2]) {
    const admin = makeFakeAdmin({ ambassador_sales: pendingSales }, { ambassador_evaluate_milestone_2: async () => ({ data: { ok: false, reason: "activation_not_ready" }, error: null }) });
    const res = await sweepAmbassadorActivation(admin, { limit: 2, now: day(n) });
    maxPerRun = Math.max(maxPerRun, res.checked);
    for (const c of admin._calls.rpc) seen.add(c.args.p_sale_id);
  }
  check("sweep: every run stays within the limit", maxPerRun <= 2);
  check("sweep: with more pending sales than the limit, three consecutive days cover ALL of them (no starvation)", seen.size === 5, [...seen].join());
  const small = makeFakeAdmin({ ambassador_sales: pendingSales.slice(0, 2) });
  const r = await sweepAmbassadorActivation(small, { limit: 200, now: day(7) });
  check("sweep: when everything fits in one window behaviour is unchanged", r.checked === 2);
}

// ================================================================== payouts: finalize what Fapshi resolved
const payout = (id, status, trans, over = {}) => ({ id, recipient_type: "ambassador", recipient_user_id: "uAmb", amount: 5000, currency: "XAF", status, payout_method: "mobile_money", payout_details: { provider: "mtn", phone: "677123456" }, fapshi_trans_id: trans, requested_at: "2026-01-02", ...over });
const processEmu = { ambassador_fail_disbursement: async ({ p_payout_id }, a) => { const r = a._tables.get("ambassador_payouts").get(p_payout_id); if (!["processing", "reconciliation_required"].includes(r.status) || !r.fapshi_trans_id) return { data: { ok: false, reason: "not_failable" }, error: null }; Object.assign(r, { status: "requested", fapshi_trans_id: null }); return { data: { ok: true }, error: null }; }, ambassador_process_payout: async ({ p_payout_id }, a) => ((a._tables.get("ambassador_payouts").get(p_payout_id).status = "paid"), { data: { ok: true }, error: null }) };
{
  sent = [];
  fapshiPayoutCalled = 0;
  fapshiStatusImpl = async (id) => ({ status: id === "TX-OK" ? "SUCCESSFUL" : id === "TX-FAIL" ? "FAILED" : "CREATED" });
  const admin = makeFakeAdmin(seed({ ambassador_payouts: [payout("00000000-0000-4000-8000-000000000001", "processing", "TX-OK"), payout("00000000-0000-4000-8000-000000000022", "processing", "TX-FAIL"), payout("00000000-0000-4000-8000-000000000333", "processing", "TX-WAIT"), payout("00000000-0000-4000-8000-000000004444", "processing", null)] }), processEmu);
  const { value: s, lines } = await captureErrors(() => reconcileAmbassadorLifecycle(admin));
  const rows = admin._tables.get("ambassador_payouts");
  check("payouts: a Fapshi-confirmed payout is finalized through ambassador_process_payout (system actor) and the recipient is told", s.payoutsFinalized === 1 && rows.get("00000000-0000-4000-8000-000000000001").status === "paid" && admin._calls.rpc.some((c) => c.name === "ambassador_process_payout" && c.args.p_actor_user_id === null && c.args.p_fapshi_trans_id === "TX-OK") && sent.some((n) => n.category === "ambassador_payout_paid"));
  check("payouts: a Fapshi-failed payout returns to 'requested' for a deliberate retry — it is not re-sent", s.payoutsReverted === 1 && rows.get("00000000-0000-4000-8000-000000000022").status === "requested" && fapshiPayoutCalled === 0);
  check("payouts: a still-pending payout is left as it is", rows.get("00000000-0000-4000-8000-000000000333").status === "processing");
  check("payouts: a payout with NO transaction id is never auto-changed, never re-sent, and is reported for manual review", rows.get("00000000-0000-4000-8000-000000004444").status === "processing" && fapshiPayoutCalled === 0 && s.integrity.some((f) => f.kind === "payout_processing_without_transaction_id" && f.ids.includes("00000000-0000-4000-8000-000000004444")) && lines.some((l) => l.includes("INTEGRITY") && l.includes("00000000-0000-4000-8000-000000004444")));
  await reconcileAmbassadorLifecycle(admin);
  check("payouts: repeated reconciliation does not finalize or notify the same payout twice", rpcCount(admin, "ambassador_process_payout") === 1 && sent.filter((n) => n.category === "ambassador_payout_paid").length === 1);
  check("payouts: reconciliation never touches ledger rows directly", !admin._calls.writes.some((w) => w.table === "ambassador_commission_ledger"));
}

// ================================================================== integrity detector: read-only
{
  const admin = makeFakeAdmin(
    seed({
      ambassador_payouts: [payout("pp1", "paid", "TX")],
      ambassador_commission_ledger: [
        { id: "l1", sale_id: "sx", payout_id: "pp1", status: "eligible_for_payout", recipient_type: "ambassador", milestone: "sale_registration", entry_type: "commission" },
        { id: "l2", sale_id: "sy", payout_id: "pp1", status: "paid", recipient_type: "ambassador", milestone: "sale_registration", entry_type: "commission" },
      ],
      ambassador_sales: [
        { id: "sx", status: "milestone_1_earned", customer_user_id: "u1", updated_at: "2026-01-03" },
        { id: "sy", status: "milestone_2_earned", customer_user_id: "u2", updated_at: "2026-01-02" },
        { id: "sz", status: "milestone_1_earned", customer_user_id: null, updated_at: "2026-01-01" },
      ],
    })
  );
  const findings = await findIntegrityIssues(admin);
  const kinds = Object.fromEntries(findings.map((f) => [f.kind, f.ids]));
  check("integrity: flags a paid payout with unpaid ledger rows", kinds.paid_payout_with_unpaid_ledger_rows?.includes("pp1"));
  check("integrity: flags a milestone-2 sale that has no activation commission row", kinds.milestone_2_sale_without_commission_row?.includes("sy"));
  check("integrity: flags a milestone sale with no customer user", kinds.milestone_sale_without_customer_user?.includes("sz"));
  check("integrity: the detector is strictly read-only (no writes, no RPC) and returns ids only", admin._calls.writes.length === 0 && admin._calls.rpc.length === 0 && findings.every((f) => f.ids.every((id) => typeof id === "string")));
  const clean = await findIntegrityIssues(makeFakeAdmin(seed()));
  check("integrity: a clean state reports nothing", clean.length === 0);
}

// ================================================================== cron route
{
  const serverMod = load("lib/supabase/server.ts");
  const fake = makeFakeAdmin(
    seed({ ambassador_sales: [sale("k1", "locked", { status: "approved", created_user_id: "uK" })], ambassador_payouts: [payout("pk", "processing", null)] }),
    sqlEmulation()
  );
  serverMod.createAdminClient = () => fake;
  const { GET } = load("app/api/cron/ambassador-activation-sweep/route.ts");
  process.env.CRON_SECRET = "s3cret";
  const ask = (auth) => GET(new Request("http://x/api/cron/ambassador-activation-sweep", { headers: auth ? { authorization: auth } : {} }));
  const denied = await ask(undefined);
  const wrong = await ask("Bearer nope");
  check("cron: still requires the CRON_SECRET (no header / wrong secret -> 401) and does nothing when rejected", denied.status === 401 && wrong.status === 401 && fake._calls.rpc.length === 0);
  const { value: res } = await captureErrors(() => ask("Bearer s3cret"));
  const json = await res.json();
  check("cron: authorized run recovers the stuck sale and reports counts only", res.status === 200 && json.registrationsCompleted === 1 && json.needsReview === 1 && typeof json.checked === "number" && typeof json.earned === "number", JSON.stringify(json));
  check("cron: the response never contains ids, amounts, phones or user data", !/uK|pk|5000|677123456|uAmb/.test(JSON.stringify(json)));
  delete process.env.CRON_SECRET;
  const vercel = JSON.parse(read("vercel.json"));
  check("cron: no new schedule was added — the existing daily ambassador cron does the work", vercel.crons.filter((c) => /ambassador/.test(c.path)).length === 1);
}

// ================================================================== static financial-integrity + isolation
{
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const src = strip(read("src/lib/ambassador/reconcile.ts")) + strip(read("src/lib/ambassador/activationSweep.ts"));
  check("integrity: reconciliation contains no direct insert/update/delete on any table", !/\.(insert|update|delete|upsert)\(/.test(src));
  check("integrity: reconciliation never computes an amount or percentage", !/commission_amount\s*[*+]|percentage|\*\s*0\.\d/.test(src));
  check("isolation: no reference to the legacy affiliate system", !/affiliate/i.test(src));
  check("integrity: reconciliation never calls the payout-sending function", !/sendPayoutViaFapshi|fapshiPayout/.test(src));
}

const failed = results.filter((x) => !x.pass);
console.log(`\nambassadorPhaseI: ${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
