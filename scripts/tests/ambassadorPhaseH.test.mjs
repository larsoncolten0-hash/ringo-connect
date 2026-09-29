// Ambassador Program — Phase H (payout workflow) unit checks. No network, no
// real database, no real Fapshi. Money maths is NOT re-tested here (that is the
// approved SQL functions' job, and those migrations are not yet applied) — these
// tests verify the application layer: identity/role derivation, that no
// client-supplied amount/recipient/status can reach a financial call, claim-before-
// send concurrency safety, correct use of the approved RPCs, non-fatal
// notifications, and isolation from the legacy affiliate system.
//
//   Run:  node scripts/tests/ambassadorPhaseH.test.mjs
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
const quiet = async (fn) => {
  const o = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = o;
  }
};

// ------------------------------------------------------------------ fake admin client
function makeFakeAdmin(seed = {}, rpcHandlers = {}) {
  const tables = new Map();
  for (const [name, rows] of Object.entries(seed)) tables.set(name, new Map(rows.map((r) => [r.id, { ...r }])));
  const calls = { rpc: [], writes: [] };
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
      is(k, v) {
        filters.push((r) => (r[k] ?? null) === v);
        return b;
      },
      not: () => b,
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
      const rows = Array.from(store.values()).filter(matches).slice(0, max);
      return { data: single ? rows[0] ?? null : rows, error: null };
    }
    return b;
  };
  const admin = {
    _tables: tables,
    _calls: calls,
    from,
    rpc: async (name, args) => {
      calls.rpc.push({ name, args });
      if (rpcHandlers[name]) return rpcHandlers[name](args, admin);
      return { data: { ok: true }, error: null };
    },
  };
  return admin;
}

// ------------------------------------------------------------------ mocks: push sender + Fapshi
const withBell = load("lib/push/withBell.ts");
let sent = [];
let adminSent = [];
let senderThrows = false;
withBell.sendPushAndBellToUser = async (admin, userId, payload) => {
  if (senderThrows) throw new Error("push down");
  sent.push({ userId, ...payload });
  await admin.from("notifications").insert({ audience: "user", user_id: userId, type: payload.category, link: payload.url });
};
withBell.sendPushAndBellToAdmins = async (_admin, payload) => {
  if (senderThrows) throw new Error("push down");
  adminSent.push(payload);
};
const fapshi = load("lib/fapshi.ts");
let fapshiPayoutCalls = [];
let fapshiPayoutImpl = async () => ({ transId: "TX123" });
let fapshiStatusImpl = async () => ({ status: "SUCCESSFUL" });
fapshi.fapshiPayout = async (params) => {
  fapshiPayoutCalls.push(params);
  return fapshiPayoutImpl(params);
};
fapshi.fapshiGetStatus = async (id, opts) => fapshiStatusImpl(id, opts);
const reset = () => {
  sent = [];
  adminSent = [];
  senderThrows = false;
  fapshiPayoutCalls = [];
  fapshiPayoutImpl = async () => ({ transId: "TX123" });
  fapshiStatusImpl = async () => ({ status: "SUCCESSFUL" });
};

const payouts = load("lib/ambassador/payouts.ts");
const adminLib = load("lib/ambassador/adminPayouts.ts");
const { translations } = load("lib/i18n/translations.ts");

const U = { amb: "00000000-0000-4000-8000-0000000000a1", tl: "00000000-0000-4000-8000-0000000000b1", other: "00000000-0000-4000-8000-0000000000c1", admin: "00000000-0000-4000-8000-0000000000ad" };
const P1 = "10000000-0000-4000-8000-000000000001";
const P2 = "10000000-0000-4000-8000-000000000002";
const L1 = "20000000-0000-4000-8000-000000000001";

const seedBase = () => ({
  ambassador_profiles: [
    { id: "amb1", user_id: U.amb, status: "active" },
    { id: "amb2", user_id: U.other, status: "suspended" },
  ],
  ambassador_teams: [{ id: "team1", team_leader_user_id: U.tl }],
  profiles: [
    { id: "p1", user_id: U.amb, is_demo: false },
    { id: "p2", user_id: U.tl, is_demo: false },
  ],
});
const MOMO = { provider: "mtn", phone: "677123456" };

// ================================================================== destination validation
{
  const ok = payouts.validateDestination("mobile_money", { ...MOMO, amount: 99999, recipient_user_id: "x", status: "paid" });
  check("destination: mobile money accepted and stripped to provider+phone only (no amount/recipient/status survives)", ok.ok && JSON.stringify(Object.keys(ok.value.details).sort()) === '["phone","provider"]' && !("amount" in ok.value.details), JSON.stringify(ok));
  check("destination: invalid provider / phone rejected", !payouts.validateDestination("mobile_money", { provider: "visa", phone: "677123456" }).ok && !payouts.validateDestination("mobile_money", { provider: "mtn", phone: "abc" }).ok);
  check("destination: bank needs all three fields", payouts.validateDestination("bank", { accountName: "A", accountNumber: "1", bankName: "B" }).ok && !payouts.validateDestination("bank", { accountName: "A" }).ok);
  check("destination: unknown method (e.g. paypal — legacy affiliate only) rejected", !payouts.validateDestination("paypal", { email: "a@b.c" }).ok);
}

// (Requesting a payout, saved destinations, balances, and the Fapshi send/check/manual/resolve/reject/reverse
// flows were rewritten for the hardened SQL state machine — see ambassadorHardening.test.mjs.)

// ================================================================== admin: authorization on every route
{
  const assertAdminMod = load("lib/assertAdmin.ts");
  const serverMod = load("lib/supabase/server.ts");
  const fake = makeFakeAdmin({});
  serverMod.createAdminClient = () => fake;
  assertAdminMod.assertAdmin = async () => null;
  const routes = [
    ["app/api/admin/ambassador-payouts/eligible/route.ts", [{ json: async () => ({ ledgerIds: [L1] }) }]],
    ["app/api/admin/ambassador-payouts/[id]/send/route.ts", [{}, { params: { id: P1 } }]],
    ["app/api/admin/ambassador-payouts/[id]/check/route.ts", [{}, { params: { id: P1 } }]],
    ["app/api/admin/ambassador-payouts/[id]/mark-paid/route.ts", [{ json: async () => ({ note: "ref 1" }) }, { params: { id: P1 } }]],
    ["app/api/admin/ambassador-commissions/[id]/reverse/route.ts", [{ json: async () => ({ reason: "refund" }) }, { params: { id: L1 } }]],
  ];
  let allForbidden = true;
  for (const [file, args] of routes) {
    const { POST } = load(file);
    const res = await POST(...args);
    if (res.status !== 403) allForbidden = false;
  }
  check("auth: every admin payout/reversal route returns 403 for a non-admin", allForbidden);
  check("auth: a rejected caller triggers no RPC, no write and no Fapshi call", fake._calls.rpc.length === 0 && fake._calls.writes.length === 0 && fapshiPayoutCalls.length === 0);

  // user route: unauthenticated -> 401, and a non-admin session cannot reach admin actions via it
  const { POST: userPost } = load("app/api/ambassador/payouts/route.ts");
  serverMod.createClient = () => ({ auth: { getUser: async () => ({ data: { user: null } }) } });
  const res = await userPost({ json: async () => ({ role: "ambassador", method: "mobile_money", details: MOMO }) });
  check("auth: the requester route returns 401 without a session", res.status === 401);

  // user route: identity comes from the session, not the body
  reset();
  const rpcSeen = [];
  const routeAdmin = makeFakeAdmin(seedBase(), { ambassador_request_payout: async (args) => (rpcSeen.push(args), { data: { ok: true, payout_id: P1, amount: 1 }, error: null }) });
  serverMod.createAdminClient = () => routeAdmin;
  serverMod.createClient = () => ({ auth: { getUser: async () => ({ data: { user: { id: U.amb } } }) } });
  const res2 = await userPost({ json: async () => ({ role: "ambassador", method: "mobile_money", details: MOMO, userId: U.other, recipient_user_id: U.other, amount: 5e6 }) });
  check("auth: the requester route uses the session identity even when the body names someone else", res2.status === 200 && rpcSeen.length === 1 && rpcSeen[0].p_recipient_user_id === U.amb);

  // admin route with an admin session reaches the library
  assertAdminMod.assertAdmin = async () => ({ id: U.admin });
  const eligibleAdmin = makeFakeAdmin({}, { ambassador_mark_commission_eligible: async () => ({ data: 1, error: null }) });
  serverMod.createAdminClient = () => eligibleAdmin;
  const { POST: eligiblePost } = load("app/api/admin/ambassador-payouts/eligible/route.ts");
  const ok = await eligiblePost({ json: async () => ({ ledgerIds: [L1], actor: "evil", p_actor_user_id: "evil" }) });
  const args = eligibleAdmin._calls.rpc[0]?.args;
  check("auth: admin route works for an admin and the actor id is the session admin, never the body", ok.status === 200 && args?.p_actor_user_id === U.admin);
}

// ================================================================== admin: mark eligible
{
  const admin = makeFakeAdmin({}, { ambassador_mark_commission_eligible: async () => ({ data: 2, error: null }) });
  const bad = await adminLib.markCommissionsEligible(admin, U.admin, ["not-a-uuid"]);
  const empty = await adminLib.markCommissionsEligible(admin, U.admin, []);
  const huge = await adminLib.markCommissionsEligible(admin, U.admin, Array.from({ length: 201 }, (_, i) => `20000000-0000-4000-8000-${String(i).padStart(12, "0")}`));
  check("eligible: non-uuid, empty and oversized id lists are rejected before any RPC", !bad.ok && !empty.ok && !huge.ok && admin._calls.rpc.length === 0);
  const ok = await adminLib.markCommissionsEligible(admin, U.admin, [L1, L1]);
  check("eligible: ids are de-duplicated and the DB function's count is returned", ok.ok && ok.count === 2 && admin._calls.rpc[0].args.p_ledger_ids.length === 1);
}

// ================================================================== static financial-integrity + legacy isolation
{
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const files = ["src/lib/ambassador/payouts.ts", "src/lib/ambassador/adminPayouts.ts", "src/app/api/ambassador/payouts/route.ts", "src/app/api/admin/ambassador-payouts/eligible/route.ts", "src/app/api/admin/ambassador-payouts/[id]/send/route.ts", "src/app/api/admin/ambassador-payouts/[id]/check/route.ts", "src/app/api/admin/ambassador-payouts/[id]/mark-paid/route.ts", "src/app/api/admin/ambassador-commissions/[id]/reverse/route.ts"];
  const src = files.map((f) => strip(read(f))).join("\n");
  check("integrity: no code path writes the commission ledger directly (only the approved RPCs do)", !/from\("ambassador_commission_ledger"\)\s*\.\s*(update|insert|delete|upsert)/.test(src));
  check("integrity: no code path inserts payouts directly, or sets a payout to 'paid'", !/from\("ambassador_payouts"\)\s*\.\s*(insert|delete|upsert)/.test(src) && !/status:\s*"paid"/.test(src));
  check("isolation: nothing references the legacy affiliate system (affiliate_payouts/commissions, users.affiliate_*, lib/affiliate)", !/affiliate/i.test(src));
  check("privacy: payout destinations are never read from or written to ambassador_profiles", !/ambassador_profiles[\s\S]{0,80}payout_(method|details)/.test(src));
  check("integrity: the requester route accepts no amount field", !/body\??\.amount|amount:\s*body/.test(strip(read("src/app/api/ambassador/payouts/route.ts"))));
  const adminView = read("src/components/admin/AmbassadorPayoutActions.tsx") + read("src/components/dashboard/AmbassadorPayoutPanel.tsx");
  const bodies = [...adminView.matchAll(/JSON\.stringify\(([\s\S]*?)\)\s*[,}]/g)].map((m) => m[1]).join(" ");
  check("integrity: the UI request bodies contain no amount, recipient id or status field", bodies.length > 0 && !/amount|recipient|status/i.test(bodies), bodies);
}

// ================================================================== i18n parity
{
  const shape = (o) => (typeof o === "function" ? "fn" : o && typeof o === "object" ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, shape(v)])) : "str");
  const same = JSON.stringify(shape(translations.en.ambassadorPayouts)) === JSON.stringify(shape(translations.fr.ambassadorPayouts));
  check("i18n: ambassadorPayouts has identical keys/shape in English and French", same);
  check("i18n: French payout copy is translated (title, request CTA, an error)", translations.fr.ambassadorPayouts.title !== translations.en.ambassadorPayouts.title && translations.fr.ambassadorPayouts.requestCta !== translations.en.ambassadorPayouts.requestCta && translations.fr.ambassadorPayouts.errors.nothing_eligible !== translations.en.ambassadorPayouts.errors.nothing_eligible);
  const codes = Object.keys(translations.en.ambassadorPayouts.admin.errors);
  const emitted = [...read("src/lib/ambassador/adminPayouts.ts").matchAll(/fail\("([a-z_]+)"/g)].map((m) => m[1]);
  check("i18n: every error code the admin library can return has bilingual text", emitted.every((c) => codes.includes(c) && translations.fr.ambassadorPayouts.admin.errors[c]), emitted.filter((c) => !codes.includes(c)).join());
  const userCodes = Object.keys(translations.en.ambassadorPayouts.errors);
  const userEmitted = [...read("src/lib/ambassador/payouts.ts").matchAll(/code: "([a-z_]+)"/g)].map((m) => m[1]);
  check("i18n: every error code the requester flow can return has bilingual text", userEmitted.every((c) => userCodes.includes(c)), userEmitted.filter((c) => !userCodes.includes(c)).join());
  check("i18n: the admin 'payout requested' notification exists in both languages", !!translations.en.ambassadorNotifications.admin.payoutRequested.title && !!translations.fr.ambassadorNotifications.admin.payoutRequested.title);
}

const failed = results.filter((x) => !x.pass);
console.log(`\nambassadorPhaseH: ${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
