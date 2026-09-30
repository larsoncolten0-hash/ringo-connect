// A Team Leader adds Ambassadors to their team — as PENDING, with no access — and Ringo
// Management reviews and approves them. No network, no database: a fake service-role client.
//
//   Run:  node scripts/tests/ambassadorTeamMembers.test.mjs
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const jiti = require("jiti")(import.meta.url, { alias: { "@": path.join(REPO, "src") }, interopDefault: true });
const load = (p) => jiti(path.join(REPO, "src", p));
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const results = [];
const check = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond });
  if (!cond) console.log("  FAIL:", name, "|", detail);
};
const quiet = async (fn) => {
  const o = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = o;
  }
};

// ------------------------------------------------------------------ fake service-role client
function makeFakeAdmin(seed = {}, { unique = {}, defaults = {} } = {}) {
  const tables = new Map();
  for (const [name, rows] of Object.entries(seed)) tables.set(name, new Map(rows.map((r, i) => [r.id ?? `seed_${name}_${i}`, { ...r }])));
  const calls = { writes: [], rpc: [] };
  const claimed = new Set();
  let autoId = 1;
  const from = (table) => {
    if (!tables.has(table)) tables.set(table, new Map());
    const store = tables.get(table);
    const filters = [];
    let op = "select";
    let payload;
    let max = Infinity;
    let head = false;
    const b = {
      select(_c, o) {
        if (o?.head) head = true;
        return b;
      },
      order: () => b,
      limit(n) {
        max = n;
        return b;
      },
      eq(k, v) {
        filters.push((r) => r[k] === v);
        return b;
      },
      in(k, vals) {
        filters.push((r) => vals.includes(r[k]));
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
      single: async () => resolve(true),
      maybeSingle: async () => resolve(true),
      then(res, rej) {
        return Promise.resolve(resolve(false)).then(res, rej);
      },
    };
    const matches = (row) => filters.every((f) => f(row));
    function resolve(single) {
      if (op !== "select") calls.writes.push({ table, op, payload });
      if (op === "insert") {
        const rows = [];
        for (const p of payload) {
          if (unique[table] && Array.from(store.values()).some((r) => r[unique[table]] === p[unique[table]])) return { data: null, error: { message: "duplicate key value violates unique constraint" } };
          const row = { id: p.id || `auto_${autoId++}`, ...(defaults[table] ? defaults[table](p) : {}), ...p };
          store.set(row.id, row);
          rows.push(row);
        }
        return { data: single ? rows[0] : rows, error: null };
      }
      if (op === "update") {
        const rows = Array.from(store.values()).filter(matches);
        for (const r of rows) Object.assign(r, payload);
        return { data: single ? rows[0] ?? null : rows, error: null };
      }
      const rows = Array.from(store.values()).filter(matches).slice(0, max);
      const count = Array.from(store.values()).filter(matches).length;
      return { data: head ? null : single ? rows[0] ?? null : rows, count, error: null };
    }
    return b;
  };
  return {
    _tables: tables,
    _calls: calls,
    from,
    rpc: async (name, args) => {
      calls.rpc.push({ name, args });
      if (name === "ambassador_claim_notification") {
        const won = !claimed.has(args.p_dedupe_key);
        claimed.add(args.p_dedupe_key);
        return { data: { ok: true, claimed: won }, error: null };
      }
      return { data: { ok: true }, error: null };
    },
  };
}

// ------------------------------------------------------------------ mocks
const withBell = load("lib/push/withBell.ts");
let userPushes = [];
let adminPushes = [];
withBell.sendPushAndBellToUser = async (_a, userId, payload) => void userPushes.push({ userId, ...payload });
withBell.sendPushAndBellToAdmins = async (_a, payload) => void adminPushes.push(payload);
const reset = () => {
  userPushes = [];
  adminPushes = [];
};
const serverMod = load("lib/supabase/server.ts");
const assertAdminMod = load("lib/assertAdmin.ts");
const tm = load("lib/ambassador/teamMembers.ts");
const payouts = load("lib/ambassador/payouts.ts");
const rr = load("lib/ambassador/requestReview.ts");
const { enableSelfAsAmbassador } = load("lib/ambassador/selfEnable.ts");
const { translations } = load("lib/i18n/translations.ts");

const world = (extra = {}) =>
  makeFakeAdmin(
    {
      ambassador_teams: [
        { id: "T1", team_leader_user_id: "uL1", status: "active" },
        { id: "T2", team_leader_user_id: "uL2", status: "active" },
        { id: "T3", team_leader_user_id: "uL3", status: "inactive" },
      ],
      ambassador_profiles: [{ id: "ambOld", user_id: "uOld", team_id: "T2", status: "active", sales_code: "OLDCODE" }],
      profiles: [
        { user_id: "uBob", username: "bob", is_demo: false },
        { user_id: "uOld", username: "oldamb", is_demo: false },
        { user_id: "uL1", username: "leader1", is_demo: false },
        { user_id: "uDemo", username: "demoguy", is_demo: true },
        { user_id: "uSusp", username: "suspended-sue", is_demo: false },
      ],
      users: [
        { id: "uBob", status: "active" },
        { id: "uOld", status: "active" },
        { id: "uDemo", status: "active" },
        { id: "uSusp", status: "suspended" },
      ],
      ambassador_admin_actions: [],
      ...extra,
    },
    { unique: { ambassador_profiles: "user_id" }, defaults: { ambassador_profiles: () => ({ sales_code: "NEWCODE1" }) } }
  );
const profileOf = (a, uid) => Array.from(a._tables.get("ambassador_profiles").values()).find((p) => p.user_id === uid);

// ================================================================== the Team Leader adds an Ambassador
{
  reset();
  const a = world();
  const r = await tm.addPendingAmbassador(a, "uL1", "  @Bob ");
  const p = profileOf(a, "uBob");
  check("add: an existing account is added to the Team Leader's OWN team (username matched case-insensitively, '@' ignored)", r.ok && r.username === "bob" && p && p.team_id === "T1");
  check("add: the new Ambassador is PENDING — not active", p.status === "pending");
  const inserts = a._calls.writes.filter((w) => w.table === "ambassador_profiles");
  check("add: the insert carries exactly user, team, 'pending' and creator — no code, no other status", inserts.length === 1 && JSON.stringify(Object.keys(inserts[0].payload[0]).sort()) === JSON.stringify(["created_by", "status", "team_id", "user_id"]) && inserts[0].payload[0].created_by === "uL1");
  check("add: it is audited under the Team Leader's id, with no personal data beyond the username", a._tables.get("ambassador_admin_actions").size === 1 && Array.from(a._tables.get("ambassador_admin_actions").values())[0].action === "ambassador_added_by_team_leader" && Array.from(a._tables.get("ambassador_admin_actions").values())[0].actor_user_id === "uL1");
  check("add: Management is told someone is awaiting review", adminPushes.length === 1 && adminPushes[0].category === "ambassador_pending_review" && adminPushes[0].url === "/admin/ambassadors" && /bob/.test(adminPushes[0].body));
  check("add: the person is told they were added and are awaiting approval (and their code/link are not mentioned as working)", userPushes.length === 1 && userPushes[0].userId === "uBob" && userPushes[0].category === "ambassador_added_pending");
  check("add: the response carries only the username", JSON.stringify(r) === JSON.stringify({ ok: true, username: "bob" }));
}
{
  const a = world();
  const noneOf = async (name, uid, input, code) => {
    const w = a;
    const before = w._calls.writes.length;
    const r = await tm.addPendingAmbassador(w, uid, input);
    return { name, ok: !r.ok && r.code === code && w._calls.writes.length === before, got: JSON.stringify(r) };
  };
  const cases = [
    await noneOf("not a Team Leader", "uBob", "oldamb", "not_team_leader"),
    await noneOf("inactive team", "uL3", "bob", "team_inactive"),
    await noneOf("bad username", "uL1", "no spaces!", "invalid_username"),
    await noneOf("non-string username", "uL1", { $ne: "" }, "invalid_username"),
    await noneOf("unknown account", "uL1", "ghost", "user_not_found"),
    await noneOf("themselves", "uL1", "leader1", "cannot_add_self"),
    await noneOf("someone who is already an Ambassador (another team's)", "uL1", "oldamb", "already_ambassador"),
    await noneOf("a demo account", "uL1", "demoguy", "account_unavailable"),
    await noneOf("a suspended account", "uL1", "suspended-sue", "account_unavailable"),
  ];
  for (const c of cases) check(`refused with nothing written: ${c.name}`, c.ok, c.got);
  const stolen = profileOf(a, "uOld");
  check("refused: an existing Ambassador on another team is left exactly as it was (never moved, never re-activated)", stolen.team_id === "T2" && stolen.status === "active");
}
{
  // Cap on how many can be waiting at once.
  const many = (n) => Array.from({ length: n }, (_, i) => ({ id: `pp${i}`, user_id: `uPending${i}`, team_id: "T1", status: "pending", sales_code: `C${i}` }));
  const full = world({ ambassador_profiles: many(tm.MAX_PENDING_PER_TEAM) });
  check("cap: at the limit of pending Ambassadors, no more can be added until Management reviews them", (await tm.addPendingAmbassador(full, "uL1", "bob")).code === "too_many_pending" && !profileOf(full, "uBob"));
  const almost = world({ ambassador_profiles: many(tm.MAX_PENDING_PER_TEAM - 1) });
  check("cap: one below the limit still works", (await tm.addPendingAmbassador(almost, "uL1", "bob")).ok === true);
  const otherTeamsFull = world({ ambassador_profiles: many(tm.MAX_PENDING_PER_TEAM).map((p) => ({ ...p, team_id: "T2" })) });
  check("cap: it counts the Team Leader's OWN team only", (await tm.addPendingAmbassador(otherTeamsFull, "uL1", "bob")).ok === true);
}
{
  const a = world();
  const out = await Promise.all([1, 2, 3, 4].map(() => quiet(() => tm.addPendingAmbassador(a, "uL1", "bob"))));
  check("concurrency: adding the same person four times at once creates exactly one profile", Array.from(a._tables.get("ambassador_profiles").values()).filter((p) => p.user_id === "uBob").length === 1 && out.filter((r) => r.ok).length >= 1);
}
{
  const a = world();
  await tm.addPendingAmbassador(a, "uL1", "bob");
  const mine = await tm.listTeamMembers(a, "uL1");
  const theirs = await tm.listTeamMembers(a, "uL2");
  check("list: a Team Leader sees only THEIR team's members, as username + status only", mine.length === 1 && mine[0].username === "bob" && mine[0].status === "pending" && JSON.stringify(Object.keys(mine[0]).sort()) === JSON.stringify(["id", "status", "username"]) && theirs.length === 1 && theirs[0].username === "oldamb");
  check("list: a non-Team-Leader gets nothing", (await tm.listTeamMembers(a, "uBob")).length === 0);
}

// ================================================================== the route
{
  const { POST } = load("app/api/ambassador/team-members/route.ts");
  const a = world();
  serverMod.createAdminClient = () => a;
  serverMod.createClient = () => ({ auth: { getUser: async () => ({ data: { user: null } }) } });
  check("route: 401 without a session", (await POST({ json: async () => ({ username: "bob" }) })).status === 401);
  serverMod.createClient = () => ({ auth: { getUser: async () => ({ data: { user: { id: "uL1" } } }) } });
  const res = await POST({ json: async () => ({ username: "bob", team_id: "T2", status: "active", sales_code: "HACK", user_id: "uOld", can_approve_requests: true }) });
  const p = profileOf(a, "uBob");
  check("route: only the username is used — team, status, code and permissions in the body are ignored", res.status === 200 && p.team_id === "T1" && p.status === "pending" && p.sales_code === "NEWCODE1" && !a._calls.writes.some((w) => w.table === "users"));
  const notLeader = (serverMod.createClient = () => ({ auth: { getUser: async () => ({ data: { user: { id: "uBob" } } }) } }), await POST({ json: async () => ({ username: "oldamb" }) }));
  check("route: a non-Team-Leader gets 403", notLeader.status === 403);
}

// ================================================================== a pending Ambassador has no access to anything
{
  const a = makeFakeAdmin({ ambassador_profiles: [{ id: "amb1", user_id: "uP", team_id: "T1", status: "pending" }, { id: "amb2", user_id: "uActive", team_id: "T1", status: "active" }], ambassador_teams: [{ id: "T1", team_leader_user_id: "uL1", status: "active" }], profiles: [] });
  const dest = await payouts.saveMyDestination(a, "uP", { role: "ambassador", method: "mobile_money", details: { provider: "mtn", phone: "677123456" } });
  const req = await payouts.requestMyPayout(a, "uP", { role: "ambassador" });
  check("pending: cannot save a payout destination or request a payout (pending_approval), and nothing reaches the database", dest.code === "pending_approval" && req.code === "pending_approval" && !a._calls.rpc.some((c) => /destination|request_payout/.test(c.name)));
  const scope = await rr.getReviewerScope(a, "uP");
  check("pending: has NO client-approval scope (so even if an admin granted the switch, nothing is reachable)", scope.ambassadorId === null && scope.teamId === null);
  const active = await rr.getReviewerScope(a, "uActive");
  check("pending: an ACTIVE Ambassador on the same team is unaffected", active.ambassadorId === "amb2");
  const accessPending = await rr.resolveRequestAccess(makeFakeAdmin({ ambassador_profiles: [{ id: "amb1", user_id: "uP", status: "pending" }], ambassador_teams: [], ambassador_sales: [{ signup_request_id: "sr1", ambassador_id: "amb1", team_id: null }] }), { id: "uP", isAdmin: false, affiliateCode: null }, { id: "sr1", referral_code: null });
  check("pending: cannot reach even a request attributed to their own profile", accessPending === null);
  const self = await enableSelfAsAmbassador(makeFakeAdmin({ ambassador_teams: [{ id: "T9", team_leader_user_id: "uP", status: "active" }], ambassador_profiles: [{ id: "amb1", user_id: "uP", team_id: "T9", status: "pending" }], profiles: [] }), "uP");
  check("pending: the self-enable path cannot be used to jump the queue", self.code === "profile_inactive");
  const m20 = read("supabase/migrations/2026-11-20_ambassador_sales_attribution.sql").replace(/--.*$/gm, "");
  check("pending: their code attributes NO sale — the approved attribution function only matches status = 'active'", /where sales_code = upper\(trim\(p_ambassador_code\)\) and status = 'active'/.test(m20));
}

// ================================================================== Management approves
{
  const { PATCH } = load("app/api/admin/ambassadors/[id]/route.ts");
  const mk = () =>
    makeFakeAdmin({ ambassador_profiles: [{ id: "amb1", user_id: "uBob", team_id: "T1", status: "pending", sales_code: "C1", created_at: "x", deactivated_at: null, created_by: "uL1" }, { id: "amb2", user_id: "uActive", team_id: "T1", status: "active", sales_code: "C2", created_at: "x", deactivated_at: null, created_by: "x" }], ambassador_teams: [{ id: "T1" }], ambassador_admin_actions: [] });
  reset();
  const a = mk();
  serverMod.createAdminClient = () => a;
  assertAdminMod.assertAdmin = async () => null;
  const denied = await PATCH({ json: async () => ({ status: "active" }) }, { params: { id: "amb1" } });
  check("approve: only an admin can approve — anyone else gets 403 and nothing changes", denied.status === 403 && profileOf(a, "uBob").status === "pending");
  assertAdminMod.assertAdmin = async () => ({ id: "adm" });
  const ok = await PATCH({ json: async () => ({ status: "active" }) }, { params: { id: "amb1" } });
  check("approve: an admin approving a pending Ambassador makes them active", ok.status === 200 && profileOf(a, "uBob").status === "active");
  check("approve: the person is notified once that they are approved", userPushes.filter((n) => n.category === "ambassador_approved" && n.userId === "uBob").length === 1);
  await PATCH({ json: async () => ({ status: "active" }) }, { params: { id: "amb1" } });
  check("approve: approving again does not notify again", userPushes.filter((n) => n.category === "ambassador_approved").length === 1);
  reset();
  const b = mk();
  serverMod.createAdminClient = () => b;
  await PATCH({ json: async () => ({ status: "suspended" }) }, { params: { id: "amb2" } });
  check("approve: other status changes (e.g. suspending an active Ambassador) send no approval notification", userPushes.length === 0);
  const noPending = await PATCH({ json: async () => ({ status: "pending" }) }, { params: { id: "amb2" } });
  check("approve: an admin cannot set 'pending' through this route (it is only ever created by a Team Leader)", noPending.status === 400);
}

// ================================================================== wiring, migration, i18n (static)
{
  const migs = fs.readdirSync(path.join(REPO, "supabase/migrations")).filter((f) => /ambassador/.test(f)).sort();
  check("migration: 2026-11-29_ambassador_pending_status.sql is the twelfth Ambassador migration, after the RLS fix", migs.slice(-2).join("|") === "2026-11-28_ambassador_rls_recursion_fix.sql|2026-11-29_ambassador_pending_status.sql");
  const m = read("supabase/migrations/2026-11-29_ambassador_pending_status.sql").replace(/--.*$/gm, "");
  check("migration: it ONLY widens the allowed statuses (drop + re-add the check, adding 'pending') — no data, table or function change", /drop constraint if exists ambassador_profiles_status_check/.test(m) && /check \(status in \('pending', 'active', 'inactive', 'suspended'\)\)/.test(m) && (m.match(/alter table/gi) || []).length === 2 && !/insert |update |delete |create |drop table|drop column/i.test(m.replace(/drop constraint/gi, "")));
  const amb = strip(read("src/app/dashboard/ambassador/page.tsx"));
  check("dashboard: a pending Ambassador sees ONLY the notice — it returns before the code, link, requests card or payouts are built", /status === "pending"\) return <PendingAmbassadorNotice/.test(amb) && amb.indexOf("PendingAmbassadorNotice />") < amb.indexOf("<AmbassadorDashboardView") && amb.indexOf("PendingAmbassadorNotice />") < amb.indexOf("getMyPayoutOverview("));
  const tl = strip(read("src/app/dashboard/sales-team/page.tsx"));
  check("dashboard: the Team Leader page shows the add-Ambassador card with their own team's members", /TeamAmbassadorsCard members=\{members\}/.test(tl) && /listTeamMembers\(adminClient, user\.id\)/.test(tl));
  const admin = strip(read("src/components/admin/AdminAmbassadorsView.tsx"));
  check("admin: pending Ambassadors are highlighted and the button reads Approve (translated)", /pending: "bg-amber-500\/10/.test(admin) && /a\.status === "pending" \? t\.ambassadorTeamMembers\.admin\.approve/.test(admin));
  const routeSrc = strip(read("src/app/api/ambassador/team-members/route.ts"));
  check("limits: the Team Leader route reads only the username from the body", (routeSrc.match(/body\?\./g) || []).length === 1 && /body\?\.username/.test(routeSrc));
  const libSrc = strip(read("src/lib/ambassador/teamMembers.ts"));
  check("limits: nothing in the add path can activate, delete or move an Ambassador, or grant any permission", !/status: "active"|\.delete\(|\.update\(|can_approve_requests|team_id: (?!team\.id)/.test(libSrc));

  const shape = (o) => (typeof o === "function" ? "fn" : o && typeof o === "object" ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, shape(v)])) : "str");
  check("i18n: ambassadorTeamMembers has identical keys in English and French", JSON.stringify(shape(translations.en.ambassadorTeamMembers)) === JSON.stringify(shape(translations.fr.ambassadorTeamMembers)));
  const codes = [...read("src/lib/ambassador/teamMembers.ts").split("export type AddMemberErrorCode =")[1].split(";")[0].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
  check("i18n: every add-member error code has English AND French text", codes.length === 9 && codes.every((c) => translations.en.ambassadorTeamMembers.errors[c] && translations.fr.ambassadorTeamMembers.errors[c]), codes.join());
  check("i18n: the pending_approval payout error exists in both languages", !!translations.en.ambassadorPayouts.errors.pending_approval && !!translations.fr.ambassadorPayouts.errors.pending_approval);
  const n = ["ambassador", "teamLeader"];
  check("i18n: the 'added' and 'approved' notifications exist in English and French for both roles", n.every((g) => ["addedPendingApproval", "ambassadorApproved"].every((k) => translations.en.ambassadorNotifications[g][k]?.title && translations.fr.ambassadorNotifications[g][k]?.title && translations.en.ambassadorNotifications[g][k].title !== translations.fr.ambassadorNotifications[g][k].title)));
  check("i18n: the admin 'awaiting approval' notification exists in both languages and interpolates the username", translations.en.ambassadorNotifications.admin.pendingAmbassador.body("bob").includes("bob") && translations.fr.ambassadorNotifications.admin.pendingAmbassador.body("bob").includes("bob"));
  check("i18n: the French copy is genuinely translated", translations.fr.ambassadorTeamMembers.title !== translations.en.ambassadorTeamMembers.title && translations.fr.ambassadorTeamMembers.pendingNotice.title !== translations.en.ambassadorTeamMembers.pendingNotice.title);
}

const failed = results.filter((x) => !x.pass);
console.log(`\nambassadorTeamMembers: ${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
