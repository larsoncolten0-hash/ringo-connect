// Ambassador Program — Phase G (Ambassador / Team Leader notifications) unit
// checks. No network, no real database, no real push service — jiti-loading
// real TypeScript source and a fake Supabase admin client, same conventions as
// the rest of this suite. Commission math is NOT faked or re-tested here (that
// is the approved SQL functions' job); these tests verify who gets notified,
// with what copy, exactly once, and that a notification problem can never
// affect the underlying event.
//
//   Run:  node scripts/tests/ambassadorPhaseG.test.mjs
import fs from "fs";
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

// ------------------------------------------------------------------ fake Supabase admin client
function makeFakeAdmin(seed = {}, rpcHandlers = {}) {
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
  return {
    _tables: tables,
    _calls: calls,
    from,
    auth: { admin: { createUser: async () => ({ data: { user: { id: "user-new-1" } }, error: null }) } },
    rpc: async (name, args) => {
      calls.rpc.push({ name, args });
      if (rpcHandlers[name]) return rpcHandlers[name](args);
      return { data: { ok: true }, error: null };
    },
  };
}

// ------------------------------------------------------------------ capture sendPushAndBellToUser
// Mirrors the real function's observable effect on the `notifications`
// table (a bell row per call) so the notifier's dedup query has something
// real to find; records every call for assertions.
const withBell = load("lib/push/withBell.ts");
let sent = [];
let senderBehavior = "ok"; // "ok" | "throw"
withBell.sendPushAndBellToUser = async (admin, userId, payload) => {
  if (senderBehavior === "throw") throw new Error("push service exploded");
  sent.push({ userId, ...payload });
  await admin.from("notifications").insert({ audience: "user", user_id: userId, type: payload.category, title: payload.title, body: payload.body, link: payload.url });
};
withBell.sendPushAndBellToAdmins = async () => {};
const reset = () => {
  sent = [];
  senderBehavior = "ok";
};

const quiet = async (fn) => {
  const orig = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = orig;
  }
};

const notif = load("lib/ambassador/notifications.ts");
const { translations } = load("lib/i18n/translations.ts");

const LEDGER = (over) => ({ sale_id: "sale1", entry_type: "commission", currency: "XAF", ...over });
function seedProgram() {
  return {
    ambassador_profiles: [
      // Current team (team-new / uNew) differs from the sale's attribution-time snapshot (team-old / uOld).
      { id: "amb1", user_id: "uAmb", team_id: "team-new" },
    ],
    ambassador_teams: [
      { id: "team-old", team_leader_user_id: "uOld" },
      { id: "team-new", team_leader_user_id: "uNew" },
    ],
    ambassador_sales: [
      { id: "sale1", ambassador_id: "amb1", team_id: "team-old", customer_user_id: "uCust", status: "milestone_1_earned" },
      { id: "sale-noteam", ambassador_id: "amb1", team_id: null, customer_user_id: "uCust2", status: "locked" },
    ],
    ambassador_commission_ledger: [
      LEDGER({ id: "l-amb-1", recipient_type: "ambassador", recipient_user_id: "uAmb", milestone: "sale_registration", commission_amount: 3750 }),
      LEDGER({ id: "l-tl-1", recipient_type: "team_leader", recipient_user_id: "uOld", milestone: "sale_registration", commission_amount: 1250 }),
      LEDGER({ id: "l-amb-2", recipient_type: "ambassador", recipient_user_id: "uAmb", milestone: "activation", commission_amount: 3750 }),
      LEDGER({ id: "l-tl-2", recipient_type: "team_leader", recipient_user_id: "uOld", milestone: "activation", commission_amount: 1250 }),
    ],
    ambassador_payouts: [
      { id: "po1", recipient_type: "ambassador", recipient_user_id: "uAmb", amount: 7500, currency: "XAF" },
      { id: "po2", recipient_type: "team_leader", recipient_user_id: "uOld", amount: 2500, currency: "XAF" },
    ],
  };
}

// ================================================================== recipients
{
  reset();
  const admin = makeFakeAdmin(seedProgram());
  await notif.notifyMilestoneEarned(admin, "sale1", "sale_registration");
  const toAmb = sent.filter((s) => s.userId === "uAmb");
  const toLeader = sent.filter((s) => s.userId === "uOld");
  check("recipient: the Ambassador gets exactly one milestone-1 notification", toAmb.length === 1 && toAmb[0].category === "ambassador_registration_completed", JSON.stringify(sent));
  check("recipient: the Team Leader on the ledger gets exactly one milestone-1 notification", toLeader.length === 1 && toLeader[0].category === "ambassador_registration_completed");
  check("recipient: Ambassador is sent to their own dashboard, Team Leader to the sales-team dashboard", toAmb[0].url.startsWith("/dashboard/ambassador#") && toLeader[0].url.startsWith("/dashboard/sales-team#"));
  check("recipient: nobody else (not the customer, not the current team's leader) is notified", sent.length === 2 && !sent.some((s) => s.userId === "uCust" || s.userId === "uNew"));
}

// ================================================================== historical attribution
{
  reset();
  const admin = makeFakeAdmin(seedProgram());
  await notif.notifySaleConfirmed(admin, "sale1");
  const ids = sent.map((s) => s.userId).sort();
  check("historical: sale-confirmed goes to the Team Leader snapshotted on the sale (uOld), not the Ambassador's CURRENT team leader (uNew)", JSON.stringify(ids) === JSON.stringify(["uAmb", "uOld"]), JSON.stringify(ids));
  check("historical: the Ambassador's current team's leader is never notified about an old sale", !sent.some((s) => s.userId === "uNew"));

  reset();
  await notif.notifySaleConfirmed(admin, "sale-noteam");
  check("historical: a sale attributed with no team notifies only the Ambassador — a later team never backfills", sent.length === 1 && sent[0].userId === "uAmb");

  reset();
  await notif.notifyMilestoneEarned(admin, "sale1", "activation");
  check("historical: activation notifications follow the ledger's recipients (uOld), never the current team", sent.some((s) => s.userId === "uOld") && !sent.some((s) => s.userId === "uNew"));
}

// ================================================================== English + French content
{
  const en = translations.en.ambassadorNotifications;
  const fr = translations.fr.ambassadorNotifications;
  const groups = ["ambassador", "teamLeader"];
  const keys = ["saleConfirmed", "registrationCompleted", "activationCompleted", "payoutRequested", "payoutProcessing", "payoutPaid", "payoutFailed", "commissionReversed"];
  let complete = true;
  let differs = true;
  for (const g of groups) {
    for (const k of keys) {
      const e = en[g]?.[k];
      const f = fr[g]?.[k];
      if (!e || !f || !e.title || !f.title || typeof e.body !== typeof f.body) complete = false;
      else if (e.title === f.title) differs = false;
    }
  }
  check("content: every notification exists in BOTH English and French for BOTH roles", complete);
  check("content: French titles are genuinely translated, not copies of the English", differs);
  check("content: English amount copy carries the amount", en.ambassador.registrationCompleted.body("XAF 3,750").includes("XAF 3,750"));
  check("content: French amount copy carries the amount", fr.teamLeader.activationCompleted.body("3 750 FCFA").includes("3 750 FCFA"));

  reset();
  const admin = makeFakeAdmin(seedProgram());
  await notif.notifyMilestoneEarned(admin, "sale1", "sale_registration");
  const amb = sent.find((s) => s.userId === "uAmb");
  check("content: delivered copy is the French default (no stored recipient language) and uses the ledger amount", /gagné/.test(amb.body) && /3[\s  .,]?750/.test(amb.body), amb.body);
  check("content: delivered title matches the French translation", amb.title === fr.ambassador.registrationCompleted.title);
}

// ================================================================== dedup
{
  reset();
  const admin = makeFakeAdmin(seedProgram());
  await notif.notifyMilestoneEarned(admin, "sale1", "sale_registration");
  await notif.notifyMilestoneEarned(admin, "sale1", "sale_registration");
  await notif.notifyMilestoneEarned(admin, "sale1", "sale_registration");
  check("dedup: re-evaluating the same milestone 3 times still yields exactly one notification per recipient", sent.length === 2, `sent=${sent.length}`);

  await notif.notifyMilestoneEarned(admin, "sale1", "activation");
  check("dedup: a DIFFERENT milestone on the same sale is still notified (keys are per event, not per sale)", sent.length === 4, `sent=${sent.length}`);

  reset();
  const admin2 = makeFakeAdmin(seedProgram());
  await notif.notifySaleConfirmed(admin2, "sale1");
  await notif.notifySaleConfirmed(admin2, "sale1");
  check("dedup: repeated sale-confirmed for one sale notifies each recipient once", sent.length === 2);

  reset();
  const admin3 = makeFakeAdmin(seedProgram());
  await notif.notifyPayoutStatus(admin3, "po1", "requested");
  await notif.notifyPayoutStatus(admin3, "po1", "requested");
  await notif.notifyPayoutStatus(admin3, "po1", "paid");
  check("dedup: a payout status notifies once per distinct status, never twice for the same one", sent.length === 2 && sent[0].category === "ambassador_payout_requested" && sent[1].category === "ambassador_payout_paid");

  // Activation sweep: run repeatedly; SQL reports ok:true only on the first transition.
  reset();
  const { sweepAmbassadorActivation } = load("lib/ambassador/activationSweep.ts");
  let evaluated = 0;
  const sweepAdmin = makeFakeAdmin(
    { ...seedProgram(), ambassador_sales: [{ id: "sale1", ambassador_id: "amb1", team_id: "team-old", customer_user_id: "uCust", status: "milestone_1_earned" }] },
    {
      ambassador_evaluate_milestone_2: async () => {
        evaluated++;
        if (evaluated === 1) {
          sweepAdmin._tables.get("ambassador_sales").get("sale1").status = "milestone_2_earned";
          return { data: { ok: true, sale_id: "sale1" }, error: null };
        }
        return { data: { ok: false, reason: "not_ready_for_evaluation" }, error: null };
      },
    }
  );
  await sweepAmbassadorActivation(sweepAdmin);
  await sweepAmbassadorActivation(sweepAdmin);
  check("dedup: the cron sweep run twice notifies once per recipient", sent.length === 2 && sent.every((s) => s.category === "ambassador_activation_completed"), `sent=${sent.length}`);

  // Even if the SQL layer reported ok:true twice (concurrent callers), the bell-row guard holds.
  reset();
  const raceAdmin = makeFakeAdmin({ ...seedProgram(), ambassador_sales: [{ id: "sale1", ambassador_id: "amb1", team_id: "team-old", customer_user_id: "uCust", status: "milestone_1_earned" }] }, {
    ambassador_evaluate_milestone_2: async () => ({ data: { ok: true, sale_id: "sale1" }, error: null }),
  });
  await sweepAmbassadorActivation(raceAdmin);
  await sweepAmbassadorActivation(raceAdmin);
  check("dedup: even two ok:true evaluations for one sale (concurrent callers) never double-notify", sent.length === 2, `sent=${sent.length}`);
}

// ================================================================== payouts + reversals
{
  reset();
  const admin = makeFakeAdmin(seedProgram());
  await notif.notifyPayoutStatus(admin, "po2", "processing");
  check("payout: a Team Leader payout goes to that Team Leader, linking to the sales-team dashboard", sent.length === 1 && sent[0].userId === "uOld" && sent[0].url.startsWith("/dashboard/sales-team#"));
  await notif.notifyPayoutStatus(admin, "po1", "failed");
  check("payout: failed uses its own category and goes to the Ambassador", sent[1].userId === "uAmb" && sent[1].category === "ambassador_payout_failed");
  check("payout: amount is the payout row's own amount", /2[\s  .,]?500/.test(sent[0].body), sent[0].body);
  await notif.notifyPayoutStatus(admin, "does-not-exist", "paid");
  check("payout: an unknown payout id notifies nobody", sent.length === 2);

  reset();
  const admin2 = makeFakeAdmin({
    ...seedProgram(),
    ambassador_commission_ledger: [
      LEDGER({ id: "orig-1", recipient_type: "ambassador", recipient_user_id: "uAmb", milestone: "activation", commission_amount: 3750 }),
      LEDGER({ id: "rec-1", entry_type: "reversal", reversed_ledger_id: "orig-1", recipient_type: "ambassador", recipient_user_id: "uAmb", milestone: "activation", commission_amount: -3750 }),
    ],
  });
  await notif.notifyCommissionReversed(admin2, "orig-1");
  await notif.notifyCommissionReversed(admin2, "rec-1");
  check("reversal: one notification to the row's own recipient with a positive display amount, even if the recovery row id is passed too", sent.length === 1 && sent[0].userId === "uAmb" && !/-/.test(sent[0].body) && /3[\s  .,]?750/.test(sent[0].body), JSON.stringify(sent));
}

// ================================================================== customers never see commission info
{
  reset();
  const admin = makeFakeAdmin(seedProgram());
  await notif.notifySaleConfirmed(admin, "sale1");
  await notif.notifyMilestoneEarned(admin, "sale1", "sale_registration");
  await notif.notifyMilestoneEarned(admin, "sale1", "activation");
  check("customer: the sale's customer_user_id is never a recipient of anything", !sent.some((s) => s.userId === "uCust"));
  const src = fs.readFileSync(path.join(REPO, "src/lib/ambassador/notifications.ts"), "utf8");
  check("customer: the notifier has no customer-facing send path at all (no notifyCustomer / customer inbox / multi-user fan-out)", !/notifyCustomer|customer\/inbox|sendPushAndBellToUsers|sendPushToOrderWatcher|sendPushToSubscriber|sendEmail/.test(src));
  const saleConfirmedText = sent.filter((s) => s.category === "ambassador_sale_confirmed").map((s) => `${s.title} ${s.body}`).join(" ");
  check("customer: the pre-commission sale-confirmed copy carries no money figure", !/\d/.test(saleConfirmedText.replace(/#n-.*/g, "")), saleConfirmedText);
  // The customer-facing side of each hooked event is untouched: still no Ambassador wording in it.
  const approve = fs.readFileSync(path.join(REPO, "src/app/api/admin/requests/[id]/approve/route.ts"), "utf8");
  check("customer: the approve route's customer-facing email/notification code was not given any ambassador wording", !/ambassadorNotifications|notifySaleConfirmed/.test(approve) && (approve.match(/notifyMilestoneEarned/g) || []).length === 2);
}

// ================================================================== failure never breaks the underlying event
{
  reset();
  senderBehavior = "throw";
  const admin = makeFakeAdmin(seedProgram());
  let threw = false;
  await quiet(async () => {
    try {
      await notif.notifySaleConfirmed(admin, "sale1");
      await notif.notifyMilestoneEarned(admin, "sale1", "sale_registration");
      await notif.notifyPayoutStatus(admin, "po1", "paid");
      await notif.notifyCommissionReversed(admin, "l-amb-1");
    } catch {
      threw = true;
    }
  });
  check("failure: a throwing push/bell sender never propagates out of any notifier", !threw);

  // Malformed / broken data reads never throw either.
  const broken = { from: () => { throw new Error("db down"); } };
  let threw2 = false;
  await quiet(async () => {
    try {
      await notif.notifySaleConfirmed(broken, "sale1");
      await notif.notifyMilestoneEarned(broken, "sale1", "activation");
      await notif.notifyPayoutStatus(broken, "po1", "paid");
      await notif.notifyCommissionReversed(broken, "l1");
    } catch {
      threw2 = true;
    }
  });
  check("failure: a database error while resolving recipients never propagates either", !threw2);

  // Route level: pay-status confirmation still succeeds + records payment when the notifier's sender blows up.
  const fapshiMod = load("lib/fapshi.ts");
  const notifMod = load("lib/notifications.ts");
  const emailShellMod = load("lib/email/emailShell.ts");
  const emailProviderMod = load("lib/email/provider.ts");
  notifMod.notifyAdmins = async () => {};
  notifMod.notifyUser = async () => {};
  notifMod.getSignupRequestReviewers = async () => ({ adminEmails: [], superCreator: null });
  emailShellMod.emailShell = () => "";
  emailProviderMod.sendEmail = async () => ({ ok: true });
  fapshiMod.fapshiGetStatus = async () => ({ status: "SUCCESSFUL", transId: "tx1", reason: null });
  const serverMod = load("lib/supabase/server.ts");
  const { GET: payStatusGET } = load("app/api/signup-requests/[id]/pay-status/route.ts");

  const payAdmin = makeFakeAdmin(
    { ...seedProgram(), signup_requests: [{ id: "sr1", pending_fapshi_trans_id: "tx1", full_name: "Jane", email: "jane@x.com", referral_code: null, customer_paid: false }] },
    { ambassador_lock_sale: async () => ({ data: { ok: true, sale_id: "sale1" }, error: null }) }
  );
  serverMod.createAdminClient = () => payAdmin;
  senderBehavior = "throw";
  const res = await quiet(() => payStatusGET({}, { params: { id: "sr1" } }));
  const json = await res.json();
  check("failure: payment confirmation still returns SUCCESSFUL and records customer_paid when notifications fail", res.status === 200 && json.status === "SUCCESSFUL" && payAdmin._tables.get("signup_requests").get("sr1").customer_paid === true, JSON.stringify(json));

  // And the happy path really notifies from the route, off the RPC's own sale_id.
  reset();
  const payAdmin2 = makeFakeAdmin(
    { ...seedProgram(), signup_requests: [{ id: "sr1", pending_fapshi_trans_id: "tx1", full_name: "Jane", email: "jane@x.com", referral_code: null, customer_paid: false }] },
    { ambassador_lock_sale: async () => ({ data: { ok: true, sale_id: "sale1" }, error: null }) }
  );
  serverMod.createAdminClient = () => payAdmin2;
  await quiet(() => payStatusGET({}, { params: { id: "sr1" } }));
  check("hook: pay-status notifies the sale's Ambassador and snapshotted Team Leader once", sent.length === 2 && sent.every((s) => s.category === "ambassador_sale_confirmed"), JSON.stringify(sent.map((s) => s.userId)));
  await quiet(() => payStatusGET({}, { params: { id: "sr1" } }));
  check("hook: a repeated poll on the paid request does not notify again", sent.length === 2);

  // Lock reported nothing (already locked / no attribution) -> no notification.
  reset();
  const payAdmin3 = makeFakeAdmin(
    { ...seedProgram(), signup_requests: [{ id: "sr1", pending_fapshi_trans_id: "tx1", full_name: "Jane", email: "jane@x.com", referral_code: null, customer_paid: false }] },
    { ambassador_lock_sale: async () => ({ data: null, error: null }) }
  );
  serverMod.createAdminClient = () => payAdmin3;
  await quiet(() => payStatusGET({}, { params: { id: "sr1" } }));
  check("hook: no notification when the lock function reports no transition (no attribution / already locked)", sent.length === 0);

  // PWA install route -> activation notification, and failure isolation.
  const { POST: pwaPOST } = load("app/api/pwa/install/route.ts");
  const pwaAdmin = makeFakeAdmin(
    { ...seedProgram(), users: [{ id: "uCust", pwa_installed_at: null }] },
    { ambassador_evaluate_milestone_2: async () => ({ data: { ok: true, sale_id: "sale1" }, error: null }) }
  );
  serverMod.createClient = () => ({ auth: { getUser: async () => ({ data: { user: { id: "uCust" } } }) } });
  serverMod.createAdminClient = () => pwaAdmin;
  reset();
  await quiet(() => pwaPOST());
  check("hook: PWA install that completes activation notifies the ledger recipients for that sale", sent.length === 2 && sent.every((s) => s.category === "ambassador_activation_completed") && !sent.some((s) => s.userId === "uCust"));
  senderBehavior = "throw";
  const pwaAdmin2 = makeFakeAdmin(
    { ...seedProgram(), users: [{ id: "uCust", pwa_installed_at: null }] },
    { ambassador_evaluate_milestone_2: async () => ({ data: { ok: true, sale_id: "sale1" }, error: null }) }
  );
  serverMod.createAdminClient = () => pwaAdmin2;
  const pwaRes = await quiet(() => pwaPOST());
  check("failure: PWA install still returns ok when the activation notification fails", pwaRes.status === 200);
  reset();
  const pwaAdmin3 = makeFakeAdmin(
    { ...seedProgram(), users: [{ id: "uCust", pwa_installed_at: null }] },
    { ambassador_evaluate_milestone_2: async () => ({ data: { ok: false, reason: "activation_not_ready" }, error: null }) }
  );
  serverMod.createAdminClient = () => pwaAdmin3;
  await quiet(() => pwaPOST());
  check("hook: PWA install that does NOT complete activation notifies nobody", sent.length === 0);
}

// ================================================================== approve route (milestone 1) hook
{
  const assertAdminMod = load("lib/assertAdmin.ts");
  assertAdminMod.assertCanApproveRequests = async () => ({ id: "admin-1", isAdmin: true, affiliateCode: null });
  assertAdminMod.canReviewerAccessRequest = () => true;
  const affiliateNotifyMod = load("lib/push/notifyAffiliateCommission.ts");
  affiliateNotifyMod.notifyAffiliateCommissionIfAny = async () => {};
  const cardBundleMod = load("lib/cardBundle.ts");
  cardBundleMod.applyCardBundleGrant = async () => {};
  const serverMod = load("lib/supabase/server.ts");
  const { POST: approvePOST } = load("app/api/admin/requests/[id]/approve/route.ts");

  const BODY = { username: "janedoe", email: "jane@x.com", password: "hunter22", fullName: "Jane Doe", whatsappNumber: "+237600000000", planId: "plan-free", billingInterval: "monthly", paymentMethod: "none" };
  const seedApprove = (handlers) =>
    makeFakeAdmin(
      {
        ...seedProgram(),
        signup_requests: [{ id: "sr1", status: "pending", category: null, categories: [], referral_code: null, requested_addon_ids: [], requested_links: [], requested_products: [], requested_social_links: [] }],
        plans: [{ id: "plan-free", name: "Free", price_usd: 0, price_xaf: 0, price_usd_yearly: 0, price_xaf_yearly: 0, bookings_feature_enabled: false }],
        ambassador_sales: [{ id: "sale1", signup_request_id: "sr1", ambassador_id: "amb1", team_id: "team-old", status: "locked" }],
        profiles: [],
      },
      handlers
    );
  const approve = (admin) => {
    serverMod.createAdminClient = () => admin;
    return quiet(() => approvePOST({ json: async () => BODY }, { params: { id: "sr1" } }));
  };

  reset();
  const ok = seedApprove({ ambassador_evaluate_milestone_1: async () => ({ data: { ok: true, sale_id: "sale1" }, error: null }) });
  const res = await approve(ok);
  const json = await res.json();
  check("hook: approval succeeds and notifies the Ambassador + snapshotted Team Leader about registration/commission", res.status === 200 && json.ok === true && sent.length === 2 && sent.every((s) => s.category === "ambassador_registration_completed") && sent.some((s) => s.userId === "uOld"), JSON.stringify(sent.map((s) => s.userId)));

  reset();
  const notReady = seedApprove({ ambassador_evaluate_milestone_1: async () => ({ data: { ok: false, reason: "sale_not_locked" }, error: null }) });
  await approve(notReady);
  check("hook: no notification when milestone 1 was not actually earned (sale_not_locked)", sent.length === 0);

  reset();
  senderBehavior = "throw";
  const boom = seedApprove({ ambassador_evaluate_milestone_1: async () => ({ data: { ok: true, sale_id: "sale1" }, error: null }) });
  const res2 = await approve(boom);
  const json2 = await res2.json();
  check("failure: a failing notification never rolls back the approval or the account", res2.status === 200 && json2.ok === true && boom._tables.get("signup_requests").get("sr1").status === "approved", JSON.stringify(json2));
  reset();
}

// ================================================================== existing notifications unchanged
{
  const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8");
  const approve = read("src/app/api/admin/requests/[id]/approve/route.ts");
  const payStatus = read("src/app/api/signup-requests/[id]/pay-status/route.ts");
  check("existing: approve route still calls notifyAffiliateCommissionIfAny, notifyUser and sendPushAndBellToAdmins", /notifyAffiliateCommissionIfAny\(/.test(approve) && /notifyUser\(/.test(approve) && /sendPushAndBellToAdmins\(/.test(approve));
  check("existing: pay-status route still calls notifyAdmins and notifyUser", /notifyAdmins\(/.test(payStatus) && /notifyUser\(/.test(payStatus));
  const withBellSrc = read("src/lib/push/withBell.ts");
  const catSrc = read("src/lib/notificationCategories.ts");
  check("existing: withBell.ts and notificationCategories.ts were not modified by this phase", /export async function sendPushAndBellToUser/.test(withBellSrc) && !/ambassador/i.test(catSrc) && !/ambassador/i.test(withBellSrc));
  check("existing: customerPush / loyalty notification copy still present", !!translations.en.customerPush.protectionReleased && !!translations.fr.customerPush.protectionReleased);
  const notifSrc = read("src/lib/ambassador/notifications.ts").replace(/^\s*\/\/.*$/gm, "");
  check("existing: the notifier reuses sendPushAndBellToUser and defines no second notification system", /sendPushAndBellToUser\(/.test(notifSrc) && !/web-push|webpush|push_subscriptions|\.from\("notifications"\)\s*\.insert/.test(notifSrc));
  // Phase G itself added no migration. The three later, separately approved hardening migrations (min payout setting,
  // private destinations, financial hardening) bring the total to nine — they are asserted in ambassadorHardening.test.mjs.
  check("no schema change in Phase G: the six original migrations are still present, and any later ones are the approved later hardening migrations", (() => { const f = fs.readdirSync(path.join(REPO, "supabase/migrations")).filter((x) => /ambassador/.test(x)); return f.length >= 6 && f.every((x) => /2026-11-(18|19|20|21|22|23|24|25|26|27|28)_/.test(x)); })());
}

const failed = results.filter((x) => !x.pass);
console.log(`\nambassadorPhaseG: ${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
