// Ambassadors and Team Leaders approving THEIR OWN clients' new accounts.
// No network, no database, no real Fapshi. The real approve route, the real access/scope logic and the
// real self-enable logic run against a fake service-role client.
//
//   Run:  node scripts/tests/ambassadorRequestApproval.test.mjs
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
function makeFakeAdmin(seed = {}, { unique = {}, defaults = {}, rpcHandlers = {} } = {}) {
  const tables = new Map();
  for (const [name, rows] of Object.entries(seed)) tables.set(name, new Map(rows.map((r, i) => [r.id ?? `seed_${name}_${i}`, { ...r }])));
  const calls = { rpc: [], createUser: [], writes: [] };
  let autoId = 1;
  const from = (table) => {
    if (!tables.has(table)) tables.set(table, new Map());
    const store = tables.get(table);
    const filters = [];
    let op = "select";
    let payload;
    let max = Infinity;
    const b = {
      select: () => b,
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
      delete() {
        op = "delete";
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
      if (op === "delete") {
        for (const r of Array.from(store.values()).filter(matches)) store.delete(r.id);
        return { data: null, error: null };
      }
      const rows = Array.from(store.values()).filter(matches).slice(0, max);
      const count = rows.length;
      return { data: single ? rows[0] ?? null : rows, count, error: null };
    }
    return b;
  };
  return {
    _tables: tables,
    _calls: calls,
    from,
    auth: { admin: { createUser: async (args) => (calls.createUser.push(args), { data: { user: { id: "user-new-1" } }, error: null }) } },
    rpc: async (name, args) => {
      calls.rpc.push({ name, args });
      if (rpcHandlers[name]) return rpcHandlers[name](args);
      return { data: { ok: true }, error: null };
    },
  };
}

// ------------------------------------------------------------------ mocks for the approve route's collaborators
const assertAdminMod = load("lib/assertAdmin.ts");
const fapshiMod = load("lib/fapshi.ts");
const serverMod = load("lib/supabase/server.ts");
const pushBellMod = load("lib/push/withBell.ts");
const affiliateNotifyMod = load("lib/push/notifyAffiliateCommission.ts");
const cardBundleMod = load("lib/cardBundle.ts");
const notifMod = load("lib/notifications.ts");
const emailShellMod = load("lib/email/emailShell.ts");
const emailProviderMod = load("lib/email/provider.ts");
pushBellMod.sendPushAndBellToAdmins = async () => {};
pushBellMod.sendPushAndBellToUser = async () => {};
affiliateNotifyMod.notifyAffiliateCommissionIfAny = async () => {};
cardBundleMod.applyCardBundleGrant = async () => {};
notifMod.notifyUser = async () => {};
notifMod.notifyAdmins = async () => {};
emailShellMod.emailShell = () => "";
emailProviderMod.sendEmail = async () => ({ ok: true });
let fapshiStatus = "SUCCESSFUL";
let fapshiChecked = [];
fapshiMod.fapshiGetStatus = async (id) => (fapshiChecked.push(id), { status: fapshiStatus, transId: id });

const { POST: approvePOST } = load("app/api/admin/requests/[id]/approve/route.ts");
const rr = load("lib/ambassador/requestReview.ts");
const { enableSelfAsAmbassador } = load("lib/ambassador/selfEnable.ts");
const { translations } = load("lib/i18n/translations.ts");

// ------------------------------------------------------------------ world
const PAID_PLAN = "plan-paid";
const OTHER_PLAN = "plan-premium";
const seedWorld = () => ({
  users: [],
  ambassador_profiles: [
    { id: "amb1", user_id: "uA1", team_id: "T1", status: "active" },
    { id: "amb2", user_id: "uA2", team_id: "T1", status: "active" }, // moved to T1 AFTER their old sale (below)
    { id: "ambS", user_id: "uS", team_id: "T1", status: "suspended" },
    { id: "ambL", user_id: "uL1", team_id: "T1", status: "active" }, // Team Leader 1 added their own Ambassador profile
    { id: "ambX", user_id: "uX", team_id: "T2", status: "inactive" },
  ],
  ambassador_teams: [
    { id: "T1", team_leader_user_id: "uL1", status: "active" },
    { id: "T2", team_leader_user_id: "uL2", status: "active" },
    { id: "T3", team_leader_user_id: "uL3", status: "inactive" },
  ],
  ambassador_sales: [
    { id: "s1", signup_request_id: "sr1", ambassador_id: "amb1", team_id: "T1", status: "locked" },
    { id: "s2", signup_request_id: "sr2", ambassador_id: "amb2", team_id: "T2", status: "locked" }, // sold while amb2 was on T2
    { id: "s3", signup_request_id: "sr3", ambassador_id: "ambL", team_id: "T1", status: "locked" }, // TL's own client
    { id: "s4", signup_request_id: "srS", ambassador_id: "ambS", team_id: "T1", status: "locked" },
    { id: "s5", signup_request_id: "srX", ambassador_id: "ambX", team_id: "T2", status: "locked" },
    { id: "s6", signup_request_id: "sr6", ambassador_id: "amb1", team_id: "T3", status: "locked" },
    { id: "s7", signup_request_id: "sr4", ambassador_id: "amb1", team_id: "T1", status: "attributed" }, // client who has NOT paid online yet
  ],
  plans: [
    { id: PAID_PLAN, name: "Basic", price_usd: 10, price_xaf: 5000, price_usd_yearly: 100, price_xaf_yearly: 50000, bookings_feature_enabled: false },
    { id: OTHER_PLAN, name: "Premium", price_usd: 30, price_xaf: 15000, price_usd_yearly: 300, price_xaf_yearly: 150000, bookings_feature_enabled: true },
  ],
  profiles: [],
  signup_requests: ["sr1", "sr2", "sr3", "sr4", "srS", "srX", "sr6", "srAff", "srNone"].map((id) => ({
    id,
    status: "pending",
    email: "jane@x.com",
    full_name: "Jane",
    category: null,
    categories: [],
    referral_code: id === "srAff" ? "ABC123" : null,
    customer_paid: id !== "sr4",
    pending_fapshi_trans_id: id === "sr4" ? null : `tx-${id}`,
    requested_plan_id: PAID_PLAN,
    requested_interval: "monthly",
    requested_addon_ids: [],
    requested_links: [],
    requested_products: [],
    requested_social_links: [],
  })),
});
const reviewer = (over = {}) => ({ id: "uA1", isAdmin: false, affiliateCode: null, ...over });
const BODY = (over = {}) => ({ username: "janedoe", email: "jane@x.com", password: "pw123456", fullName: "Jane Doe", whatsappNumber: "+237600000000", planId: PAID_PLAN, billingInterval: "monthly", paymentMethod: "charge", ...over });
async function approve(admin, who, requestId, body = BODY()) {
  serverMod.createAdminClient = () => admin;
  assertAdminMod.assertCanApproveRequests = async () => who;
  fapshiChecked = [];
  return quiet(() => approvePOST({ json: async () => body }, { params: { id: requestId } }));
}
const status = (admin, id) => admin._tables.get("signup_requests").get(id).status;

// ================================================================== access resolution (scope)
{
  const a = makeFakeAdmin(seedWorld());
  const acc = async (who, sr, referral = null) => rr.resolveRequestAccess(a, who, { id: sr, referral_code: referral });
  check("scope: a full admin has access to any request", (await acc(reviewer({ id: "adm", isAdmin: true }), "sr2")) === "admin");
  check("scope: an Ambassador reaches their OWN client's request", (await acc(reviewer({ id: "uA1" }), "sr1")) === "ambassador");
  check("scope: ...but not another Ambassador's client", (await acc(reviewer({ id: "uA1" }), "sr3")) === null && (await acc(reviewer({ id: "uA1" }), "sr2")) === null);
  check("scope: a Team Leader reaches the whole team (an Ambassador's client AND their own)", (await acc(reviewer({ id: "uL1" }), "sr1")) === "ambassador" && (await acc(reviewer({ id: "uL1" }), "sr3")) === "ambassador");
  check("scope: HISTORICAL team is respected — a sale made under team T2 is T2's leader's, even though the Ambassador is now on T1", (await acc(reviewer({ id: "uL2" }), "sr2")) === "ambassador" && (await acc(reviewer({ id: "uL1" }), "sr2")) === null);
  check("scope: a Team Leader cannot reach another team's clients", (await acc(reviewer({ id: "uL2" }), "sr1")) === null);
  check("scope: a SUSPENDED Ambassador has no scope, even for their own client", (await acc(reviewer({ id: "uS" }), "srS")) === null);
  check("scope: an INACTIVE Ambassador has no scope", (await acc(reviewer({ id: "uX" }), "srX")) === null);
  check("scope: an inactive team gives its leader no scope", (await acc(reviewer({ id: "uL3" }), "sr6")) === null);
  check("scope: an unrelated user has no access", (await acc(reviewer({ id: "nobody" }), "sr1")) === null);
  check("scope: a request with no Ambassador attribution is out of scope for everyone non-admin", (await acc(reviewer({ id: "uA1" }), "srNone")) === null);
  check("legacy: a super creator with a matching affiliate code is still resolved as 'affiliate' — unchanged", (await acc(reviewer({ id: "uSC", affiliateCode: "ABC123" }), "srAff", "ABC123")) === "affiliate");
  check("legacy: a wrong affiliate code and no Ambassador scope is refused", (await acc(reviewer({ id: "uSC", affiliateCode: "ZZZ999" }), "srAff", "ABC123")) === null);

  const ids = await rr.scopedSignupRequestIds(a, await rr.getReviewerScope(a, "uL1"));
  check("scope: a Team Leader's list is exactly the sales carrying THEIR team (by the team recorded on each sale) — not the other teams' and not the T2 sale of an Ambassador who has since moved to T1", JSON.stringify(ids.sort()) === JSON.stringify(["sr1", "sr3", "sr4", "srS"].sort()), JSON.stringify(ids));
  const pending = await rr.pendingScopedRequestCount(a, "uA1");
  check("scope: the dashboard pending count is exactly the Ambassador's own pending requests (sr1, sr4, sr6), not anyone else's", pending === 3, String(pending));
}

// ================================================================== the strict rules for Ambassadors / Team Leaders
{
  const ok = { customer_paid: true, pending_fapshi_trans_id: "tx", requested_plan_id: "p", requested_interval: "monthly", email: "Jane@X.com" };
  const good = { planId: "p", billingInterval: "monthly", paymentMethod: "charge", email: "jane@x.com" };
  check("rules: a paid, matching request is allowed", rr.validateAmbassadorApproval(ok, good).ok === true);
  check("rules: unpaid (customer_paid false) is refused", rr.validateAmbassadorApproval({ ...ok, customer_paid: false }, good).code === "online_payment_required");
  check("rules: paid but no Fapshi transaction on record is refused", rr.validateAmbassadorApproval({ ...ok, pending_fapshi_trans_id: null }, good).code === "online_payment_required");
  check("rules: the cash/transfer route ('manual') is refused", rr.validateAmbassadorApproval(ok, { ...good, paymentMethod: "manual" }).code === "payment_method_locked");
  check("rules: skipping payment ('none') is refused", rr.validateAmbassadorApproval(ok, { ...good, paymentMethod: "none" }).code === "payment_method_locked");
  check("rules: a different plan than the client requested and paid for is refused (no free upgrades)", rr.validateAmbassadorApproval(ok, { ...good, planId: "other" }).code === "plan_locked");
  check("rules: a different billing interval is refused", rr.validateAmbassadorApproval(ok, { ...good, billingInterval: "yearly" }).code === "plan_locked");
  check("rules: a different account email is refused", rr.validateAmbassadorApproval(ok, { ...good, email: "someone@else.com" }).code === "email_locked");
  check("rules: email matching ignores case and whitespace", rr.validateAmbassadorApproval(ok, { ...good, email: "  JANE@x.com " }).ok === true);
}

// ================================================================== the real approve route
{
  const a = makeFakeAdmin(seedWorld());
  const r = await approve(a, reviewer({ id: "uA1" }), "sr1");
  const json = await r.json();
  check("route: an Ambassador approves their own paid client — account created", r.status === 200 && json.ok === true && a._calls.createUser.length === 1, JSON.stringify(json));
  check("route: the payment was re-verified with Fapshi itself before anything was created", fapshiChecked.length === 1 && fapshiChecked[0] === "tx-sr1");
  check("route: the request is marked approved by THIS reviewer, and Milestone 1 is evaluated for their sale", status(a, "sr1") === "approved" && a._tables.get("signup_requests").get("sr1").reviewed_by === "uA1" && a._calls.rpc.some((c) => c.name === "ambassador_evaluate_milestone_1" && c.args.p_sale_id === "s1"));
  const rec = Array.from(a._tables.get("payment_transactions")?.values() || []);
  check("route: the payment is recorded through the verified Fapshi path (provider fapshi, the Fapshi transaction id) — not as a manual payment", rec.length === 1 && rec[0].provider === "fapshi" && rec[0].provider_transaction_id === "tx-sr1", JSON.stringify(rec));
}
{
  const a = makeFakeAdmin(seedWorld());
  const r = await approve(a, reviewer({ id: "uA1" }), "sr4"); // sr4: NOT paid
  const j = await r.json();
  check("route: an UNPAID request cannot be approved by an Ambassador — 400 online_payment_required, no account", r.status === 400 && j.code === "online_payment_required" && a._calls.createUser.length === 0 && status(a, "sr4") === "pending");
}
{
  const bad = [
    ["manual (cash/transfer)", { paymentMethod: "manual" }, "payment_method_locked"],
    ["none (skip payment)", { paymentMethod: "none" }, "payment_method_locked"],
    ["a more expensive plan", { planId: OTHER_PLAN }, "plan_locked"],
    ["a yearly interval", { billingInterval: "yearly" }, "plan_locked"],
    ["a different email", { email: "other@x.com" }, "email_locked"],
  ];
  let allRefused = true;
  for (const [name, over, code] of bad) {
    const a = makeFakeAdmin(seedWorld());
    const r = await approve(a, reviewer({ id: "uA1" }), "sr1", BODY(over));
    const j = await r.json();
    if (r.status !== 400 || j.code !== code || a._calls.createUser.length !== 0 || status(a, "sr1") !== "pending") {
      allRefused = false;
      console.log("  not refused:", name, r.status, JSON.stringify(j));
    }
  }
  check("route: cash/transfer, skipping payment, plan upgrades, interval changes and email changes are ALL refused server-side, creating nothing", allRefused);
}
{
  const a = makeFakeAdmin(seedWorld());
  fapshiStatus = "PENDING";
  const r = await approve(a, reviewer({ id: "uA1" }), "sr1");
  fapshiStatus = "SUCCESSFUL";
  check("route: if Fapshi does not confirm the payment at approval time, nothing is created", r.status === 400 && a._calls.createUser.length === 0);
}
{
  const a1 = makeFakeAdmin(seedWorld());
  const other = await approve(a1, reviewer({ id: "uA1" }), "sr2");
  check("route: an Ambassador cannot approve ANOTHER Ambassador's client — 404, nothing created", other.status === 404 && a1._calls.createUser.length === 0);
  const a2 = makeFakeAdmin(seedWorld());
  const tl = await approve(a2, reviewer({ id: "uL1" }), "sr1");
  check("route: a Team Leader approves a client of an Ambassador on their team", tl.status === 200 && a2._calls.createUser.length === 1);
  const a3 = makeFakeAdmin(seedWorld());
  const tlOwn = await approve(a3, reviewer({ id: "uL1" }), "sr3");
  check("route: a Team Leader approves their OWN client (sold as their own Ambassador)", tlOwn.status === 200);
  const a4 = makeFakeAdmin(seedWorld());
  const tlOther = await approve(a4, reviewer({ id: "uL2" }), "sr1");
  check("route: another team's leader cannot approve it — 404", tlOther.status === 404 && a4._calls.createUser.length === 0);
  const a5 = makeFakeAdmin(seedWorld());
  const hist = await approve(a5, reviewer({ id: "uL1" }), "sr2");
  check("route: a Team Leader cannot approve a sale made under their old team by an Ambassador who has since joined them", hist.status === 404);
  const a6 = makeFakeAdmin(seedWorld());
  const susp = await approve(a6, reviewer({ id: "uS" }), "srS");
  check("route: a suspended Ambassador cannot approve even their own client — 404", susp.status === 404 && a6._calls.createUser.length === 0);
  const a7 = makeFakeAdmin(seedWorld());
  const notGranted = await approve(a7, null, "sr1");
  check("route: a person the admin has NOT granted the permission to gets 403", notGranted.status === 403 && a7._calls.createUser.length === 0);
}
{
  // Existing behaviour must be untouched.
  const a = makeFakeAdmin(seedWorld());
  const admin = await approve(a, reviewer({ id: "adm", isAdmin: true }), "sr4", BODY({ paymentMethod: "manual", planId: OTHER_PLAN, billingInterval: "yearly", email: "x@y.com" }));
  check("unchanged: a full admin can still approve with cash/transfer, any plan and any email", admin.status === 200 && a._calls.createUser.length === 1);
  const b = makeFakeAdmin(seedWorld());
  const legacy = await approve(b, reviewer({ id: "uSC", affiliateCode: "ABC123" }), "srAff", BODY({ paymentMethod: "manual" }));
  check("unchanged: a legacy super creator (affiliate-code scope) is not subjected to the new Ambassador rules", legacy.status === 200 && b._calls.createUser.length === 1);
  const c = makeFakeAdmin(seedWorld());
  const legacyOther = await approve(c, reviewer({ id: "uSC", affiliateCode: "ZZZ999" }), "srAff");
  check("unchanged: a super creator with a different affiliate code still gets 404", legacyOther.status === 404);
}

// ================================================================== Team Leader adds their own Ambassador profile
const enableWorld = (extra = {}) =>
  makeFakeAdmin(
    { ambassador_teams: [{ id: "T1", team_leader_user_id: "uL1", status: "active" }, { id: "T3", team_leader_user_id: "uL3", status: "inactive" }], ambassador_profiles: [{ id: "ambInactive", user_id: "uOff", team_id: "T1", status: "inactive", sales_code: "OLDCODE" }], profiles: [{ id: "p1", user_id: "uL1", is_demo: false }, { id: "pd", user_id: "uDemo", is_demo: true }], ambassador_admin_actions: [], ...extra },
    { unique: { ambassador_profiles: "user_id" }, defaults: { ambassador_profiles: () => ({ sales_code: "TL1CODE" }) } }
  );
{
  const a = enableWorld();
  const r = await enableSelfAsAmbassador(a, "uL1");
  const created = Array.from(a._tables.get("ambassador_profiles").values()).find((p) => p.user_id === "uL1");
  check("self-enable: a Team Leader gets an ACTIVE Ambassador profile on their OWN team, with a database-generated code", r.ok && r.already === false && r.salesCode === "TL1CODE" && created.team_id === "T1" && created.status === "active" && created.created_by === "uL1");
  check("self-enable: it is audited under the Team Leader's own id", a._tables.get("ambassador_admin_actions").size === 1 && Array.from(a._tables.get("ambassador_admin_actions").values())[0].action === "ambassador_self_enabled");
  const again = await enableSelfAsAmbassador(a, "uL1");
  check("self-enable: doing it again is harmless — same code, no second profile", again.ok && again.already === true && again.salesCode === "TL1CODE" && Array.from(a._tables.get("ambassador_profiles").values()).filter((p) => p.user_id === "uL1").length === 1);
  const b = enableWorld();
  await Promise.all([enableSelfAsAmbassador(b, "uL1"), enableSelfAsAmbassador(b, "uL1"), enableSelfAsAmbassador(b, "uL1")]);
  check("self-enable: a triple click creates exactly one profile", Array.from(b._tables.get("ambassador_profiles").values()).filter((p) => p.user_id === "uL1").length === 1);
  check("self-enable: someone who is not a Team Leader is refused", (await enableSelfAsAmbassador(enableWorld(), "uNobody")).code === "not_team_leader");
  check("self-enable: an inactive team's leader is refused", (await enableSelfAsAmbassador(enableWorld(), "uL3")).code === "team_inactive");
  check("self-enable: a demo account is refused", (await enableSelfAsAmbassador(enableWorld({ ambassador_teams: [{ id: "TD", team_leader_user_id: "uDemo", status: "active" }] }), "uDemo")).code === "demo");
  const inactiveWorld = enableWorld({ ambassador_teams: [{ id: "T9", team_leader_user_id: "uOff", status: "active" }] });
  const inact = await enableSelfAsAmbassador(inactiveWorld, "uOff");
  const untouched = inactiveWorld._tables.get("ambassador_profiles").get("ambInactive");
  check("self-enable: it can NEVER reactivate a profile an admin deactivated — refused, and the row is untouched", inact.code === "profile_inactive" && untouched.status === "inactive" && !inactiveWorld._calls.writes.some((w) => w.table === "ambassador_profiles"));

  const { POST } = load("app/api/ambassador/enable-self/route.ts");
  const routeAdmin = enableWorld();
  serverMod.createAdminClient = () => routeAdmin;
  serverMod.createClient = () => ({ auth: { getUser: async () => ({ data: { user: null } }) } });
  check("self-enable route: 401 without a session", (await POST()).status === 401);
  serverMod.createClient = () => ({ auth: { getUser: async () => ({ data: { user: { id: "uL1" } } }) } });
  const res = await POST({ json: async () => ({ user_id: "uL3", team_id: "T3", status: "active", sales_code: "HACKED" }) });
  const created2 = Array.from(routeAdmin._tables.get("ambassador_profiles").values()).find((p) => p.user_id === "uL1");
  check("self-enable route: the request body is never read — the team, code and person come only from the session", res.status === 200 && created2 && created2.team_id === "T1" && created2.sales_code === "TL1CODE" && !Array.from(routeAdmin._tables.get("ambassador_profiles").values()).some((p) => p.user_id === "uL3"));
  check("self-enable route: the response carries just the code, nothing else about the profile", JSON.stringify(await res.clone().json()) === JSON.stringify({ ok: true, salesCode: "TL1CODE", already: false }));
}

// ================================================================== screens, other routes, wiring (static)
{
  const approveSrc = strip(read("src/app/api/admin/requests/[id]/approve/route.ts"));
  check("wiring: the approve route resolves access and applies the Ambassador rules BEFORE it creates the account", approveSrc.indexOf("resolveRequestAccess(") > 0 && approveSrc.indexOf("validateAmbassadorApproval(") > approveSrc.indexOf("resolveRequestAccess(") && approveSrc.indexOf("validateAmbassadorApproval(") < approveSrc.indexOf("auth.admin.createUser"));
  for (const r of ["reject", "delete", "charge", "charge-status"]) {
    const s = read(`src/app/api/admin/requests/[id]/${r}/route.ts`);
    check(`limits: /${r} stays admin-only — Ambassadors and Team Leaders cannot reject, delete or charge`, /assertAdmin\(\)/.test(s) && !/assertCanApproveRequests\(\)/.test(strip(s)) && !/requestReview/.test(s));
  }
  const list = strip(read("src/app/dashboard/requests/page.tsx"));
  check("wiring: the request list is scoped to the reviewer's own requests (affiliate code and/or Ambassador scope) and shows nothing when there is none", /getReviewerScope/.test(list) && /scopedSignupRequestIds/.test(list) && /referral_code\.eq\./.test(list) && /00000000-0000-0000-0000-000000000000/.test(list));
  check("wiring: the request list still gives non-admins no delete", /canDelete=\{reviewer\.isAdmin\}/.test(list));
  const detail = strip(read("src/app/dashboard/requests/[id]/page.tsx"));
  check("wiring: the detail page 404s outside the scope and locks the Ambassador review screen to online payment", /resolveRequestAccess\(/.test(detail) && /if \(!access\) notFound\(\)/.test(detail) && /requireOnlinePayment=\{access === "ambassador"\}/.test(detail) && /canReject=\{reviewer\.isAdmin\}/.test(detail) && /canCharge=\{reviewer\.isAdmin\}/.test(detail) && /canDelete=\{reviewer\.isAdmin\}/.test(detail));
  const ui = strip(read("src/components/admin/RequestReview.tsx"));
  check("screen: for Ambassadors 'Create account' also requires the client's online payment to be confirmed", /\(!requireOnlinePayment \|\| !!request\.customer_paid\)/.test(ui));
  check("screen: for Ambassadors it always sends 'charge' (the verified online-payment path) and never manual", /requireOnlinePayment \? "charge"/.test(ui));
  check("screen: plan and interval choices are locked, and the cash/transfer toggle only exists for those who can charge", (ui.match(/disabled=\{requireOnlinePayment\}/g) || []).length === 2 && /canCharge \?/.test(ui));
  check("screen: the waiting-for-payment notice and server refusals are translated (English and French)", /t\.ambassadorRequests\.awaitingOnlinePayment/.test(ui) && /t\.ambassadorRequests\.errors/.test(ui));
  const amb = strip(read("src/app/dashboard/ambassador/page.tsx"));
  const tlp = strip(read("src/app/dashboard/sales-team/page.tsx"));
  check("dashboards: both pages read the admin-granted switch server-side and show the approvals card", /can_approve_requests/.test(amb) && /ClientRequestsCard/.test(amb) && /can_approve_requests/.test(tlp) && /ClientRequestsCard/.test(tlp));
  check("dashboards: the Team Leader page shows the own-sales card (code + link, or 'add my account')", /TeamLeaderSelfSellCard/.test(tlp) && /sales_code, status/.test(tlp));
  const ambView = read("src/components/dashboard/AmbassadorDashboardView.tsx");
  const sellCard = read("src/components/dashboard/TeamLeaderSelfSellCard.tsx");
  const linkOf = (s) => (s.match(/`\$\{siteUrl\.replace\(\/\\\/\$\/, ""\)\}\/get-started-cards\?amb=\$\{[^}]+\}`/) || [])[0];
  check("link: the Team Leader's own link has the same shape as an Ambassador's (/get-started-cards?amb=CODE), using THEIR own Ambassador code", !!linkOf(ambView) && !!linkOf(sellCard));
  check("no schema change: this feature added no migration and no database object", fs.readdirSync(path.join(REPO, "supabase/migrations")).filter((f) => /ambassador/.test(f)).length === 11 && !fs.readdirSync(path.join(REPO, "supabase/migrations")).some((f) => /request|approv/i.test(f) && /2026-11-(29|3)/.test(f)));
}

// ================================================================== i18n
{
  const shape = (o) => (typeof o === "function" ? "fn" : o && typeof o === "object" ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, shape(v)])) : "str");
  check("i18n: ambassadorRequests has identical keys in English and French", JSON.stringify(shape(translations.en.ambassadorRequests)) === JSON.stringify(shape(translations.fr.ambassadorRequests)));
  const refusalCodes = [...read("src/lib/ambassador/requestReview.ts").split("export type ApprovalRefusalCode =")[1].split(";")[0].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  check("i18n: every approval refusal code has English AND French text", refusalCodes.length === 4 && refusalCodes.every((c) => translations.en.ambassadorRequests.errors[c] && translations.fr.ambassadorRequests.errors[c]), refusalCodes.join());
  const selfCodes = [...read("src/lib/ambassador/selfEnable.ts").split("export type SelfEnableErrorCode =")[1].split(";")[0].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  check("i18n: every self-enable error code has English AND French text", selfCodes.length === 5 && selfCodes.every((c) => translations.en.ambassadorRequests.selfSell.errors[c] && translations.fr.ambassadorRequests.selfSell.errors[c]), selfCodes.join());
  check("i18n: the French copy is genuinely translated", translations.fr.ambassadorRequests.cardTitle !== translations.en.ambassadorRequests.cardTitle && translations.fr.ambassadorRequests.selfSell.cta !== translations.en.ambassadorRequests.selfSell.cta && translations.fr.ambassadorRequests.errors.plan_locked !== translations.en.ambassadorRequests.errors.plan_locked);
  check("i18n: the pending count pluralises in both languages", translations.en.ambassadorRequests.pending(1) !== translations.en.ambassadorRequests.pending(3) && translations.fr.ambassadorRequests.pending(1) !== translations.fr.ambassadorRequests.pending(3));
}

const failed = results.filter((x) => !x.pass);
console.log(`\nambassadorRequestApproval: ${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
