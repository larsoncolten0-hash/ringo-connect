// Ambassador Program — Phase A (signup attribution) unit checks.
// Covers: ?amb= capture (src/lib/ambassadorReferral.ts), independence from
// the existing ?ref= mechanism, and the /api/signup-requests route's
// additive attribution block. No network, no real database, no real API
// key — jiti-loading real TypeScript source, a minimal fake `window`, and
// a fake Supabase admin client, same conventions as the rest of this suite.
//
//   Run:  node scripts/tests/ambassadorPhaseA.test.mjs
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

// ------------------------------------------------------------------ fake browser (for ambassadorReferral.ts / referral.ts)
class FakeStorage {
  constructor() {
    this.store = new Map();
  }
  getItem(k) {
    return this.store.has(k) ? this.store.get(k) : null;
  }
  setItem(k, v) {
    this.store.set(k, String(v));
  }
  removeItem(k) {
    this.store.delete(k);
  }
}
globalThis.window = { localStorage: new FakeStorage(), location: { search: "" } };

const { captureAmbassadorCodeFromUrl, getAmbassadorCode, clearAmbassadorCode } = load("lib/ambassadorReferral.ts");
const { captureReferralFromUrl, getReferralCode, clearReferralCode } = load("lib/referral.ts");

const resetBrowser = () => {
  window.localStorage = new FakeStorage();
  window.location.search = "";
};

// ------------------------------------------------------------------ 1 & 5: ?amb= capture, empty value ignored
{
  resetBrowser();
  window.location.search = "?amb=ABC123";
  captureAmbassadorCodeFromUrl();
  check("1. valid-looking ?amb= code is captured", getAmbassadorCode() === "ABC123");

  resetBrowser();
  window.location.search = "";
  captureAmbassadorCodeFromUrl();
  check("2. URL without ?amb= does nothing", getAmbassadorCode() === null);

  resetBrowser();
  window.location.search = "?amb=";
  captureAmbassadorCodeFromUrl();
  check("5. empty ?amb= value is ignored", getAmbassadorCode() === null);

  resetBrowser();
  window.location.search = "?amb=%20%20%20";
  captureAmbassadorCodeFromUrl();
  check("5b. whitespace-only ?amb= value is ignored", getAmbassadorCode() === null);
}

// ------------------------------------------------------------------ 3: independent from ?ref=
{
  resetBrowser();
  window.location.search = "?ref=REFCODE1&amb=AMBCODE1";
  captureReferralFromUrl();
  captureAmbassadorCodeFromUrl();
  check("3. ?ref= still captured correctly alongside ?amb=", getReferralCode() === "REFCODE1");
  check("3b. ?amb= still captured correctly alongside ?ref=", getAmbassadorCode() === "AMBCODE1");
  check("3c. stored under different localStorage keys (no cross-contamination)", window.localStorage.getItem("rc_ref") !== window.localStorage.getItem("rc_amb"));

  clearReferralCode();
  check("3d. clearing referral code never touches the ambassador code", getAmbassadorCode() === "AMBCODE1");
  clearAmbassadorCode();
  check("3e. clearing ambassador code leaves no trace", getAmbassadorCode() === null);
}

// ------------------------------------------------------------------ 4: survives "navigation" (independent reads from storage, not React state)
{
  resetBrowser();
  window.location.search = "?amb=PERSISTED1";
  captureAmbassadorCodeFromUrl();
  // Simulate moving to a later step/page with no ?amb= in the URL anymore —
  // getAmbassadorCode() must still return the earlier-captured value purely
  // from storage, same as a real page navigation would.
  window.location.search = "";
  check("4. ambassador code survives navigation via localStorage", getAmbassadorCode() === "PERSISTED1");
  // First-touch-wins: a second, different code on a later page must never overwrite it.
  window.location.search = "?amb=SHOULDNOTOVERWRITE";
  captureAmbassadorCodeFromUrl();
  check("4b. first-touch-wins — a later ?amb= never overwrites an already-stored code", getAmbassadorCode() === "PERSISTED1");
}

delete globalThis.window;

// ------------------------------------------------------------------ signup-requests route setup
const WHATSAPP = "+237600000000";
const CARD_ADDON = { id: "addon-standard", name: "Ringo Physical Card (Standard)", price_xaf: "3500.00", grants_plan_name: "basic", grants_plan_duration_days: 30 };
const NON_CARD_ADDON = { id: "addon-other", name: "Some Other Addon", price_xaf: "1000.00", grants_plan_name: null, grants_plan_duration_days: null };

function fakeAdmin(rpcHandler) {
  const signupRequests = new Map();
  let nextId = 1;
  const calls = { rpc: [], deletes: [], updates: [] };
  const db = {
    calls,
    signupRequests,
    from(table) {
      const filters = [];
      let op = "select";
      let payload;
      const b = {
        select: () => b,
        insert(p) {
          op = "insert";
          payload = p;
          return b;
        },
        update(p) {
          op = "update";
          payload = p;
          calls.updates.push({ table, patch: p });
          return b;
        },
        delete() {
          op = "delete";
          calls.deletes.push({ table });
          return b;
        },
        eq(k, v) {
          filters.push([k, v, null]);
          return b;
        },
        in(k, vals) {
          filters.push([k, "__in__", vals]);
          return b;
        },
        single: async () => resolve(true),
        maybeSingle: async () => resolve(true),
        then(res, rej) {
          return Promise.resolve(resolve(false)).then(res, rej);
        },
      };
      const matches = (row) => filters.every(([k, v, extra]) => (v === "__in__" ? extra.includes(row[k]) : row[k] === v));
      function resolve(single) {
        if (table === "signup_requests") {
          if (op === "insert") {
            const row = { id: `sr_${nextId++}`, ...payload };
            signupRequests.set(row.id, row);
            return { data: single ? row : [row], error: null };
          }
          if (op === "update") {
            const rows = Array.from(signupRequests.values()).filter(matches);
            for (const r of rows) Object.assign(r, payload);
            return { data: single ? rows[0] ?? null : rows, error: null };
          }
          if (op === "delete") {
            const rows = Array.from(signupRequests.values()).filter(matches);
            for (const r of rows) signupRequests.delete(r.id);
            return { data: null, error: null };
          }
          const rows = Array.from(signupRequests.values()).filter(matches);
          return { data: single ? rows[0] ?? null : rows, error: null };
        }
        if (table === "addons") {
          const rows = [CARD_ADDON, NON_CARD_ADDON].filter(matches);
          return { data: rows, error: null };
        }
        return { data: single ? null : [], error: null };
      }
      return b;
    },
    rpc: async (name, args) => {
      calls.rpc.push({ name, args });
      if (rpcHandler) return rpcHandler(name, args);
      return { data: { ok: true, sale_id: "sale_1" }, error: null };
    },
  };
  return db;
}

const serverMod = load("lib/supabase/server.ts");
const pushMod = load("lib/push/withBell.ts");
pushMod.sendPushAndBellToAdmins = async () => {};

function loadRoute() {
  // Fresh module instance per call isn't needed — the route only reads
  // createAdminClient at call time (same jiti-cache-mutation technique
  // used throughout this test suite), so one load is enough.
  return load("app/api/signup-requests/route.ts");
}
const { POST } = loadRoute();

const baseBody = () => ({
  full_name: "Jane Doe",
  whatsapp_number: WHATSAPP,
  email: "jane@example.com",
});
const post = async (body) => {
  const req = { json: async () => body };
  const quiet = console.error;
  console.error = () => {};
  try {
    return await POST(req);
  } finally {
    console.error = quiet;
  }
};

// ------------------------------------------------------------------ 6: no ambassador_code -> behaves exactly as before
{
  const admin = fakeAdmin();
  serverMod.createAdminClient = () => admin;
  const res = await post(baseBody());
  const json = await res.json();
  check("6. plain signup (no ambassador_code) succeeds", res.status === 200 && json.ok === true, JSON.stringify(json));
  check("6b. no attribution RPC call happens without a code", admin.calls.rpc.length === 0);
  const row = admin.signupRequests.get(json.id);
  check("6c. inserted row has no ambassador_code field at all", !("ambassador_code" in row), JSON.stringify(row));
}

// ------------------------------------------------------------------ 7: valid code + real card addon -> RPC called with correct args
{
  const admin = fakeAdmin();
  serverMod.createAdminClient = () => admin;
  const res = await post({ ...baseBody(), ambassador_code: "amb-code-1", requested_addon_ids: [CARD_ADDON.id] });
  const json = await res.json();
  check("7. signup with a valid-looking ambassador_code + card addon succeeds", res.status === 200 && json.ok === true);
  check("7b. exactly one attribution RPC call is made", admin.calls.rpc.length === 1, JSON.stringify(admin.calls.rpc));
  const call = admin.calls.rpc[0];
  check("7c. calls the approved database function by name", call?.name === "ambassador_attribute_sale");
  check(
    "7d. RPC args are exactly the expected 7 keys, sourced correctly",
    call &&
      call.args.p_signup_request_id === json.id &&
      call.args.p_ambassador_code === "amb-code-1" &&
      call.args.p_signup_email === "jane@example.com" &&
      call.args.p_signup_whatsapp === WHATSAPP &&
      call.args.p_card_type === CARD_ADDON.name &&
      call.args.p_selling_price === 3500 &&
      call.args.p_payment_reference === null &&
      Object.keys(call.args).length === 7,
    JSON.stringify(call?.args)
  );
  check("7e. on success, ambassador_code is written back onto the row", admin.signupRequests.get(json.id).ambassador_code === "AMB-CODE-1");
}

// ------------------------------------------------------------------ ambassador_code present but no real card addon -> RPC never called
{
  const admin = fakeAdmin();
  serverMod.createAdminClient = () => admin;
  const res = await post({ ...baseBody(), ambassador_code: "amb-code-1", requested_addon_ids: [NON_CARD_ADDON.id] });
  const json = await res.json();
  check("no-card-addon: signup still succeeds", res.status === 200 && json.ok === true);
  check("no-card-addon: attribution is never attempted (not a qualifying sale)", admin.calls.rpc.length === 0);
}

// ------------------------------------------------------------------ 8: referral_code is never touched by ambassador_code
{
  const admin = fakeAdmin();
  serverMod.createAdminClient = () => admin;
  const res = await post({
    ...baseBody(),
    referral_code: "some-affiliate-code",
    ambassador_code: "amb-code-1",
    requested_addon_ids: [CARD_ADDON.id],
  });
  const json = await res.json();
  const row = admin.signupRequests.get(json.id);
  check("8. referral_code stores its own submitted value, untouched by ambassador_code", row.referral_code === "SOME-AFFILIATE-CODE", JSON.stringify(row));
  check("8b. ambassador_code never leaks into referral_code or vice versa", row.referral_code !== row.ambassador_code);
}

// ------------------------------------------------------------------ 9: client cannot supply ambassador_id/team_id/commission values
{
  const admin = fakeAdmin();
  serverMod.createAdminClient = () => admin;
  await post({
    ...baseBody(),
    ambassador_code: "amb-code-1",
    requested_addon_ids: [CARD_ADDON.id],
    // A malicious/confused client trying to smuggle in values that must
    // remain entirely database-resolved.
    ambassador_id: "attacker-controlled-id",
    team_leader_id: "attacker-controlled-id",
    commission_percentage: 0.99,
    commission_amount: 999999,
    selling_price: 1, // an attempt to undercut the real addon price
  });
  const call = admin.calls.rpc[0];
  check(
    "9. none of the client-supplied id/commission/price fields ever reach the RPC call",
    call && !("ambassador_id" in call.args) && !("team_leader_id" in call.args) && !("commission_percentage" in call.args) && !("commission_amount" in call.args),
    JSON.stringify(call?.args)
  );
  check("9b. selling price always comes from the real addon row, never the client", call.args.p_selling_price === 3500);
}

// ------------------------------------------------------------------ 10: unexpected attribution failure is never silently treated as success
{
  const admin = fakeAdmin(() => ({ data: null, error: { message: "connection reset" } }));
  serverMod.createAdminClient = () => admin;
  const res = await post({ ...baseBody(), ambassador_code: "amb-code-1", requested_addon_ids: [CARD_ADDON.id] });
  const json = await res.json();
  check("10. an unexpected DB failure during a real attribution attempt is surfaced as an error", res.status === 500 && json.ok !== true, JSON.stringify(json));
  check("10b. the just-created signup_requests row is rolled back, not left half-attributed", admin.signupRequests.size === 0);

  // Contrast: an ORDINARY declined attribution (invalid code) must NOT roll back or error.
  const admin2 = fakeAdmin(() => ({ data: { ok: false, reason: "invalid_code" }, error: null }));
  serverMod.createAdminClient = () => admin2;
  const res2 = await post({ ...baseBody(), ambassador_code: "bad-code", requested_addon_ids: [CARD_ADDON.id] });
  const json2 = await res2.json();
  check("10c. an ordinary declined attribution (invalid code) still lets the signup succeed", res2.status === 200 && json2.ok === true, JSON.stringify(json2));
  check("10d. a declined attribution never rolls back the signup", admin2.signupRequests.size === 1);
  const row2 = admin2.signupRequests.get(json2.id);
  check("10e. a declined attribution never writes ambassador_code onto the row", !row2.ambassador_code, JSON.stringify(row2));
}

const failed = results.filter((x) => !x.pass);
console.log(`\nambassadorPhaseA: ${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
