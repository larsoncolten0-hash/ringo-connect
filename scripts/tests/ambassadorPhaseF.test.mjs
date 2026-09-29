// Ambassador Program — Phase F (Ringo Management) unit checks. No
// network, no real database — jiti-loading real TypeScript source and a
// fake Supabase admin client, same conventions as the rest of this suite.
//
//   Run:  node scripts/tests/ambassadorPhaseF.test.mjs
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

// ------------------------------------------------------------------ fake admin client with unique-constraint simulation
function makeFakeAdmin(seed = {}, opts = {}) {
  const tables = new Map();
  for (const [name, rows] of Object.entries(seed)) tables.set(name, new Map(rows.map((r) => [r.id, { ...r }])));
  const calls = { inserts: [], updates: [] };
  let autoId = 1;
  const from = (table) => {
    if (!tables.has(table)) tables.set(table, new Map());
    const store = tables.get(table);
    const filters = [];
    const inFilters = [];
    let op = "select";
    let payload;
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
      insert(p) {
        op = "insert";
        payload = p;
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
    const matches = (row) => filters.every(([k, v]) => row[k] === v) && inFilters.every(([k, vals]) => vals.includes(row[k]));
    function resolve(single) {
      if (op === "insert") {
        // simulate the ambassador_teams.team_leader_user_id unique constraint
        if (table === "ambassador_teams" && opts.uniqueTeamLeader) {
          const dup = Array.from(store.values()).some((r) => r.team_leader_user_id === payload.team_leader_user_id);
          if (dup) return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
        }
        const row = { id: `auto_${autoId++}`, created_at: new Date().toISOString(), ...payload };
        store.set(row.id, row);
        calls.inserts.push({ table, row });
        return { data: single ? row : [row], error: null };
      }
      if (op === "update") {
        const rows = Array.from(store.values()).filter(matches);
        for (const r of rows) Object.assign(r, payload);
        calls.updates.push({ table, patch: payload, ids: rows.map((r) => r.id) });
        return { data: single ? rows[0] ?? null : rows, error: null };
      }
      const rows = Array.from(store.values()).filter(matches);
      return { data: single ? rows[0] ?? null : rows, error: null };
    }
    return b;
  };
  return { _tables: tables, _calls: calls, from };
}

const serverMod = load("lib/supabase/server.ts");
const assertAdminMod = load("lib/assertAdmin.ts");

const asAdmin = () => {
  assertAdminMod.assertAdmin = async () => ({ id: "admin-1" });
};
const asNonAdmin = () => {
  assertAdminMod.assertAdmin = async () => null;
};

const { POST: createAmbassador } = load("app/api/admin/ambassadors/route.ts");
const { PATCH: updateAmbassador } = load("app/api/admin/ambassadors/[id]/route.ts");
const { POST: createTeam } = load("app/api/admin/ambassador-teams/route.ts");
const { PATCH: updateTeam } = load("app/api/admin/ambassador-teams/[id]/route.ts");

const post = (handler, body, params) => handler({ json: async () => body }, params ? { params } : undefined);

// ------------------------------------------------------------------ 1 & 2: admin access works, non-admin denied
{
  asNonAdmin();
  const admin = makeFakeAdmin({ profiles: [{ user_id: "u1", username: "newambassador" }] });
  serverMod.createAdminClient = () => admin;
  const res = await createAmbassador({ json: async () => ({ username: "newambassador" }) });
  check("1. non-admin cannot create an Ambassador (403, nothing inserted)", res.status === 403 && admin._calls.inserts.length === 0);
}

// ------------------------------------------------------------------ create ambassador — happy path + duplicate protection
{
  asAdmin();
  const admin = makeFakeAdmin({ profiles: [{ user_id: "u1", username: "newambassador" }] });
  serverMod.createAdminClient = () => admin;
  const res = await createAmbassador({ json: async () => ({ username: "newambassador" }) });
  const json = await res.json();
  check("2. admin can create an Ambassador for a real username", res.status === 200 && json.ok === true, JSON.stringify(json));
  check("2b. the created row belongs to the resolved user_id, not any client-supplied id", admin._tables.get("ambassador_profiles").get(json.ambassador.id).user_id === "u1");

  const res2 = await createAmbassador({ json: async () => ({ username: "doesnotexist" }) });
  check("2c. an unknown username is rejected (404), nothing inserted", res2.status === 404 && admin._calls.inserts.filter((i) => i.table === "ambassador_profiles").length === 1);

  const res3 = await createAmbassador({ json: async () => ({ username: "newambassador" }) });
  check("2d. creating an Ambassador for an already-Ambassador account is rejected (409)", res3.status === 409);
}

// ------------------------------------------------------------------ 3: ambassador management actions are audited
{
  asAdmin();
  const admin = makeFakeAdmin({
    profiles: [{ user_id: "u2", username: "amb2" }],
    ambassador_profiles: [{ id: "amb-1", user_id: "u2", sales_code: "CODE0001", status: "active", team_id: null }],
  });
  serverMod.createAdminClient = () => admin;
  await updateAmbassador({ json: async () => ({ status: "suspended", reason: "policy violation" }) }, { params: { id: "amb-1" } });
  const actionRows = Array.from(admin._tables.get("ambassador_admin_actions").values());
  check("3. suspending an Ambassador writes an ambassador_admin_actions row", actionRows.length === 1 && actionRows[0].action === "ambassador_updated", JSON.stringify(actionRows));
  check("3b. the audit row records who did it and why", actionRows[0].actor_user_id === "admin-1" && actionRows[0].reason === "policy violation");
  check("3c. the Ambassador's status is actually updated", admin._tables.get("ambassador_profiles").get("amb-1").status === "suspended");
}

// ------------------------------------------------------------------ 4: team reassignment never touches historical ambassador_sales.team_id
{
  asAdmin();
  const admin = makeFakeAdmin({
    ambassador_profiles: [{ id: "amb-3", user_id: "u3", sales_code: "CODE0003", status: "active", team_id: "teamA" }],
    ambassador_teams: [
      { id: "teamA", team_leader_user_id: "leaderA", name: "Team A", status: "active" },
      { id: "teamB", team_leader_user_id: "leaderB", name: "Team B", status: "active" },
    ],
    ambassador_sales: [{ id: "sale-hist", ambassador_id: "amb-3", team_id: "teamA", card_type: "Ringo Physical Card (Standard)", selling_price: "3500.00", status: "milestone_2_earned" }],
  });
  serverMod.createAdminClient = () => admin;

  const res = await updateAmbassador({ json: async () => ({ teamId: "teamB" }) }, { params: { id: "amb-3" } });
  check("4. reassigning an Ambassador's team succeeds", res.status === 200);
  check("4b. the Ambassador's CURRENT team_id is updated", admin._tables.get("ambassador_profiles").get("amb-3").team_id === "teamB");
  check(
    "4c. the historical sale's own team_id snapshot is completely untouched by the reassignment",
    admin._tables.get("ambassador_sales").get("sale-hist").team_id === "teamA",
    JSON.stringify(admin._tables.get("ambassador_sales").get("sale-hist"))
  );
  check("4d. no code path in this route ever writes to the ambassador_sales table at all", admin._calls.updates.every((u) => u.table !== "ambassador_sales"));
}

// ------------------------------------------------------------------ 5: suspended Ambassador cannot create new attributed sales (already-approved SQL, re-verified here)
{
  // ambassador_attribute_sale()'s own WHERE clause is `status = 'active'` —
  // confirmed directly against the approved migration text (not re-run
  // here, no live DB), matching this exact suspend action's effect.
  const fs = await import("fs");
  const migrationSql = fs.readFileSync(path.join(REPO, "supabase/migrations/2026-11-20_ambassador_sales_attribution.sql"), "utf8");
  check(
    "5. ambassador_attribute_sale() only ever resolves an ACTIVE ambassador — a suspended one's code becomes unresolvable the instant this phase's suspend action runs",
    /where sales_code = upper\(trim\(p_ambassador_code\)\) and status = 'active'/.test(migrationSql)
  );
}

// ------------------------------------------------------------------ create team — happy path + duplicate leader protection
{
  asAdmin();
  const admin = makeFakeAdmin({ profiles: [{ user_id: "leaderX", username: "leaderx" }] }, { uniqueTeamLeader: true });
  serverMod.createAdminClient = () => admin;
  const res = await createTeam({ json: async () => ({ teamLeaderUsername: "leaderx", name: "Team X" }) });
  const json = await res.json();
  check("create team: succeeds for a real username", res.status === 200 && json.ok === true);

  const res2 = await createTeam({ json: async () => ({ teamLeaderUsername: "leaderx", name: "Team X Duplicate" }) });
  check("create team: a person who already leads a team is rejected (409), not silently allowed a second team", res2.status === 409);
}

// ------------------------------------------------------------------ team status update + its own audit trail
{
  asAdmin();
  const admin = makeFakeAdmin({ ambassador_teams: [{ id: "team-1", team_leader_user_id: "leaderY", name: "Team Y", status: "active" }] });
  serverMod.createAdminClient = () => admin;
  const res = await updateTeam({ json: async () => ({ status: "inactive" }) }, { params: { id: "team-1" } });
  check("team update: deactivating a team succeeds", res.status === 200 && admin._tables.get("ambassador_teams").get("team-1").status === "inactive");
  const actionRows = Array.from(admin._tables.get("ambassador_admin_actions").values());
  check("team update: is also audited", actionRows.some((a) => a.action === "team_updated"));
}

// ------------------------------------------------------------------ client cannot supply commission/financial fields through any Phase F route
{
  asAdmin();
  const admin = makeFakeAdmin({
    profiles: [{ user_id: "u4", username: "amb4" }],
  });
  serverMod.createAdminClient = () => admin;
  await createAmbassador({
    json: async () => ({ username: "amb4", commission_amount: 999999, commission_percentage: 0.99, sales_code: "HACKED01" }),
  });
  const inserted = admin._calls.inserts.find((i) => i.table === "ambassador_profiles");
  check(
    "no commission/percentage/custom-sales_code field from the request body ever reaches the ambassador_profiles insert",
    inserted && !("commission_amount" in inserted.row) && !("commission_percentage" in inserted.row) && inserted.row.sales_code === undefined,
    JSON.stringify(inserted?.row)
  );
}

// ------------------------------------------------------------------ 6: existing admin functionality — AdminShell.tsx nav change is additive only
{
  const fs = await import("fs");
  const shell = fs.readFileSync(path.join(REPO, "src/components/admin/AdminShell.tsx"), "utf8");
  check("6. AdminShell still has every pre-existing nav entry (Affiliates, Music payouts, Shop payouts, Protection)", /"\/admin\/affiliates"/.test(shell) && /"\/admin\/music-payouts"/.test(shell) && /"\/admin\/shop-payouts"/.test(shell) && /"\/admin\/protection"/.test(shell));
  check("6b. the new Ambassador nav entry was added, not substituted for an existing one", /"\/admin\/ambassadors"/.test(shell));
}

const failed = results.filter((x) => !x.pass);
console.log(`\nambassadorPhaseF: ${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
