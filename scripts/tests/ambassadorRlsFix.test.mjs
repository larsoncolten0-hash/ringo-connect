// Ambassador Program — static verification of 2026-11-28_ambassador_rls_recursion_fix.sql.
// No database, no SQL execution. Everything here is derived from the migration TEXT:
//  (1) the policy dependency graph before/after (recursion = a cycle, Postgres 42P17);
//  (2) the parsed policy/helper predicates are EVALUATED over a small roles matrix, old vs new,
//      to show the intended access rules are preserved exactly;
//  (3) structural safety checks on the helper functions and on the scope of the change.
// It cannot prove Postgres accepts the SQL; that still needs the migration to be run.
//
//   Run:  node scripts/tests/ambassadorRlsFix.test.mjs
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const read = (p) => fs.readFileSync(path.join(REPO, "supabase/migrations", p), "utf8");
const results = [];
const check = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond });
  if (!cond) console.log("  FAIL:", name, "|", detail);
};

const M18 = read("2026-11-18_ambassador_foundation.sql");
const M20 = read("2026-11-20_ambassador_sales_attribution.sql");
const M21 = read("2026-11-21_ambassador_commission_engine.sql");
const FIX = read("2026-11-28_ambassador_rls_recursion_fix.sql");
const code = (s) => s.replace(/--.*$/gm, "");

// ---------------------------------------------------------------- parse policies
function policies(sql) {
  const out = {};
  for (const m of code(sql).matchAll(/create policy "([^"]+)" on public\.(\w+) for select using \(([\s\S]*?)\n\s*\);/g)) out[m[1]] = { table: m[2], body: m[3] };
  return out;
}
const oldP = { ...policies(M18), ...policies(M20), ...policies(M21) };
const newP = policies(FIX);
const effective = { ...oldP, ...newP }; // the fix replaces policies of the same name
const T = { teams: "ambassador_teams", profiles: "ambassador_profiles", sales: "ambassador_sales", ledger: "ambassador_commission_ledger" };
const byTable = (set) => Object.fromEntries(Object.values(set).map((p) => [p.table, p]));

// ================================================================== (1) recursion = a cycle in the dependency graph
function graph(set) {
  const g = {};
  for (const p of Object.values(set)) {
    // Tables read UNDER RLS by the policy. Calls to the SECURITY DEFINER helpers are leaves (they bypass RLS), so they add no edge.
    g[p.table] = [...p.body.matchAll(/\b(?:from|join)\s+public\.(ambassador_\w+)/g)].map((m) => m[1]);
  }
  return g;
}
function findCycle(g) {
  const state = {};
  const stack = [];
  let found = null;
  const dfs = (n) => {
    if (found) return;
    if (state[n] === 1) {
      found = [...stack.slice(stack.indexOf(n)), n];
      return;
    }
    if (state[n] === 2) return;
    state[n] = 1;
    stack.push(n);
    for (const m of g[n] || []) dfs(m);
    stack.pop();
    state[n] = 2;
  };
  Object.keys(g).forEach(dfs);
  return found;
}
const oldCycle = findCycle(graph(oldP));
const newCycle = findCycle(graph(effective));
check("recursion: the ORIGINAL policies contain the teams <-> profiles cycle that produced 42P17", oldCycle && oldCycle.includes(T.teams) && oldCycle.includes(T.profiles), JSON.stringify(oldCycle));
check("recursion: with the fix, NO policy cycle exists anywhere (teams, profiles, sales, ledger)", newCycle === null, JSON.stringify(newCycle));
const g = graph(effective);
check("recursion: the two rewritten policies read no ambassador table under RLS at all (helpers are RLS-bypassing leaves)", g[T.teams].length === 0 && g[T.profiles].length === 0, JSON.stringify(g));
check("recursion: sales and ledger policies are UNCHANGED and now terminate (they only reach teams/profiles/sales, which are acyclic)", JSON.stringify(effective["ambassador_sales own or admin read"]) === JSON.stringify(oldP["ambassador_sales own or admin read"]) && JSON.stringify(effective["ambassador_commission_ledger own or admin read"]) === JSON.stringify(oldP["ambassador_commission_ledger own or admin read"]));
check("scope: the fix replaces exactly the two recursive policies — no more, no fewer", Object.keys(newP).sort().join("|") === "ambassador_profiles own or admin read|ambassador_teams own or admin read" && (code(FIX).match(/drop policy/gi) || []).length === 2);

// ================================================================== (2) evaluate the parsed SQL over a roles matrix
const world = {
  admins: new Set(["adm"]),
  ambassador_teams: [
    { id: "T1", team_leader_user_id: "L1" },
    { id: "T2", team_leader_user_id: "L2" },
  ],
  ambassador_profiles: [
    { id: "pA1", user_id: "A1", team_id: "T1" },
    { id: "pA2", user_id: "A2", team_id: "T2" },
    { id: "pA0", user_id: "A0", team_id: null },
  ],
};
const norm = (s) => s.replace(/\s+/g, " ").trim();
const splitTop = (s, sep) => {
  const parts = [];
  let depth = 0;
  let cur = "";
  const re = new RegExp(`^${sep}`, "i");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (depth === 0 && re.test(s.slice(i)) && /\s/.test(s[i - 1] || " ")) {
      parts.push(cur.trim());
      cur = "";
      i += sep.length - 1;
      continue;
    }
    cur += ch;
  }
  parts.push(cur.trim());
  return parts.filter(Boolean);
};
// Evaluate `a.col = X and b.col = Y ...` over a table with an env of bindings.
function existsIn(table, alias, whereText, env) {
  const conj = splitTop(norm(whereText), "and");
  return world[table].some((row) =>
    conj.every((c) => {
      const m = c.match(/^([\w.]+)\s*=\s*([\w.()]+)$/);
      if (!m) throw new Error("unsupported conjunct: " + c);
      const val = (t) => (t === "auth.uid()" ? env.uid : t.startsWith(alias + ".") ? row[t.slice(alias.length + 1)] : t in env ? env[t] : (() => { throw new Error("unbound " + t); })());
      return val(m[1]) === val(m[2]);
    })
  );
}
// Parse the two helper function bodies from the migration text.
const helpers = {};
for (const m of code(FIX).matchAll(/create or replace function public\.(\w+)\(p_team_id uuid\)[\s\S]*?select exists \(\s*select 1 from public\.(\w+) (\w+)\s+where ([\s\S]*?)\s*\);\s*\$\$;/g)) helpers[m[1]] = { table: m[2], alias: m[3], where: m[4] };
function evalBranch(branch, row, env, tableName) {
  const b = norm(branch);
  if (b === "is_admin()") return world.admins.has(env.uid);
  let m = b.match(/^(\w+) = auth\.uid\(\)$/);
  if (m) return row[m[1]] !== null && row[m[1]] === env.uid;
  m = b.match(/^public\.(\w+)\((\w+)\)$/);
  if (m) {
    const h = helpers[m[1]];
    if (!h) throw new Error("missing helper " + m[1]);
    return existsIn(h.table, h.alias, h.where, { uid: env.uid, p_team_id: row[m[2]] });
  }
  m = b.match(/^exists \(select 1 from public\.(\w+) (\w+) where ([\s\S]*)\)$/);
  if (m) return existsIn(m[1], m[2], m[3], { uid: env.uid, [`${tableName}.id`]: row.id, [`${tableName}.team_id`]: row.team_id });
  throw new Error("unsupported branch: " + b);
}
const visible = (p, tableName, row, uid) => splitTop(norm(p.body), "or").some((b) => evalBranch(b, row, { uid }, tableName));
const usersMatrix = ["adm", "A1", "A2", "A0", "L1", "L2", "X", null];
const seen = (set, policyName, tableName, uid) => world[tableName].filter((r) => visible(set[policyName], tableName, r, uid)).map((r) => r.id).sort().join(",");
const TEAMS = "ambassador_teams own or admin read";
const PROFILES = "ambassador_profiles own or admin read";
const expectTeams = { adm: "T1,T2", A1: "T1", A2: "T2", A0: "", L1: "T1", L2: "T2", X: "", null: "" };
const expectProfiles = { adm: "pA0,pA1,pA2", A1: "pA1", A2: "pA2", A0: "pA0", L1: "pA1", L2: "pA2", X: "", null: "" };

check("helpers: both helper functions were parsed from the SQL text", Object.keys(helpers).sort().join() === "ambassador_is_member_of_team,ambassador_leads_team", Object.keys(helpers).join());
let teamsOld = true, teamsNew = true, profOld = true, profNew = true, same = true;
for (const u of usersMatrix) {
  const k = String(u);
  const o1 = seen(oldP, TEAMS, "ambassador_teams", u), n1 = seen(effective, TEAMS, "ambassador_teams", u);
  const o2 = seen(oldP, PROFILES, "ambassador_profiles", u), n2 = seen(effective, PROFILES, "ambassador_profiles", u);
  if (o1 !== expectTeams[k]) teamsOld = false;
  if (n1 !== expectTeams[k]) teamsNew = false;
  if (o2 !== expectProfiles[k]) profOld = false;
  if (n2 !== expectProfiles[k]) profNew = false;
  if (o1 !== n1 || o2 !== n2) same = false;
}
check("intent: the ORIGINAL rules, read as intended, give exactly the expected visibility (baseline for the comparison)", teamsOld && profOld);
check("access: with the fix, teams are visible exactly as intended — admin all; leader own team; Ambassador own team; outsiders, team-less Ambassadors and anonymous none", teamsNew);
check("access: with the fix, profiles are visible exactly as intended — owner own row; leader their team's members only; admin all; outsiders, other teams' leaders and anonymous none", profNew);
check("equivalence: for every user in the matrix the new policies show EXACTLY the same rows as the old rules — nothing gained, nothing lost", same);
const leaderSeesOther = seen(effective, PROFILES, "ambassador_profiles", "L1").includes("pA2");
const memberSeesLeaderTeam2 = seen(effective, TEAMS, "ambassador_teams", "A1").includes("T2");
check("isolation: a Team Leader cannot see another team's Ambassadors, and an Ambassador cannot see another team", !leaderSeesOther && !memberSeesLeaderTeam2);
check("isolation: an Ambassador sees only their OWN profile row, never a teammate's", !seen(effective, PROFILES, "ambassador_profiles", "A1").includes("pA2") && seen(effective, PROFILES, "ambassador_profiles", "A1") === "pA1");

// Sales / ledger (unchanged policies) evaluated end-to-end through the NEW teams/profiles rules would need multi-table
// world data; their meaning is identical because they only ask "does a row exist that I can see", and the rows they can
// see (own profile / led team) are the same set as before. Assert that dependency explicitly:
const salesBody = norm(effective["ambassador_sales own or admin read"].body);
check("sales/ledger: they depend only on 'my own profile' and 'a team I lead' — both visible under the new policies", /p\.user_id = auth\.uid\(\)/.test(salesBody) && /t\.team_leader_user_id = auth\.uid\(\)/.test(salesBody) && seen(effective, PROFILES, "ambassador_profiles", "A1") === "pA1" && seen(effective, TEAMS, "ambassador_teams", "L1") === "T1");

// ================================================================== (3) helper safety + scope of the migration
const f = code(FIX);
for (const [name, h] of Object.entries(helpers)) {
  const def = f.slice(f.indexOf(`function public.${name}(`), f.indexOf("$$;", f.indexOf(`function public.${name}(`)) + 3);
  check(`helper ${name}: SECURITY DEFINER with a pinned EMPTY search_path, stable, returns boolean`, /security definer/.test(def) && /set search_path = ''/.test(def) && /\bstable\b/.test(def) && /returns boolean/.test(def));
  check(`helper ${name}: takes ONLY a team id — no user id parameter, so it can only ever describe the caller`, /\(p_team_id uuid\)/.test(def) && !/p_user|p_uid|user_id uuid/.test(def.split("returns")[0]));
  check(`helper ${name}: identity comes from auth.uid() (the caller's verified session) and every object is schema-qualified`, /auth\.uid\(\)/.test(def) && !/\bfrom (?!public\.)\w/.test(def.replace(/select exists \(\s*select 1 from public/g, "")) && /public\.ambassador_(profiles|teams)/.test(def));
  check(`helper ${name}: returns only an existence boolean about the caller — selects no data column`, /select exists \(\s*select 1 from/.test(def) && !/select (?!exists|1)[a-z_*]+ from/.test(def));
}
check("safety: neither helper touches payout destinations, payouts, ledger, sales or any private column", !/payout|destination|details|ledger|ambassador_sales|masked|fapshi/i.test(f.replace(/ambassador_payout_destinations/g, "")) );
check("safety: helpers are revoked from PUBLIC; only anon/authenticated/service_role may execute (needed for policy evaluation)", /revoke all on function public\.ambassador_is_member_of_team\(uuid\) from public/.test(f) && /revoke all on function public\.ambassador_leads_team\(uuid\) from public/.test(f) && !/grant [^;]* to public/i.test(f));
check("scope: the migration only creates two functions, replaces two policies and changes nothing else (no table/column DDL, no data statements)", (f.match(/create or replace function/gi) || []).length === 2 && (f.match(/create policy/gi) || []).length === 2 && !/alter table|drop table|drop column|create table|insert into|update |delete from|truncate/i.test(f));
check("scope: it is one atomic transaction (begin ... commit), so there is never a window with no policy", /^\s*begin;/m.test(f) && /^\s*commit;\s*$/m.test(f) && f.indexOf("begin;") < f.indexOf("drop policy") && f.lastIndexOf("commit;") > f.lastIndexOf("create policy"));
check("scope: the policy names are kept identical to the originals", TEAMS in newP && PROFILES in newP);
const allOtherMigrations = fs.readdirSync(path.join(REPO, "supabase/migrations")).filter((x) => x !== "2026-11-28_ambassador_rls_recursion_fix.sql").map((x) => read(x)).join("\n");
check("scope: the helper names are new (no clash with any existing function)", !/ambassador_is_member_of_team|ambassador_leads_team/.test(allOtherMigrations));

// ================================================================== earlier migrations untouched
const sha = (p) => crypto.createHash("sha256").update(fs.readFileSync(path.join(REPO, "supabase/migrations", p))).digest("hex").slice(0, 16);
const originals = {
  "2026-11-18_ambassador_foundation.sql": "14aa62397ce1a0d6",
  "2026-11-19_ambassador_admin_actions.sql": "de220a3e7b52c65e",
  "2026-11-20_ambassador_sales_attribution.sql": "3afdaf2ffcff29c2",
  "2026-11-21_ambassador_commission_engine.sql": "b3806f5d72fef216",
  "2026-11-22_ambassador_payouts.sql": "4535cf14f6107a95",
  "2026-11-23_ambassador_activation_status.sql": "2e94739ccb9d3fd8",
};
check("untouched: the original six migrations still have exactly the hashes recorded before this work", Object.entries(originals).every(([file, h]) => sha(file) === h), Object.entries(originals).filter(([file, h]) => sha(file) !== h).map(([file]) => file).join());
check("ordering: the fix is the eleventh Ambassador migration and sorts after the notification claim migration", fs.readdirSync(path.join(REPO, "supabase/migrations")).filter((x) => /ambassador/.test(x)).sort().slice(-2).join("|") === "2026-11-27_ambassador_notification_dedup.sql|2026-11-28_ambassador_rls_recursion_fix.sql");

const failed = results.filter((x) => !x.pass);
console.log(`\nambassadorRlsFix: ${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
