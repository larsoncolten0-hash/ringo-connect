// Ambassador Program — Phase E (Team Leader dashboard) unit checks.
// Same posture as Phase D: no new API route exists (getMyTeamOverview()
// is called directly, server-side, from
// src/app/dashboard/sales-team/page.tsx), so there is no client-supplied
// id anywhere to test an IDOR path against. These tests instead verify:
// strict own-team scoping (two different teams never see each other's
// data), correct HISTORICAL team snapshot behavior (a sale stays with
// the team it was attributed under even after the Ambassador who made it
// moves to a different team), and that every commission figure is summed
// from the ledger joined through this team's own snapshotted sale ids —
// never recomputed from percentages.
//
//   Run:  node scripts/tests/ambassadorPhaseE.test.mjs
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
    from,
    rpc: async (name, args) => {
      if (rpcHandler) return rpcHandler(name, args);
      return { data: { profile_complete: false, pwa_installed: false }, error: null };
    },
  };
}

const serverMod = load("lib/supabase/server.ts");
const { getMyTeamOverview } = load("lib/ambassador/teamDashboard.ts");

// ------------------------------------------------------------------ null for non-team-leaders
{
  const admin = makeFakeAdmin({ ambassador_teams: [{ id: "teamA", team_leader_user_id: "leaderA", name: "Team A", status: "active" }] });
  serverMod.createAdminClient = () => admin;
  check("an ordinary user with no ambassador_teams row gets null", (await getMyTeamOverview("random-user")) === null);
  check("even an Ambassador (not a Team Leader) gets null here — the two roles are independent", (await getMyTeamOverview("some-ambassador-user")) === null);
}

// ------------------------------------------------------------------ own-team scoping + isolation between two teams
{
  const admin = makeFakeAdmin({
    ambassador_teams: [
      { id: "teamA", team_leader_user_id: "leaderA", name: "Team A", status: "active" },
      { id: "teamB", team_leader_user_id: "leaderB", name: "Team B", status: "active" },
    ],
    ambassador_profiles: [
      { id: "amb1", user_id: "amb1user", sales_code: "AMB0001", status: "active", team_id: "teamA" },
      { id: "amb2", user_id: "amb2user", sales_code: "AMB0002", status: "active", team_id: "teamB" },
    ],
    ambassador_sales: [
      { id: "saleA1", ambassador_id: "amb1", team_id: "teamA", card_type: "Ringo Physical Card (Standard)", selling_price: "3500.00", status: "locked", attributed_at: "2026-11-01T00:00:00Z", customer_user_id: null },
      { id: "saleB1", ambassador_id: "amb2", team_id: "teamB", card_type: "Ringo Physical Card (Pro)", selling_price: "5000.00", status: "locked", attributed_at: "2026-11-01T00:00:00Z", customer_user_id: null },
    ],
    ambassador_commission_ledger: [
      { id: "l1", sale_id: "saleA1", recipient_type: "team_leader", recipient_user_id: "leaderA", entry_type: "commission", status: "earned", commission_amount: "87.50" },
      { id: "l2", sale_id: "saleB1", recipient_type: "team_leader", recipient_user_id: "leaderB", entry_type: "commission", status: "earned", commission_amount: "125.00" },
    ],
  });
  serverMod.createAdminClient = () => admin;

  const overviewA = await getMyTeamOverview("leaderA");
  check("Team A's leader sees exactly Team A's sale", overviewA.sales.length === 1 && overviewA.sales[0].id === "saleA1");
  check("Team A's leader never sees Team B's sale", !overviewA.sales.some((s) => s.id === "saleB1"));
  check("Team A's leader sees exactly Team A's ambassador (not Team B's)", overviewA.ambassadors.length === 1 && overviewA.ambassadors[0].salesCode === "AMB0001");
  check("Team A's own commission total is scoped to Team A's ledger rows only (87.50, never Team B's 125.00)", overviewA.summary.teamLeaderCommissionEarned === 87.5, JSON.stringify(overviewA.summary));

  const overviewB = await getMyTeamOverview("leaderB");
  check("Team B's leader sees exactly Team B's sale, isolated from Team A", overviewB.sales.length === 1 && overviewB.sales[0].id === "saleB1" && overviewB.summary.teamLeaderCommissionEarned === 125);
}

// ------------------------------------------------------------------ historical team snapshot — the core Phase E requirement
{
  // amb1 made a sale while on Team A, and has SINCE been moved to Team B
  // (ambassador_profiles.team_id is now 'teamB'). The sale itself must
  // remain Team A's, permanently — never recomputed from the
  // Ambassador's current team assignment.
  const admin = makeFakeAdmin({
    ambassador_teams: [
      { id: "teamA", team_leader_user_id: "leaderA", name: "Team A", status: "active" },
      { id: "teamB", team_leader_user_id: "leaderB", name: "Team B", status: "active" },
    ],
    ambassador_profiles: [
      // amb1's CURRENT team is teamB now — they moved after making the sale below.
      { id: "amb1", user_id: "amb1user", sales_code: "AMB0001", status: "active", team_id: "teamB" },
    ],
    ambassador_sales: [
      // The sale's own team_id snapshot is still 'teamA' — captured at attribution time, never rewritten.
      { id: "saleHist", ambassador_id: "amb1", team_id: "teamA", card_type: "Ringo Physical Card (Standard)", selling_price: "3500.00", status: "milestone_2_earned", attributed_at: "2026-10-01T00:00:00Z", customer_user_id: "cust1" },
    ],
    ambassador_commission_ledger: [
      { id: "l1", sale_id: "saleHist", recipient_type: "ambassador", recipient_user_id: "amb1user", entry_type: "commission", status: "paid", commission_amount: "525.00" },
      { id: "l2", sale_id: "saleHist", recipient_type: "team_leader", recipient_user_id: "leaderA", entry_type: "commission", status: "paid", commission_amount: "175.00" },
    ],
    profiles: [{ user_id: "cust1", name: "Historical Customer", username: "histcust", whatsapp_number: "+237600000099" }],
  });
  serverMod.createAdminClient = () => admin;

  const teamAOverview = await getMyTeamOverview("leaderA");
  check("Team A (the ORIGINAL team) still shows the historical sale, even though the Ambassador has since moved on", teamAOverview.sales.length === 1 && teamAOverview.sales[0].id === "saleHist", JSON.stringify(teamAOverview.sales));
  check("Team A still correctly receives its historical 175.00 (already-paid) team-leader commission for that sale", teamAOverview.summary.teamLeaderCommissionPaid === 175, JSON.stringify(teamAOverview.summary));
  check(
    "Team A's ambassador ROSTER (current membership) correctly no longer lists amb1 — they left — but the historical SALE stays; these are two independent facts",
    teamAOverview.ambassadors.length === 0
  );

  const teamBOverview = await getMyTeamOverview("leaderB");
  check("Team B (amb1's NEW team) does NOT retroactively inherit the historical sale or its commission", teamBOverview.sales.length === 0 && teamBOverview.summary.teamLeaderCommissionEarned === 0, JSON.stringify(teamBOverview));
  check("Team B DOES correctly list amb1 as a current roster member (with zero historical sales under this team)", teamBOverview.ambassadors.length === 1 && teamBOverview.ambassadors[0].salesCode === "AMB0001" && teamBOverview.ambassadors[0].cardsSold === 0);
}

// ------------------------------------------------------------------ ambassador performance figures scoped to the same historical snapshot, never current assignment
{
  const admin = makeFakeAdmin({
    ambassador_teams: [{ id: "teamC", team_leader_user_id: "leaderC", name: "Team C", status: "active" }],
    ambassador_profiles: [{ id: "amb3", user_id: "amb3user", sales_code: "AMB0003", status: "active", team_id: "teamC" }],
    ambassador_sales: [
      { id: "s1", ambassador_id: "amb3", team_id: "teamC", card_type: "Ringo Physical Card (Standard)", selling_price: "3500.00", status: "milestone_2_earned", attributed_at: "2026-11-01T00:00:00Z", customer_user_id: "c1" },
      { id: "s2", ambassador_id: "amb3", team_id: "teamC", card_type: "Ringo Physical Card (Pro)", selling_price: "5000.00", status: "milestone_1_earned", attributed_at: "2026-11-02T00:00:00Z", customer_user_id: "c2" },
      { id: "s3", ambassador_id: "amb3", team_id: "teamC", card_type: "Ringo Physical Card (Standard)", selling_price: "3500.00", status: "attributed", attributed_at: "2026-11-03T00:00:00Z", customer_user_id: null },
    ],
    ambassador_commission_ledger: [
      { id: "l1", sale_id: "s1", recipient_type: "ambassador", recipient_user_id: "amb3user", entry_type: "commission", status: "paid", commission_amount: "525.00" },
      { id: "l2", sale_id: "s2", recipient_type: "ambassador", recipient_user_id: "amb3user", entry_type: "commission", status: "earned", commission_amount: "375.00" },
    ],
    profiles: [
      { user_id: "c1", name: "Customer One", username: "c1", whatsapp_number: null },
      { user_id: "c2", name: null, username: "c2user", whatsapp_number: null },
    ],
  });
  serverMod.createAdminClient = () => admin;
  const overview = await getMyTeamOverview("leaderC");
  const perf = overview.ambassadors[0];
  check("cardsSold counts only sold statuses (locked+), not 'attributed'", perf.cardsSold === 2, JSON.stringify(perf));
  check("registeredCount counts milestone_1_earned + milestone_2_earned", perf.registeredCount === 2);
  check("activatedCount counts only milestone_2_earned", perf.activatedCount === 1);
  check("activationRate = activated/registered, computed here purely as a display ratio, not a DB-owned eligibility decision", perf.activationRate === 0.5);
  check("this ambassador's own earned+paid commission is summed from the ledger, never recomputed from a percentage", perf.commissionEarned === 375 && perf.commissionPaid === 525, JSON.stringify(perf));
}

const failed = results.filter((x) => !x.pass);
console.log(`\nambassadorPhaseE: ${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
