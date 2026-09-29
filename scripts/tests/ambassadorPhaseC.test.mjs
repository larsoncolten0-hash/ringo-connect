// Ambassador Program — Phase C (activation + PWA milestone) unit checks.
// No network, no real database — jiti-loading real TypeScript source and a
// fake Supabase admin/session client, same conventions as the rest of
// this suite. The activation eligibility logic itself is NOT faked here
// (that's ambassador_is_activation_ready()'s job, already validated
// against the migration SQL) — these tests only verify the PWA route and
// the safety-net cron call the right function, with the right argument,
// at the right time, idempotently, and never let Ambassador failures
// affect the existing PWA/cron responses.
//
//   Run:  node scripts/tests/ambassadorPhaseC.test.mjs
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

// ------------------------------------------------------------------ fake admin client (shared shape with Phase B's)
function makeFakeAdmin(seed = {}, rpcHandler = null) {
  const tables = new Map();
  for (const [name, rows] of Object.entries(seed)) tables.set(name, new Map(rows.map((r) => [r.id, { ...r }])));
  const calls = { rpc: [] };
  let autoId = 1;
  const from = (table) => {
    if (!tables.has(table)) tables.set(table, new Map());
    const store = tables.get(table);
    const filters = [];
    let op = "select";
    let payload;
    let limitN = null;
    const b = {
      select: () => b,
      order: () => b,
      limit(n) {
        limitN = n;
        return b;
      },
      eq(k, v) {
        filters.push([k, v]);
        return b;
      },
      is(k, v) {
        filters.push([k, v]);
        return b;
      },
      update(p) {
        op = "update";
        payload = p;
        return b;
      },
      single: async () => resolve(true),
      maybeSingle: async () => resolve(true),
      then(res, rej) {
        return Promise.resolve(resolve(false)).then(res, rej);
      },
    };
    const matches = (row) => filters.every(([k, v]) => row[k] === v);
    function resolve(single) {
      if (op === "update") {
        const rows = Array.from(store.values()).filter(matches);
        for (const r of rows) Object.assign(r, payload);
        return { data: single ? rows[0] ?? null : rows, error: null };
      }
      let rows = Array.from(store.values()).filter(matches);
      if (limitN != null) rows = rows.slice(0, limitN);
      return { data: single ? rows[0] ?? null : rows, error: null };
    }
    return b;
  };
  return {
    _tables: tables,
    _calls: calls,
    from,
    rpc: async (name, args) => {
      calls.rpc.push({ name, args });
      if (rpcHandler) return rpcHandler(name, args);
      return { data: { ok: true }, error: null };
    },
  };
}

// ==================================================================
// PWA install route
// ==================================================================
const serverMod = load("lib/supabase/server.ts");
const { POST: pwaInstallPOST } = load("app/api/pwa/install/route.ts");

function setupPwa({ userId = "user-1", ambassadorSale = null, rpcHandler = null } = {}) {
  const admin = makeFakeAdmin(
    {
      users: [{ id: userId, pwa_installed_at: null }],
      ambassador_sales: ambassadorSale ? [ambassadorSale] : [],
    },
    rpcHandler
  );
  serverMod.createClient = () => ({ auth: { getUser: async () => ({ data: { user: { id: userId } } }) } });
  serverMod.createAdminClient = () => admin;
  return admin;
}

const callPwaInstall = async () => {
  const quiet = console.error;
  console.error = () => {};
  try {
    return await pwaInstallPOST();
  } finally {
    console.error = quiet;
  }
};

// 1: PWA install still succeeds normally with no Ambassador sale at all
{
  const admin = setupPwa({ userId: "user-1" });
  const res = await callPwaInstall();
  const json = await res.json();
  check("1. PWA install succeeds for an ordinary (non-Ambassador) user", res.status === 200 && json.ok === true);
  check("1b. no milestone-2 RPC is attempted when there's no in-flight sale", !admin._calls.rpc.some((c) => c.name === "ambassador_evaluate_milestone_2"));
  check("1c. pwa_installed_at is still recorded exactly as before", !!admin._tables.get("users").get("user-1").pwa_installed_at);
}

// 2 & 7: milestone evaluation is attempted after a successful install, with a minimal, DB-only argument
{
  const admin = setupPwa({ userId: "user-2", ambassadorSale: { id: "sale-2", customer_user_id: "user-2", status: "milestone_1_earned" } });
  const res = await callPwaInstall();
  check("2. PWA install still succeeds when an in-flight sale exists", res.status === 200);
  const call = admin._calls.rpc.find((c) => c.name === "ambassador_evaluate_milestone_2");
  check("2b. ambassador_evaluate_milestone_2 is called after a successful install", !!call);
  check(
    "7. the call carries ONLY the sale_id — no profile/category/activation data is computed or passed by this route",
    call && Object.keys(call.args).length === 1 && call.args.p_sale_id === "sale-2",
    JSON.stringify(call?.args)
  );
}

// 3: Ambassador evaluation failure never fails the PWA install response
{
  const admin = setupPwa({
    userId: "user-3",
    ambassadorSale: { id: "sale-3", customer_user_id: "user-3", status: "milestone_1_earned" },
    rpcHandler: () => ({ data: null, error: { message: "unexpected db failure" } }),
  });
  const res = await callPwaInstall();
  const json = await res.json();
  check("3. an unexpected milestone-2 evaluation failure never fails the PWA install response", res.status === 200 && json.ok === true, JSON.stringify(json));
}

// 4 & 5: duplicate PWA pings / already-complete activation are idempotent
{
  // The fake RPC simulates the real DB behavior: once milestone 2 is
  // earned, the sale's own status flips away from 'milestone_1_earned' —
  // which is exactly what makes a second ping's lookup query find nothing.
  const admin = setupPwa({
    userId: "user-4",
    ambassadorSale: { id: "sale-4", customer_user_id: "user-4", status: "milestone_1_earned" },
    rpcHandler: (name, args) => {
      const sale = admin._tables.get("ambassador_sales").get(args.p_sale_id);
      if (sale) sale.status = "milestone_2_earned";
      return { data: { ok: true }, error: null };
    },
  });
  await callPwaInstall(); // first ping — earns milestone 2
  const firstCount = admin._calls.rpc.filter((c) => c.name === "ambassador_evaluate_milestone_2").length;
  await callPwaInstall(); // second (duplicate) ping — sale is no longer 'milestone_1_earned'
  const secondCount = admin._calls.rpc.filter((c) => c.name === "ambassador_evaluate_milestone_2").length;
  check("4. exactly one milestone-2 evaluation attempt on the real transition", firstCount === 1);
  check("4b. a duplicate PWA install ping never re-attempts evaluation once already earned", secondCount === 1, `first=${firstCount} second=${secondCount}`);

  // 5: a sale that's ALREADY at milestone_2_earned from the very start (e.g. re-fired appinstalled) is never touched.
  const admin2 = setupPwa({ userId: "user-5", ambassadorSale: { id: "sale-5", customer_user_id: "user-5", status: "milestone_2_earned" } });
  serverMod.createAdminClient = () => admin2;
  serverMod.createClient = () => ({ auth: { getUser: async () => ({ data: { user: { id: "user-5" } } }) } });
  await callPwaInstall();
  check("5. an already-fully-activated sale is never re-evaluated", !admin2._calls.rpc.some((c) => c.name === "ambassador_evaluate_milestone_2"));
}

// 6: non-Ambassador customers unaffected (same as test 1, different angle — a user with an unrelated sale)
{
  const admin = setupPwa({ userId: "user-6", ambassadorSale: { id: "sale-x", customer_user_id: "some-other-user", status: "milestone_1_earned" } });
  const res = await callPwaInstall();
  check("6. a sale belonging to a DIFFERENT user is never matched or evaluated", res.status === 200 && !admin._calls.rpc.some((c) => c.name === "ambassador_evaluate_milestone_2"));
}

// ==================================================================
// Safety-net cron
// ==================================================================
const { GET: cronGET } = load("app/api/cron/ambassador-activation-sweep/route.ts");
const savedSecret = process.env.CRON_SECRET;

const callCron = async (auth) => {
  const req = new Request("http://localhost/api/cron/ambassador-activation-sweep", { headers: auth === undefined ? {} : { authorization: auth } });
  const quiet = console.error;
  console.error = () => {};
  try {
    return await cronGET(req);
  } finally {
    console.error = quiet;
  }
};

// Auth
{
  delete process.env.CRON_SECRET;
  let res = await callCron("Bearer undefined");
  check("cron: unset CRON_SECRET + 'Bearer undefined' -> 401 (never matches the literal string)", res.status === 401);
  res = await callCron(undefined);
  check("cron: unset CRON_SECRET + no header -> 401", res.status === 401);
  process.env.CRON_SECRET = "real-secret";
  res = await callCron("Bearer wrong");
  check("cron: wrong secret -> 401", res.status === 401);
  res = await callCron("Bearer real-secret");
  check("cron: correct secret -> not 401 (200, proceeds to sweep)", res.status === 200);
}

// Sweep behavior — bounded, correct RPC calls, safe re-run
{
  process.env.CRON_SECRET = "real-secret";
  const admin = makeFakeAdmin(
    {
      ambassador_sales: [
        { id: "s1", status: "milestone_1_earned" },
        { id: "s2", status: "milestone_1_earned" },
        { id: "s3", status: "milestone_2_earned" }, // already done — must be excluded
        { id: "s4", status: "attributed" }, // not yet at milestone 1 — must be excluded
      ],
    },
    (name, args) => {
      if (name === "ambassador_evaluate_milestone_2") {
        const sale = admin._tables.get("ambassador_sales").get(args.p_sale_id);
        // simulate: only s1 is actually activation-ready right now
        if (sale.id === "s1") {
          sale.status = "milestone_2_earned";
          return { data: { ok: true }, error: null };
        }
        return { data: { ok: false, reason: "activation_not_ready" }, error: null };
      }
      return { data: { ok: true }, error: null };
    }
  );
  serverMod.createAdminClient = () => admin;

  const res1 = await callCron("Bearer real-secret");
  const json1 = await res1.json();
  check("sweep: only the two 'milestone_1_earned' sales are checked, not the already-done or not-yet-ready ones", json1.checked === 2, JSON.stringify(json1));
  check("sweep: exactly one of them actually earned milestone 2 this run", json1.earned === 1, JSON.stringify(json1));

  const rpcCallsRun1 = admin._calls.rpc.filter((c) => c.name === "ambassador_evaluate_milestone_2").map((c) => c.args.p_sale_id).sort();
  check("sweep: evaluated exactly s1 and s2, never s3/s4", JSON.stringify(rpcCallsRun1) === JSON.stringify(["s1", "s2"]), JSON.stringify(rpcCallsRun1));

  // Re-run: safe, idempotent — s1 is now excluded (already milestone_2_earned), only s2 remains pending.
  const res2 = await callCron("Bearer real-secret");
  const json2 = await res2.json();
  check("sweep re-run: s1 is no longer picked up (idempotent, no duplicate work)", json2.checked === 1, JSON.stringify(json2));
}

if (savedSecret === undefined) delete process.env.CRON_SECRET;
else process.env.CRON_SECRET = savedSecret;

const failed = results.filter((x) => !x.pass);
console.log(`\nambassadorPhaseC: ${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
