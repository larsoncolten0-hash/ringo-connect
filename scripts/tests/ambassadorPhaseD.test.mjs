// Ambassador Program — Phase D (Ambassador dashboard) unit checks.
// There is no new API route in this phase (getMyAmbassadorOverview() is
// called directly, server-side, from src/app/dashboard/ambassador/page.tsx —
// mirroring the existing /dashboard/affiliate/page.tsx pattern exactly),
// so there is no client-supplied id anywhere to test an IDOR path against.
// These tests instead verify: strict own-data scoping (two different
// ambassadors never see each other's rows), correct stage derivation from
// the database's own status/activation fields (never recomputed
// eligibility logic), correct commission aggregation from the ledger
// (never recalculated amounts), and that the module exposes no write path
// at all.
//
//   Run:  node scripts/tests/ambassadorPhaseD.test.mjs
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

function makeFakeAdmin(seed = {}, rpcHandler = null) {
  const tables = new Map();
  for (const [name, rows] of Object.entries(seed)) tables.set(name, new Map(rows.map((r) => [r.id, { ...r }])));
  const calls = { rpc: [] };
  const from = (table) => {
    if (!tables.has(table)) tables.set(table, new Map());
    const store = tables.get(table);
    const filters = [];
    const inFilters = [];
    const b = {
      select: () => b,
      order: () => b,
      eq(k, v) {
        filters.push([k, v]);
        return b;
      },
      in(k, vals) {
        inFilters.push([k, vals]);
        return b;
      },
      single: async () => resolve(true),
      maybeSingle: async () => resolve(true),
      then(res, rej) {
        return Promise.resolve(resolve(false)).then(res, rej);
      },
    };
    const matches = (row) => filters.every(([k, v]) => row[k] === v) && inFilters.every(([k, vals]) => vals.includes(row[k]));
    function resolve(single) {
      const rows = Array.from(store.values()).filter(matches);
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
      return { data: { profile_complete: false, pwa_installed: false }, error: null };
    },
  };
}

const serverMod = load("lib/supabase/server.ts");
const { getMyAmbassadorOverview } = load("lib/ambassador/dashboard.ts");

// ------------------------------------------------------------------ null for non-ambassadors
{
  const admin = makeFakeAdmin({ ambassador_profiles: [{ id: "amb1", user_id: "user-real-ambassador", sales_code: "ABC1234", status: "active", team_id: null }] });
  serverMod.createAdminClient = () => admin;
  const result = await getMyAmbassadorOverview("some-ordinary-user");
  check("non-ambassador user gets null (drives the page's redirect to /dashboard)", result === null);

  const teamLeaderResult = await getMyAmbassadorOverview("team-leader-with-no-ambassador-row");
  check("a Team Leader with no ambassador_profiles row of their own also gets null — no Ambassador data leaks to them here", teamLeaderResult === null);
}

// ------------------------------------------------------------------ own-data scoping + isolation between two ambassadors
{
  const admin = makeFakeAdmin({
    ambassador_profiles: [
      { id: "amb-A", user_id: "userA", sales_code: "CODEA01", status: "active", team_id: null },
      { id: "amb-B", user_id: "userB", sales_code: "CODEB01", status: "active", team_id: null },
    ],
    ambassador_sales: [
      { id: "saleA1", ambassador_id: "amb-A", card_type: "Ringo Physical Card (Standard)", selling_price: "3500.00", status: "locked", attributed_at: "2026-11-01T00:00:00Z", customer_user_id: null },
      { id: "saleA2", ambassador_id: "amb-A", card_type: "Ringo Physical Card (Pro)", selling_price: "5000.00", status: "milestone_2_earned", attributed_at: "2026-11-02T00:00:00Z", customer_user_id: "customerA2" },
      { id: "saleB1", ambassador_id: "amb-B", card_type: "Ringo Physical Card (Premium)", selling_price: "10000.00", status: "locked", attributed_at: "2026-11-03T00:00:00Z", customer_user_id: null },
    ],
    ambassador_commission_ledger: [
      { id: "l1", recipient_user_id: "userA", recipient_type: "ambassador", entry_type: "commission", status: "earned", commission_amount: "262.50" },
      { id: "l2", recipient_user_id: "userA", recipient_type: "ambassador", entry_type: "commission", status: "paid", commission_amount: "262.50" },
      // A team_leader-recipient row and another ambassador's row on the same underlying sale — must never be summed into userA's totals.
      { id: "l3", recipient_user_id: "some-team-leader", recipient_type: "team_leader", entry_type: "commission", status: "earned", commission_amount: "87.50" },
      { id: "l4", recipient_user_id: "userB", recipient_type: "ambassador", entry_type: "commission", status: "earned", commission_amount: "750.00" },
    ],
    profiles: [{ user_id: "customerA2", name: "Alice Customer", username: "alice", whatsapp_number: "+237600000001" }],
  });
  serverMod.createAdminClient = () => admin;

  const overviewA = await getMyAmbassadorOverview("userA");
  check("ambassador A sees exactly their own 2 sales", overviewA.sales.length === 2, JSON.stringify(overviewA.sales.map((s) => s.id)));
  check("ambassador A's sales never include ambassador B's sale", !overviewA.sales.some((s) => s.id === "saleB1"));
  check("ambassador A's commission summary is scoped to their own recipient_user_id + recipient_type='ambassador' only", overviewA.summary.commissionEarned === 262.5 && overviewA.summary.commissionPaid === 262.5, JSON.stringify(overviewA.summary));

  const overviewB = await getMyAmbassadorOverview("userB");
  check("ambassador B sees exactly their own 1 sale, not ambassador A's", overviewB.sales.length === 1 && overviewB.sales[0].id === "saleB1");
  check("ambassador B's earned total is their own row only (750), never A's or the team leader's", overviewB.summary.commissionEarned === 750, JSON.stringify(overviewB.summary));
}

// ------------------------------------------------------------------ stage derivation — database status/activation fields only, never recomputed eligibility
{
  const admin = makeFakeAdmin(
    {
      ambassador_profiles: [{ id: "amb-C", user_id: "userC", sales_code: "CODEC01", status: "active", team_id: "team1" }],
      ambassador_teams: [{ id: "team1", name: "Test Team" }],
      ambassador_sales: [
        { id: "s-pending", ambassador_id: "amb-C", card_type: "Ringo Physical Card (Standard)", selling_price: "3500.00", status: "attributed", attributed_at: "2026-11-01T00:00:00Z", customer_user_id: null },
        { id: "s-confirmed", ambassador_id: "amb-C", card_type: "Ringo Physical Card (Standard)", selling_price: "3500.00", status: "locked", attributed_at: "2026-11-01T00:00:00Z", customer_user_id: null },
        { id: "s-incomplete", ambassador_id: "amb-C", card_type: "Ringo Physical Card (Standard)", selling_price: "3500.00", status: "milestone_1_earned", attributed_at: "2026-11-01T00:00:00Z", customer_user_id: "cust-incomplete" },
        { id: "s-complete-no-pwa", ambassador_id: "amb-C", card_type: "Ringo Physical Card (Standard)", selling_price: "3500.00", status: "milestone_1_earned", attributed_at: "2026-11-01T00:00:00Z", customer_user_id: "cust-complete" },
        { id: "s-activated", ambassador_id: "amb-C", card_type: "Ringo Physical Card (Standard)", selling_price: "3500.00", status: "milestone_2_earned", attributed_at: "2026-11-01T00:00:00Z", customer_user_id: "cust-activated" },
        { id: "s-refunded", ambassador_id: "amb-C", card_type: "Ringo Physical Card (Standard)", selling_price: "3500.00", status: "refunded", attributed_at: "2026-11-01T00:00:00Z", customer_user_id: null },
      ],
      ambassador_commission_ledger: [],
      profiles: [],
    },
    (name, args) => {
      if (name === "ambassador_activation_status") {
        if (args.p_user_id === "cust-incomplete") return { data: { account_valid: true, profile_complete: false, pwa_installed: false, ready: false }, error: null };
        if (args.p_user_id === "cust-complete") return { data: { account_valid: true, profile_complete: true, pwa_installed: false, ready: false }, error: null };
      }
      return { data: { ok: true }, error: null };
    }
  );
  serverMod.createAdminClient = () => admin;
  const overview = await getMyAmbassadorOverview("userC");
  const byId = Object.fromEntries(overview.sales.map((s) => [s.id, s]));

  check("attributed -> payment_pending", byId["s-pending"].stage === "payment_pending");
  check("locked -> payment_confirmed", byId["s-confirmed"].stage === "payment_confirmed");
  check("milestone_1_earned + profile incomplete -> profile_incomplete", byId["s-incomplete"].stage === "profile_incomplete");
  check("milestone_1_earned + profile complete + pwa not installed -> profile_complete", byId["s-complete-no-pwa"].stage === "profile_complete");
  check("milestone_2_earned -> fully_activated (activation status not even queried for an already-earned sale)", byId["s-activated"].stage === "fully_activated");
  check("refunded -> refunded", byId["s-refunded"].stage === "refunded");
  check("team name is resolved from the snapshot on the ambassador's own profile", overview.ambassador.teamName === "Test Team");

  const followUpIds = overview.followUp.map((f) => f.saleId).sort();
  check(
    "follow-up list excludes fully_activated/refunded, includes the rest",
    JSON.stringify(followUpIds) === JSON.stringify(["s-complete-no-pwa", "s-confirmed", "s-incomplete", "s-pending"].sort()),
    JSON.stringify(followUpIds)
  );
  check("follow-up next action for profile_incomplete is 'complete_profile'", overview.followUp.find((f) => f.saleId === "s-incomplete").nextAction === "complete_profile");
  check("follow-up next action for profile_complete (pwa pending) is 'install_pwa'", overview.followUp.find((f) => f.saleId === "s-complete-no-pwa").nextAction === "install_pwa");
}

// ------------------------------------------------------------------ reversal entries never counted as ordinary earned/paid commission
{
  const admin = makeFakeAdmin({
    ambassador_profiles: [{ id: "amb-D", user_id: "userD", sales_code: "CODED01", status: "active", team_id: null }],
    ambassador_sales: [],
    ambassador_commission_ledger: [
      { id: "r1", recipient_user_id: "userD", recipient_type: "ambassador", entry_type: "commission", status: "paid", commission_amount: "262.50" },
      { id: "r2", recipient_user_id: "userD", recipient_type: "ambassador", entry_type: "reversal", status: "reversed", commission_amount: "-262.50" },
    ],
  });
  serverMod.createAdminClient = () => admin;
  const overview = await getMyAmbassadorOverview("userD");
  check("a reversal row is summed separately (as a positive magnitude) and never added into 'paid'", overview.summary.commissionPaid === 262.5 && overview.summary.commissionReversed === 262.5, JSON.stringify(overview.summary));
}

// ------------------------------------------------------------------ no write path exists in this module at all
{
  const mod = load("lib/ambassador/dashboard.ts");
  const exportedFunctionNames = Object.keys(mod).filter((k) => typeof mod[k] === "function");
  check("the dashboard module exports exactly one function — the read-only overview getter", JSON.stringify(exportedFunctionNames) === JSON.stringify(["getMyAmbassadorOverview"]), JSON.stringify(exportedFunctionNames));
}

const failed = results.filter((x) => !x.pass);
console.log(`\nambassadorPhaseD: ${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
