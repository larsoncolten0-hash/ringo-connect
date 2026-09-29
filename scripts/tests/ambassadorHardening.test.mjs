// Ambassador Program — final financial / privacy / notification hardening.
// No network, no real database, no real Fapshi. IMPORTANT LIMIT: the SQL in the
// three new migrations has NOT been executed anywhere. The state-machine
// functions below are JavaScript stand-ins written to the migrations' documented
// contract, so these tests prove the APPLICATION layer behaves correctly against
// that contract (and the static checks prove the SQL text contains the required
// protections) — they do not prove the SQL itself; that needs live verification.
//
//   Run:  node scripts/tests/ambassadorHardening.test.mjs
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
const capture = async (fn) => {
  const o = console.error;
  const lines = [];
  console.error = (...a) => lines.push(a.map(String).join(" "));
  try {
    return { value: await fn(), lines };
  } finally {
    console.error = o;
  }
};

// ------------------------------------------------------------------ fake admin client
function makeFakeAdmin(seed = {}, handlers = {}) {
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
      range: () => b,
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
    _now: Date.parse("2026-06-01T12:00:00Z"),
    from,
    rpc: async (name, args) => {
      calls.rpc.push({ name, args });
      if (handlers[name]) return handlers[name](args, admin);
      return { data: { ok: true }, error: null };
    },
  };
  return admin;
}

// ------------------------------------------------------------------ stand-ins for the SQL functions (contract of 2026-11-25/26)
const ok = (o = {}) => ({ data: { ok: true, ...o }, error: null });
const no = (reason, o = {}) => ({ data: { ok: false, reason, ...o }, error: null });
const ACTIVE_PAYOUT = ["requested", "processing", "reconciliation_required"];

function stateMachine({ admins }) {
  const P = (a) => a._tables.get("ambassador_payouts");
  const Lg = (a) => a._tables.get("ambassador_commission_ledger");
  const isAdmin = (x) => x != null && admins.has(x);
  const linked = (a, id) => Array.from(Lg(a).values()).filter((r) => r.payout_id === id);
  const ledgerOk = (a, p) => {
    const rows = linked(a, p.id);
    const sum = rows.reduce((t, r) => t + Number(r.commission_amount), 0);
    return rows.length > 0 && rows.every((r) => r.status === "eligible_for_payout" && r.entry_type === "commission") && sum === Number(p.amount);
  };
  return {
    ambassador_claim_payout: async ({ p_payout_id, p_actor_user_id }, a) => {
      if (!isAdmin(p_actor_user_id)) return no("not_authorized");
      const p = P(a).get(p_payout_id);
      if (!p) return no("not_found");
      if (p.status !== "requested") return no("not_claimable", { status: p.status });
      if (!ledgerOk(a, p)) return no("ledger_mismatch");
      const attempt = (p.disbursement_attempts || 0) + 1;
      Object.assign(p, { status: "processing", claimed_at: new Date(a._now).toISOString(), disbursement_attempts: attempt, disbursement_key: `ambassador-payout-${p.id}-${attempt}`, uncertain_since: null });
      return ok({ disbursement_key: p.disbursement_key, attempt });
    },
    ambassador_record_disbursement_accepted: async ({ p_payout_id, p_fapshi_trans_id, p_actor_user_id }, a) => {
      if (!isAdmin(p_actor_user_id)) return no("not_authorized");
      if (!p_fapshi_trans_id) return no("invalid_transaction_id");
      const p = P(a).get(p_payout_id);
      if (!p) return no("not_found");
      if (!["processing", "reconciliation_required"].includes(p.status) || p.fapshi_trans_id) return no("not_recordable");
      if (Array.from(P(a).values()).some((x) => x.fapshi_trans_id === p_fapshi_trans_id)) return no("transaction_id_in_use");
      p.fapshi_trans_id = p_fapshi_trans_id;
      return ok();
    },
    ambassador_release_payout_claim: async ({ p_payout_id, p_actor_user_id, p_reason }, a) => {
      if (!isAdmin(p_actor_user_id)) return no("not_authorized");
      const p = P(a).get(p_payout_id);
      if (!p) return no("not_found");
      if (p.status !== "processing" || p.fapshi_trans_id) return no("not_releasable");
      Object.assign(p, { status: "requested", claimed_at: null, admin_note: p_reason });
      return ok();
    },
    ambassador_fail_disbursement: async ({ p_payout_id, p_actor_user_id, p_reason }, a) => {
      if (p_actor_user_id != null && !isAdmin(p_actor_user_id)) return no("not_authorized");
      const p = P(a).get(p_payout_id);
      if (!p) return no("not_found");
      if (!["processing", "reconciliation_required"].includes(p.status) || !p.fapshi_trans_id) return no("not_failable");
      Object.assign(p, { status: "requested", fapshi_trans_id: null, claimed_at: null, uncertain_since: null, admin_note: p_reason });
      return ok();
    },
    ambassador_mark_payout_uncertain: async ({ p_payout_id, p_actor_user_id, p_reason }, a) => {
      if (p_actor_user_id != null && !isAdmin(p_actor_user_id)) return no("not_authorized");
      const p = P(a).get(p_payout_id);
      if (!p) return no("not_found");
      if (p.status !== "processing") return no("not_markable");
      Object.assign(p, { status: "reconciliation_required", uncertain_since: new Date(a._now).toISOString(), admin_note: p_reason });
      return ok();
    },
    ambassador_process_payout: async ({ p_payout_id, p_fapshi_trans_id, p_actor_user_id }, a) => {
      const p = P(a).get(p_payout_id);
      if (!p) return no("not_found");
      if (!isAdmin(p_actor_user_id) && !(p_actor_user_id == null && p_fapshi_trans_id != null && p.fapshi_trans_id === p_fapshi_trans_id)) return no("not_authorized");
      if (p.status === "paid") return no("already_paid");
      if (!["processing", "reconciliation_required"].includes(p.status)) return no("not_processable");
      if (p_fapshi_trans_id && p.fapshi_trans_id && p.fapshi_trans_id !== p_fapshi_trans_id) return no("transaction_mismatch");
      if (p.status === "reconciliation_required" && !(p.fapshi_trans_id || p_fapshi_trans_id)) return no("transaction_id_required");
      if (!ledgerOk(a, p)) return no("ledger_mismatch");
      for (const r of linked(a, p.id)) Object.assign(r, { status: "paid", paid_at: new Date(a._now).toISOString() });
      Object.assign(p, { status: "paid", fapshi_trans_id: p.fapshi_trans_id || p_fapshi_trans_id || null, processed_by: p_actor_user_id });
      return ok({ payout_id: p.id });
    },
    ambassador_resolve_uncertain_payout: async ({ p_payout_id, p_actor_user_id, p_outcome, p_fapshi_trans_id, p_note }, a) => {
      if (!isAdmin(p_actor_user_id)) return no("not_authorized");
      if (!["sent", "not_sent"].includes(p_outcome) || !p_note || p_note.trim().length < 3) return no("invalid_input");
      const p = P(a).get(p_payout_id);
      if (!p) return no("not_found");
      if (p.status !== "reconciliation_required") return no("not_reconcilable");
      if (p_outcome === "not_sent") {
        if (p.fapshi_trans_id) return no("has_transaction");
        Object.assign(p, { status: "requested", claimed_at: null, uncertain_since: null, admin_note: p_note });
        return ok({ outcome: "not_sent" });
      }
      const id = p_fapshi_trans_id || p.fapshi_trans_id;
      if (!id) return no("transaction_id_required");
      const r = await stateMachine({ admins }).ambassador_process_payout({ p_payout_id, p_fapshi_trans_id: id, p_actor_user_id }, a);
      return r.data.ok ? ok({ outcome: "sent" }) : r;
    },
    ambassador_reject_payout: async ({ p_payout_id, p_actor_user_id, p_reason }, a) => {
      if (!isAdmin(p_actor_user_id)) return no("not_authorized");
      if (!p_reason || p_reason.trim().length < 3) return no("invalid_input");
      const p = P(a).get(p_payout_id);
      if (!p) return no("not_found");
      if (p.status !== "requested" || p.fapshi_trans_id) return no("not_rejectable");
      for (const r of linked(a, p.id)) if (r.status === "eligible_for_payout") r.payout_id = null;
      Object.assign(p, { status: "rejected", admin_note: p_reason });
      return ok();
    },
    ambassador_reverse_commission: async ({ p_ledger_id, p_actor_user_id, p_reason }, a) => {
      if (!isAdmin(p_actor_user_id)) return no("not_authorized");
      if (!p_reason || p_reason.trim().length < 3) return no("invalid_reason");
      const row = Lg(a).get(p_ledger_id);
      if (!row || row.entry_type !== "commission") return no("not_found");
      const existing = Array.from(Lg(a).values()).find((r) => r.reversed_ledger_id === p_ledger_id && r.entry_type === "reversal");
      if (existing) return ok({ already_reversed: true, recovery_ledger_id: existing.id });
      if (["reversed", "cancelled"].includes(row.status)) return no("already_reversed");
      if (row.status !== "paid" && row.payout_id) return no("payout_in_progress");
      if (row.status === "paid") {
        const rec = { id: `rec-${row.id}`, sale_id: row.sale_id, recipient_type: row.recipient_type, recipient_user_id: row.recipient_user_id, entry_type: "reversal", status: "reversed", commission_amount: -Number(row.commission_amount), reversed_ledger_id: row.id, currency: row.currency };
        Lg(a).set(rec.id, rec);
        return ok({ ledger_id: row.id, recovery_ledger_id: rec.id });
      }
      Object.assign(row, { status: "reversed" });
      return ok({ ledger_id: row.id, recovery_ledger_id: null });
    },
    // 2026-11-25 / 2026-11-26 destination + request functions
    ambassador_set_payout_destination: async ({ p_user_id, p_recipient_type, p_method, p_details }, a) => {
      const D = a._tables.get("ambassador_payout_destinations");
      const isRecipient = p_recipient_type === "ambassador" ? Array.from(a._tables.get("ambassador_profiles").values()).some((x) => x.user_id === p_user_id && x.status !== "suspended") : Array.from(a._tables.get("ambassador_teams").values()).some((x) => x.team_leader_user_id === p_user_id);
      if (!isRecipient) return no("not_a_recipient");
      const masked = p_method === "mobile_money" ? `${String(p_details.provider).toUpperCase()} ••• ${String(p_details.phone).slice(-3)}` : `${p_details.bankName} ••• ${String(p_details.accountNumber).slice(-3)}`;
      const ex = Array.from(D.values()).find((d) => d.user_id === p_user_id && d.recipient_type === p_recipient_type);
      const now = new Date(a._now).toISOString();
      if (!ex) {
        D.set(`d${D.size + 1}`, { id: `d${D.size + 1}`, user_id: p_user_id, recipient_type: p_recipient_type, method: p_method, details: p_details, masked_label: masked, usable_after: now });
        return ok({ changed: true, first_time: true, masked, usable_after: now });
      }
      if (ex.method === p_method && JSON.stringify(ex.details) === JSON.stringify(p_details)) return ok({ changed: false, first_time: false, masked: ex.masked_label, usable_after: ex.usable_after });
      const usable = new Date(a._now + 24 * 3600 * 1000).toISOString();
      Object.assign(ex, { method: p_method, details: p_details, masked_label: masked, usable_after: usable });
      return ok({ changed: true, first_time: false, masked, usable_after: usable });
    },
    ambassador_request_payout: async ({ p_recipient_type, p_recipient_user_id }, a) => {
      const D = Array.from(a._tables.get("ambassador_payout_destinations").values()).find((d) => d.user_id === p_recipient_user_id && d.recipient_type === p_recipient_type);
      if (!D) return no("no_destination");
      if (Date.parse(D.usable_after) > a._now) return no("destination_cooling_down", { usable_after: D.usable_after });
      const rows = Array.from(Lg(a).values()).filter((r) => r.recipient_user_id === p_recipient_user_id && r.recipient_type === p_recipient_type && r.status === "eligible_for_payout" && r.entry_type === "commission" && !r.payout_id && r.currency === "XAF");
      const total = rows.reduce((t, r) => t + Number(r.commission_amount), 0);
      if (total <= 0) return no("nothing_eligible");
      const setting = Array.from(a._tables.get("platform_settings").values())[0];
      if (!setting) return no("settings_unavailable");
      if (total < Number(setting.ambassador_min_payout_xaf)) return no("below_minimum", { minimum: setting.ambassador_min_payout_xaf, available: total });
      const id = `po${P(a).size + 1}`;
      P(a).set(id, { id, recipient_type: p_recipient_type, recipient_user_id: p_recipient_user_id, amount: total, currency: "XAF", status: "requested", payout_method: D.method, payout_details: D.details, fapshi_trans_id: null, disbursement_attempts: 0 });
      for (const r of rows) r.payout_id = id;
      return ok({ payout_id: id, amount: total });
    },
  };
}

// ------------------------------------------------------------------ mocks
const withBell = load("lib/push/withBell.ts");
let sent = [];
let adminSent = [];
withBell.sendPushAndBellToUser = async (admin, userId, payload) => {
  sent.push({ userId, ...payload });
  await admin.from("notifications").insert({ audience: "user", user_id: userId, type: payload.category, link: payload.url });
};
withBell.sendPushAndBellToAdmins = async (_a, payload) => void adminSent.push(payload);
const fapshi = load("lib/fapshi.ts");
let payoutCalls = [];
let payoutImpl = async () => ({ transId: "TX-1" });
let statusImpl = async () => ({ status: "SUCCESSFUL" });
fapshi.fapshiPayout = async (p) => (payoutCalls.push(p), payoutImpl(p));
fapshi.fapshiGetStatus = async (id, o) => statusImpl(id, o);
const httpError = (status, message = "err") => Object.assign(new Error(message), { httpStatus: status });
const reset = () => {
  sent = [];
  adminSent = [];
  payoutCalls = [];
  payoutImpl = async () => ({ transId: "TX-1" });
  statusImpl = async () => ({ status: "SUCCESSFUL" });
};

const adminLib = load("lib/ambassador/adminPayouts.ts");
const userLib = load("lib/ambassador/payouts.ts");
const limits = load("lib/ambassador/fapshiLimits.ts");
const settings = load("lib/ambassador/settings.ts");
const { reconcileAmbassadorLifecycle } = load("lib/ambassador/reconcile.ts");
const { translations } = load("lib/i18n/translations.ts");

const U = { amb: "00000000-0000-4000-8000-0000000000a1", tl: "00000000-0000-4000-8000-0000000000b1", other: "00000000-0000-4000-8000-0000000000c1", admin: "00000000-0000-4000-8000-0000000000ad" };
const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const lid = (n) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const MOMO = { provider: "mtn", phone: "677123456" };
const BANK = { accountName: "A B", accountNumber: "0012345678", bankName: "Some Bank" };
const SECRET_PHONE = "677123456";

/** A world with one requested payout of `amount`, backed by matching eligible ledger rows. */
function world({ payouts = [{ n: 1, amount: 7500 }], extra = {}, admins = [U.admin] } = {}) {
  const ledger = [];
  const ps = [];
  for (const { n, amount, status = "requested", trans = null, over = {} } of payouts) {
    ps.push({ id: id(n), recipient_type: "ambassador", recipient_user_id: U.amb, amount, currency: "XAF", status, payout_method: "mobile_money", payout_details: MOMO, fapshi_trans_id: trans, disbursement_attempts: 0, requested_at: "2026-01-02", ...over });
    ledger.push({ id: lid(n), sale_id: `s${n}`, recipient_type: "ambassador", recipient_user_id: U.amb, entry_type: "commission", status: status === "paid" ? "paid" : "eligible_for_payout", commission_amount: amount, currency: "XAF", payout_id: id(n) });
  }
  return makeFakeAdmin({ ambassador_payouts: ps, ambassador_commission_ledger: ledger, ambassador_profiles: [{ id: "amb1", user_id: U.amb, status: "active" }], ambassador_teams: [{ id: "t1", team_leader_user_id: U.tl }], ambassador_payout_destinations: [], platform_settings: [{ id: "ps1", ambassador_min_payout_xaf: 500 }], profiles: [{ id: "p1", user_id: U.amb, is_demo: false }, { id: "p2", user_id: U.tl, is_demo: false }], ...extra }, stateMachine({ admins: new Set(admins) }));
}
const payout = (a, n = 1) => a._tables.get("ambassador_payouts").get(id(n));
const ledgerRow = (a, n = 1) => a._tables.get("ambassador_commission_ledger").get(lid(n));

// ================================================================== classification (definitive / not sent / uncertain)
{
  const k = (e) => limits.classifyFapshiPayoutError(e).kind;
  check("classify: 400/401/402/403/404/422 are definitive rejections", [400, 401, 402, 403, 404, 422].every((s) => k(httpError(s)) === "definitive"));
  check("classify: 5xx, 408, 409 and 429 are UNCERTAIN, never assumed not-processed", [500, 502, 503, 504, 408, 409, 429, 418].every((s) => k(httpError(s)) === "uncertain"));
  check("classify: network failure, unreadable response and timeouts are uncertain", k(new TypeError("fetch failed")) === "uncertain" && k(new SyntaxError("bad json")) === "uncertain" && k(Object.assign(new Error("t"), { name: "AbortError" })) === "uncertain" && k(Object.assign(new Error("t"), { name: "TimeoutError" })) === "uncertain");
  check("classify: an error thrown before any HTTP request (Fapshi disabled/not configured) is not_sent", k(new Error("Fapshi payments are currently disabled by the platform admin.")) === "not_sent");
  const src = strip(read("src/lib/fapshi.ts"));
  check("classify: fapshiPayout attaches the HTTP status to its error and no longer loses it to a JSON parse failure", /httpStatus:\s*res\.status/.test(src) && /parseError/.test(src));
}

// ================================================================== send: success, claim, keys
{
  reset();
  const a = world();
  const r = await adminLib.sendPayoutViaFapshi(a, U.admin, id(1));
  check("send: succeeds; payout is processing with the transaction id recorded", r.ok && payout(a).status === "processing" && payout(a).fapshi_trans_id === "TX-1");
  check("send: the Fapshi external id is the per-attempt disbursement key issued by the database", payoutCalls.length === 1 && payoutCalls[0].externalId === `ambassador-payout-${id(1)}-1`, JSON.stringify(payoutCalls[0]));
  check("send: amount/phone/recipient come from the payout ROW, not the caller", payoutCalls[0].amount === 7500 && payoutCalls[0].phone === SECRET_PHONE && payoutCalls[0].userId === U.amb);
  check("send: ledger rows stay linked and unpaid until Fapshi confirms", ledgerRow(a).status === "eligible_for_payout" && ledgerRow(a).payout_id === id(1));
  check("send: audited (transaction id kept in the audit trail) and the recipient told it is processing", a._calls.rpc.some((c) => c.name === "ambassador_log_action" && c.args.p_action === "payout_sent_fapshi" && c.args.p_after.fapshi_trans_id === "TX-1") && sent.some((s) => s.category === "ambassador_payout_processing"));
  const again = await adminLib.sendPayoutViaFapshi(a, U.admin, id(1));
  check("send: a second send is refused by the claim and never reaches Fapshi", !again.ok && again.code === "not_claimable" && payoutCalls.length === 1);
}
{
  reset();
  let release;
  const gate = new Promise((res) => (release = res));
  payoutImpl = async () => (await gate, { transId: "TX-ONE" });
  const a = world();
  const runs = [1, 2, 3, 4].map(() => adminLib.sendPayoutViaFapshi(a, U.admin, id(1)));
  await new Promise((res) => setTimeout(res, 20));
  release();
  const outs = await Promise.all(runs);
  check("concurrency: four simultaneous sends cause exactly ONE Fapshi disbursement", payoutCalls.length === 1 && outs.filter((o) => o.ok).length === 1, `calls=${payoutCalls.length}`);
}
{
  reset();
  const a = world({ extra: {} });
  ledgerRow(a).commission_amount = 7000; // linked rows no longer add up to the payout amount
  const r = await adminLib.sendPayoutViaFapshi(a, U.admin, id(1));
  check("send: linked ledger rows that no longer match the payout amount block the claim — Fapshi is never called", !r.ok && r.code === "ledger_mismatch" && payoutCalls.length === 0 && payout(a).status === "requested");
  const notAdmin = await adminLib.sendPayoutViaFapshi(world(), "00000000-0000-4000-8000-00000000dead", id(1));
  check("send: a non-admin actor is refused inside the database function", !notAdmin.ok && notAdmin.code === "not_authorized" && payoutCalls.length === 0);
}

// ================================================================== send: outcomes
{
  // definitive / not-sent -> released, retryable, next attempt gets a NEW key
  for (const [label, err] of [["400", httpError(400)], ["402 insufficient balance", httpError(402)], ["403", httpError(403)], ["not configured", new Error("Fapshi disbursement is not configured yet")]]) {
    reset();
    const a = world();
    payoutImpl = async () => {
      throw err;
    };
    const r = await capture(() => adminLib.sendPayoutViaFapshi(a, U.admin, id(1)));
    check(`outcome ${label}: released to requested (retryable), rows still linked, not uncertain`, !r.value.ok && r.value.code === "fapshi_rejected" && payout(a).status === "requested" && payout(a).fapshi_trans_id == null && ledgerRow(a).payout_id === id(1));
  }
  reset();
  const a = world();
  payoutImpl = async () => {
    throw httpError(400);
  };
  await capture(() => adminLib.sendPayoutViaFapshi(a, U.admin, id(1)));
  payoutImpl = async () => ({ transId: "TX-RETRY" });
  const retry = await adminLib.sendPayoutViaFapshi(a, U.admin, id(1));
  check("outcome: after a definitive rejection a deliberate retry works and uses a NEW disbursement key", retry.ok && payoutCalls[1].externalId === `ambassador-payout-${id(1)}-2`);
}
{
  const uncertain = [
    ["HTTP 500", () => httpError(500)],
    ["HTTP 502", () => httpError(502)],
    ["HTTP 504", () => httpError(504)],
    ["HTTP 429", () => httpError(429)],
    ["HTTP 408", () => httpError(408)],
    ["HTTP 409 (possible duplicate)", () => httpError(409)],
    ["network drop", () => new TypeError("fetch failed")],
    ["unreadable response", () => new SyntaxError("Unexpected token <")],
    ["timeout", () => Object.assign(new Error("timeout"), { name: "TimeoutError" })],
  ];
  let allHeld = true;
  for (const [label, mk] of uncertain) {
    reset();
    const a = world();
    payoutImpl = async () => {
      throw mk();
    };
    const r = await capture(() => adminLib.sendPayoutViaFapshi(a, U.admin, id(1)));
    const held = !r.value.ok && r.value.code === "fapshi_ambiguous" && payout(a).status === "reconciliation_required" && ledgerRow(a).payout_id === id(1) && ledgerRow(a).status === "eligible_for_payout" && !sent.length;
    if (!held) {
      allHeld = false;
      console.log("  uncertain case not held:", label, JSON.stringify(r.value), payout(a).status);
    }
  }
  check("uncertain: EVERY uncertain outcome (5xx, 408, 409, 429, network, unreadable, timeout) holds the payout in reconciliation_required with its rows still linked and nobody notified", allHeld);

  reset();
  const a = world();
  payoutImpl = async () => {
    throw httpError(504);
  };
  await capture(() => adminLib.sendPayoutViaFapshi(a, U.admin, id(1)));
  payoutImpl = async () => ({ transId: "SHOULD-NEVER" });
  const resend = await adminLib.sendPayoutViaFapshi(a, U.admin, id(1));
  const manual = await adminLib.markPayoutPaidManually(a, U.admin, id(1), "paid by hand");
  const reject = await adminLib.rejectPayout(a, U.admin, id(1), "declined");
  check("uncertain: it can NOT be re-sent, manually marked paid, or rejected (which would free its rows)", !resend.ok && !manual.ok && !reject.ok && payoutCalls.length === 1 && payout(a).status === "reconciliation_required" && ledgerRow(a).payout_id === id(1));
  const req = await userLib.requestMyPayout(makeFakeAdmin({}, stateMachine({ admins: new Set() })), U.amb, { role: "ambassador" });
  check("uncertain: its rows stay attached to the payout, so they never re-enter the ordinary eligible balance", ledgerRow(a).payout_id === id(1) && !req.ok);

  reset();
  const b = world();
  payoutImpl = async () => ({});
  const noId = await capture(() => adminLib.sendPayoutViaFapshi(b, U.admin, id(1)));
  check("uncertain: Fapshi accepting without returning a transaction id is held, not released", noId.value.code === "fapshi_ambiguous" && payout(b).status === "reconciliation_required");

  reset();
  const c = world();
  const realRpc = c.rpc;
  c.rpc = async (name, args) => (name === "ambassador_record_disbursement_accepted" ? { data: null, error: { message: "connection reset" } } : realRpc(name, args));
  const notRec = await capture(() => adminLib.sendPayoutViaFapshi(c, U.admin, id(1)));
  check("uncertain: money moved but the id could not be recorded -> held, with the transaction id preserved in the audit trail", notRec.value.code === "fapshi_ambiguous" && payout(c).status === "reconciliation_required" && c._calls.rpc.some((x) => x.name === "ambassador_log_action" && x.args.p_after?.fapshi_trans_id === "TX-1"));
}
{
  reset();
  const cases = [
    ["non-XAF", { over: { currency: "USD" } }, "wrong_currency"],
    ["bank", { over: { payout_method: "bank" } }, "wrong_method"],
    ["no phone", { over: { payout_details: { provider: "mtn" } } }, "bad_destination"],
    ["fractional", { amount: 7500.5 }, "non_integer_amount"],
    ["tiny", { amount: 50 }, "amount_too_small"],
    ["paid", { status: "paid" }, "not_claimable"],
  ];
  let allRefused = true;
  for (const [name, spec, code] of cases) {
    const a = world({ payouts: [{ n: 1, amount: spec.amount ?? 7500, status: spec.status, over: spec.over }] });
    const r = await adminLib.sendPayoutViaFapshi(a, U.admin, id(1));
    if (r.ok || r.code !== code || payoutCalls.length) {
      allRefused = false;
      console.log("  refusal failed:", name, JSON.stringify(r));
    }
  }
  check("send: wrong currency/method/destination, fractional or tiny amounts and already-paid payouts are refused before any Fapshi call", allRefused);
}

// ================================================================== check / reconcile a known transaction
{
  reset();
  const a = world({ payouts: [{ n: 1, amount: 7500, status: "processing", trans: "TX-9" }] });
  const r = await adminLib.checkPayoutFapshi(a, U.admin, id(1));
  check("check: SUCCESSFUL finalizes: payout and ALL linked ledger rows become paid, recipient told once", r.ok && payout(a).status === "paid" && ledgerRow(a).status === "paid" && ledgerRow(a).paid_at && sent.filter((s) => s.category === "ambassador_payout_paid").length === 1);
  const again = await adminLib.checkPayoutFapshi(a, U.admin, id(1));
  check("check: repeating it after payment is refused and notifies nobody again", !again.ok && sent.filter((s) => s.category === "ambassador_payout_paid").length === 1);
  const direct = await a.rpc("ambassador_process_payout", { p_payout_id: id(1), p_fapshi_trans_id: "TX-9", p_actor_user_id: U.admin });
  check("check: processing an already-paid payout never returns ok:true", direct.data.ok === false && direct.data.reason === "already_paid");
}
{
  reset();
  const a = world({ payouts: [{ n: 1, amount: 7500, status: "reconciliation_required", trans: "TX-9" }] });
  const r = await adminLib.checkPayoutFapshi(a, null, id(1));
  check("check: the SYSTEM (null actor) can finalize an uncertain payout only because Fapshi confirmed its known transaction", r.ok && payout(a).status === "paid" && ledgerRow(a).status === "paid");
  const b = world({ payouts: [{ n: 1, amount: 7500, status: "processing", trans: "TX-9" }] });
  const spoof = await b.rpc("ambassador_process_payout", { p_payout_id: id(1), p_fapshi_trans_id: "OTHER", p_actor_user_id: null });
  const noTrans = await b.rpc("ambassador_process_payout", { p_payout_id: id(1), p_fapshi_trans_id: null, p_actor_user_id: null });
  check("check: a null actor with a wrong or missing transaction id is refused", spoof.data.ok === false && noTrans.data.ok === false && payout(b).status === "processing");
}
{
  reset();
  statusImpl = async () => ({ status: "FAILED", reason: "wrong number" });
  const a = world({ payouts: [{ n: 1, amount: 7500, status: "reconciliation_required", trans: "TX-9" }] });
  const r = await adminLib.checkPayoutFapshi(a, U.admin, id(1));
  check("check: Fapshi's own FAILED for the known transaction returns the SAME payout to requested with the transaction cleared", r.ok && payout(a).status === "requested" && payout(a).fapshi_trans_id == null && ledgerRow(a).payout_id === id(1));
  check("check: the failure is audited and the recipient told", sent.some((s) => s.category === "ambassador_payout_failed"));

  reset();
  statusImpl = async () => ({ status: "CREATED" });
  const b = world({ payouts: [{ n: 1, amount: 7500, status: "processing", trans: "TX-9" }] });
  const pend = await adminLib.checkPayoutFapshi(b, U.admin, id(1));
  check("check: still pending -> nothing changes", pend.ok && payout(b).status === "processing" && !sent.length);

  statusImpl = async () => {
    throw new Error("Fapshi down");
  };
  const c = world({ payouts: [{ n: 1, amount: 7500, status: "reconciliation_required", trans: "TX-9" }] });
  const down = await capture(() => adminLib.checkPayoutFapshi(c, U.admin, id(1)));
  check("check: a failed STATUS CHECK proves nothing — the payout is left exactly as it was", !down.value.ok && payout(c).status === "reconciliation_required");

  const d = world({ payouts: [{ n: 1, amount: 7500, status: "processing", trans: null }] });
  check("check: a payout with no transaction id cannot be checked (nothing to look up)", (await adminLib.checkPayoutFapshi(d, U.admin, id(1))).code === "not_in_flight");
}

// ================================================================== admin resolution of an uncertain payout
{
  reset();
  const held = () => world({ payouts: [{ n: 1, amount: 7500, status: "reconciliation_required", trans: null }] });
  const a = held();
  const noNote = await adminLib.resolveUncertainPayout(a, U.admin, id(1), { outcome: "not_sent", note: " " });
  const badOutcome = await adminLib.resolveUncertainPayout(a, U.admin, id(1), { outcome: "maybe", note: "checked" });
  check("resolve: an explicit outcome and a note are required", noNote.code === "invalid_input" && badOutcome.code === "invalid_input" && !a._calls.rpc.length);
  const sentNoId = await adminLib.resolveUncertainPayout(a, U.admin, id(1), { outcome: "sent", note: "saw it in dashboard" });
  check("resolve: 'sent' without the Fapshi transaction id is refused", sentNoId.code === "transaction_id_required" && payout(a).status === "reconciliation_required");
  const notAdmin = await adminLib.resolveUncertainPayout(a, "00000000-0000-4000-8000-00000000dead", id(1), { outcome: "not_sent", note: "checked" });
  check("resolve: a non-admin is refused by the database", notAdmin.code === "not_authorized");
  const sentOk = await adminLib.resolveUncertainPayout(a, U.admin, id(1), { outcome: "sent", note: "confirmed in Fapshi", fapshiTransId: "TX-MANUAL" });
  check("resolve: 'sent' with the transaction id pays the payout and its rows, and tells the recipient", sentOk.ok && payout(a).status === "paid" && payout(a).fapshi_trans_id === "TX-MANUAL" && ledgerRow(a).status === "paid" && sent.some((s) => s.category === "ambassador_payout_paid"));

  const b = held();
  const nsOk = await adminLib.resolveUncertainPayout(b, U.admin, id(1), { outcome: "not_sent", note: "Fapshi shows no transaction" });
  check("resolve: 'not_sent' returns it to requested for a deliberate retry, rows still linked, no notification", nsOk.ok && payout(b).status === "requested" && ledgerRow(b).payout_id === id(1));
  const c = world({ payouts: [{ n: 1, amount: 7500, status: "reconciliation_required", trans: "TX-9" }] });
  const hasTx = await adminLib.resolveUncertainPayout(c, U.admin, id(1), { outcome: "not_sent", note: "checked" });
  check("resolve: 'not_sent' is refused when a transaction id exists (only Fapshi's own FAILED may clear it)", hasTx.code === "not_resolvable" && payout(c).status === "reconciliation_required");
  const d = world();
  check("resolve: only a reconciliation_required payout can be resolved", (await adminLib.resolveUncertainPayout(d, U.admin, id(1), { outcome: "not_sent", note: "checked" })).code === "not_resolvable");
}

// ================================================================== reject + manual
{
  reset();
  const a = world();
  const r = await adminLib.rejectPayout(a, U.admin, id(1), "wrong details");
  check("reject: payout becomes rejected and its commissions return to the ordinary eligible balance", r.ok && payout(a).status === "rejected" && ledgerRow(a).payout_id == null && ledgerRow(a).status === "eligible_for_payout");
  check("reject: recipient notified once, under its own category", sent.filter((s) => s.category === "ambassador_payout_rejected").length === 1);
  check("reject: a reason is required", (await adminLib.rejectPayout(world(), U.admin, id(1), "")).code === "invalid_input");
  const b = world({ payouts: [{ n: 1, amount: 7500, status: "processing", trans: "TX" }] });
  check("reject: a payout already in flight cannot be rejected", (await adminLib.rejectPayout(b, U.admin, id(1), "no")).code !== undefined && payout(b).status === "processing");
}
{
  reset();
  const a = world();
  check("manual: a payment reference is required", (await adminLib.markPayoutPaidManually(a, U.admin, id(1), " ")).code === "invalid_input");
  const r = await adminLib.markPayoutPaidManually(a, U.admin, id(1), "Bank ref 4471");
  check("manual: claims then settles through the database; payout and rows paid; audited with the note; recipient told", r.ok && payout(a).status === "paid" && ledgerRow(a).status === "paid" && a._calls.rpc.some((c) => c.name === "ambassador_log_action" && c.args.p_reason === "Bank ref 4471") && sent.some((s) => s.category === "ambassador_payout_paid"));
  check("manual: a second manual mark-paid is refused", (await adminLib.markPayoutPaidManually(a, U.admin, id(1), "again")).code === "not_claimable");
  const b = world();
  const realRpc = b.rpc;
  b.rpc = async (n, args) => (n === "ambassador_process_payout" ? { data: null, error: { message: "boom" } } : realRpc(n, args));
  const failed = await capture(() => adminLib.markPayoutPaidManually(b, U.admin, id(1), "ref abc"));
  check("manual: if settlement fails the claim is handed back — nothing paid, payout retryable", !failed.value.ok && payout(b).status === "requested" && ledgerRow(b).status === "eligible_for_payout");
}

// ================================================================== reversal vs payout
{
  reset();
  const a = world();
  const blocked = await adminLib.reverseCommission(a, U.admin, lid(1), "customer refunded");
  check("reverse: a commission attached to a REQUESTED payout is refused by the database", !blocked.ok && blocked.code === "payout_in_flight" && ledgerRow(a).status === "eligible_for_payout");
  await adminLib.sendPayoutViaFapshi(a, U.admin, id(1));
  const blocked2 = await adminLib.reverseCommission(a, U.admin, lid(1), "customer refunded");
  check("reverse: ...and by a PROCESSING payout", blocked2.code === "payout_in_flight");
  const u = world();
  payoutImpl = async () => {
    throw httpError(504);
  };
  await capture(() => adminLib.sendPayoutViaFapshi(u, U.admin, id(1)));
  const blocked3 = await adminLib.reverseCommission(u, U.admin, lid(1), "customer refunded");
  check("reverse: ...and by an UNCERTAIN (reconciliation_required) payout", blocked3.code === "payout_in_flight" && ledgerRow(u).status === "eligible_for_payout");
  check("reverse: nobody is notified of a reversal that did not happen", !sent.some((s) => s.category === "ambassador_commission_reversed"));

  const p = world({ payouts: [{ n: 1, amount: 7500, status: "processing", trans: "TX-9" }] });
  await adminLib.checkPayoutFapshi(p, U.admin, id(1));
  reset();
  const rev = await adminLib.reverseCommission(p, U.admin, lid(1), "refund after payout");
  check("reverse: once PAID, reversal records a separate negative row and never edits the paid row", rev.ok && ledgerRow(p).status === "paid" && ledgerRow(p).commission_amount === 7500 && p._tables.get("ambassador_commission_ledger").get(`rec-${lid(1)}`).commission_amount === -7500);
  check("reverse: a real reversal notifies the recipient once; a replay does not", sent.filter((s) => s.category === "ambassador_commission_reversed").length === 1);
  const replay = await adminLib.reverseCommission(p, U.admin, lid(1), "again");
  check("reverse: replaying it is an idempotent success with no second recovery row and no second notification", replay.ok && p._tables.get("ambassador_commission_ledger").size === 2 && sent.filter((s) => s.category === "ambassador_commission_reversed").length === 1);
  check("reverse: a non-admin is refused; a reason is required", (await adminLib.reverseCommission(p, "00000000-0000-4000-8000-00000000dead", lid(1), "xxx")).code === "not_authorized" && (await adminLib.reverseCommission(world(), U.admin, lid(1), "")).code === "invalid_input");
}

// ================================================================== private destinations
function destWorld(extra = {}) {
  return makeFakeAdmin(
    {
      ambassador_profiles: [{ id: "amb1", user_id: U.amb, status: "active" }, { id: "amb2", user_id: U.other, status: "suspended" }],
      ambassador_teams: [{ id: "t1", team_leader_user_id: U.tl }],
      ambassador_payout_destinations: [],
      ambassador_commission_ledger: [
        { id: "e1", recipient_type: "ambassador", recipient_user_id: U.amb, entry_type: "commission", status: "eligible_for_payout", commission_amount: 800, currency: "XAF", payout_id: null },
        { id: "e2", recipient_type: "team_leader", recipient_user_id: U.tl, entry_type: "commission", status: "eligible_for_payout", commission_amount: 300, currency: "XAF", payout_id: null },
      ],
      ambassador_payouts: [],
      platform_settings: [{ id: "ps1", ambassador_min_payout_xaf: 500 }],
      profiles: [{ id: "p1", user_id: U.amb, is_demo: false }, { id: "p2", user_id: U.tl, is_demo: false }],
      ...extra,
    },
    stateMachine({ admins: new Set([U.admin]) })
  );
}
{
  reset();
  const a = destWorld();
  const first = await userLib.saveMyDestination(a, U.amb, { role: "ambassador", method: "mobile_money", details: { ...MOMO, amount: 999999, recipient_user_id: U.other } });
  const call = a._calls.rpc.find((c) => c.name === "ambassador_set_payout_destination");
  check("destination: saved; the response carries ONLY the masked label and cooldown info — never the phone number", first.ok && first.maskedLabel.includes("•••") && !JSON.stringify(first).includes(SECRET_PHONE) && first.coolingDown === false);
  check("destination: only the whitelisted destination and the session identity reach the database (no amount / foreign recipient)", call && JSON.stringify(call.args.p_details) === JSON.stringify(MOMO) && call.args.p_user_id === U.amb && call.args.p_actor_user_id === U.amb && !JSON.stringify(call.args).includes("999999"));
  check("destination: a FIRST destination is usable immediately and sends no change notification", !sent.some((s) => s.category === "ambassador_payout_destination_changed"));
  const same = await userLib.saveMyDestination(a, U.amb, { role: "ambassador", method: "mobile_money", details: MOMO });
  check("destination: re-saving an identical destination changes nothing and does not restart the cooldown", same.ok && same.changed === false && same.coolingDown === false);

  const req1 = await userLib.requestMyPayout(a, U.amb, { role: "ambassador" });
  check("destination: an unchanged, usable destination pays out (amount = the database's own sum)", req1.ok && req1.amount === 800);
}
{
  reset();
  const a = destWorld();
  await userLib.saveMyDestination(a, U.amb, { role: "ambassador", method: "mobile_money", details: MOMO });
  const changed = await userLib.saveMyDestination(a, U.amb, { role: "ambassador", method: "mobile_money", details: { provider: "orange", phone: "699111222" } });
  check("cooldown: CHANGING an existing destination starts a cooldown and is reported as cooling down (masked only)", changed.ok && changed.coolingDown === true && !JSON.stringify(changed).includes("699111222") && !JSON.stringify(changed).includes(SECRET_PHONE));
  check("cooldown: the owner is notified of the change", sent.filter((s) => s.category === "ambassador_payout_destination_changed" && s.userId === U.amb).length === 1);
  const blocked = await userLib.requestMyPayout(a, U.amb, { role: "ambassador" });
  check("cooldown: payouts to the changed destination are BLOCKED, and existing commission rows are untouched", !blocked.ok && blocked.code === "destination_cooling_down" && a._tables.get("ambassador_commission_ledger").get("e1").payout_id == null && a._tables.get("ambassador_commission_ledger").get("e1").status === "eligible_for_payout");
  a._now += 23 * 3600 * 1000;
  check("cooldown: still blocked after 23 hours (database time)", (await userLib.requestMyPayout(a, U.amb, { role: "ambassador" })).code === "destination_cooling_down");
  a._now += 2 * 3600 * 1000;
  const after = await userLib.requestMyPayout(a, U.amb, { role: "ambassador" });
  check("cooldown: after 24 hours the new destination becomes eligible and the payout succeeds", after.ok && a._tables.get("ambassador_payouts").size === 1);
  const stored = Array.from(a._tables.get("ambassador_payouts").values())[0];
  check("cooldown: the payout snapshot uses the NEW destination", stored.payout_details.phone === "699111222");
  check("cooldown: the client cannot influence the clock — no time field is accepted anywhere in the save/request path", !/usable_after|now\(|Date\.now/.test(strip(read("src/app/api/ambassador/payout-destination/route.ts")) + strip(read("src/app/api/ambassador/payouts/route.ts"))));
}
{
  reset();
  const a = destWorld();
  check("destination: no destination saved -> request refused with no_destination", (await userLib.requestMyPayout(a, U.amb, { role: "ambassador" })).code === "no_destination");
  check("destination: invalid shape refused before the database", (await userLib.saveMyDestination(a, U.amb, { role: "ambassador", method: "mobile_money", details: { provider: "visa", phone: "1" } })).code === "invalid_details" && !a._calls.rpc.some((c) => c.name === "ambassador_set_payout_destination"));
  check("destination: paypal (legacy affiliate only) is not a valid Ambassador method", (await userLib.saveMyDestination(a, U.amb, { role: "ambassador", method: "paypal", details: { email: "a@b.c" } })).code === "invalid_method");
  check("destination: a Team Leader cannot save as an Ambassador, nor an Ambassador as a Team Leader, nor a suspended Ambassador at all", (await userLib.saveMyDestination(a, U.tl, { role: "ambassador", method: "bank", details: BANK })).code === "not_ambassador" && (await userLib.saveMyDestination(a, U.amb, { role: "team_leader", method: "bank", details: BANK })).code === "not_team_leader" && (await userLib.saveMyDestination(a, U.other, { role: "ambassador", method: "bank", details: BANK })).code === "suspended");
  await userLib.saveMyDestination(a, U.tl, { role: "team_leader", method: "bank", details: BANK });
  const tlView = await userLib.getMyPayoutOverview(a, U.tl, "team_leader");
  const ambView = await userLib.getMyPayoutOverview(a, U.amb, "ambassador");
  check("privacy: a Team Leader's destination is stored separately and each owner sees only their OWN masked label", tlView.destination && tlView.destination.maskedLabel.includes("Some Bank") && ambView.destination === null);
  check("privacy: the overview sent to the browser never contains full destination details", !JSON.stringify(tlView).includes("0012345678") && !JSON.stringify(tlView).includes("A B") && !JSON.stringify(ambView).includes(SECRET_PHONE));
  const tlReq = await userLib.requestMyPayout(a, U.tl, { role: "team_leader" });
  check("minimum: 300 XAF is below the 500 minimum the DATABASE enforces -> below_minimum with the configured value", !tlReq.ok && tlReq.code === "below_minimum" && tlReq.minimum === 500);
  a._tables.get("platform_settings").get("ps1").ambassador_min_payout_xaf = 250;
  const tlReq2 = await userLib.requestMyPayout(a, U.tl, { role: "team_leader" });
  check("minimum: lowering the setting takes effect immediately with no code change (single source of truth)", tlReq2.ok && tlReq2.amount === 300);
  const ambView2 = await userLib.getMyPayoutOverview(a, U.amb, "ambassador");
  check("minimum: the UI display value is read from the same setting", ambView2.minimumPayout === 250);
}
{
  reset();
  const a = destWorld({ platform_settings: [] });
  await userLib.saveMyDestination(a, U.amb, { role: "ambassador", method: "mobile_money", details: MOMO });
  const r = await userLib.requestMyPayout(a, U.amb, { role: "ambassador" });
  check("minimum: if the setting cannot be read the request FAILS CLOSED (never pays)", !r.ok && r.code === "unavailable" && a._tables.get("ambassador_payouts").size === 0);
  const view = await userLib.getMyPayoutOverview(a, U.amb, "ambassador");
  check("minimum: an unreadable setting shows nothing rather than an invented number", view.minimumPayout === null);
}
{
  reset();
  const a = destWorld();
  const errRpc = a.rpc;
  a.rpc = async (n, args) => (n === "ambassador_set_payout_destination" ? { data: null, error: { message: "db down" } } : errRpc(n, args));
  const r = await capture(() => userLib.saveMyDestination(a, U.amb, { role: "ambassador", method: "mobile_money", details: MOMO }));
  check("privacy: when a save fails, nothing sensitive is logged or returned", r.value.code === "unavailable" && !r.lines.join(" ").includes(SECRET_PHONE) && !JSON.stringify(r.value).includes(SECRET_PHONE));
  const concurrent = destWorld();
  await userLib.saveMyDestination(concurrent, U.amb, { role: "ambassador", method: "mobile_money", details: MOMO });
  const outs = await Promise.all([1, 2, 3, 4, 5].map(() => userLib.requestMyPayout(concurrent, U.amb, { role: "ambassador" })));
  check("concurrency: five simultaneous payout requests yield exactly one payout", outs.filter((o) => o.ok).length === 1 && concurrent._tables.get("ambassador_payouts").size === 1);
}

// ================================================================== minimum payout setting
{
  reset();
  const a = makeFakeAdmin({ platform_settings: [{ id: "ps1", ambassador_min_payout_xaf: 500 }] });
  check("setting: reads the configured minimum", (await settings.getAmbassadorPayoutMinimum(a)) === 500);
  check("setting: values below Fapshi's own floor, non-numbers and absurd values are rejected", (await settings.setAmbassadorPayoutMinimum(a, U.admin, 50)).code === "invalid_minimum" && (await settings.setAmbassadorPayoutMinimum(a, U.admin, "abc")).code === "invalid_minimum" && (await settings.setAmbassadorPayoutMinimum(a, U.admin, 1e12)).code === "invalid_minimum" && a._tables.get("platform_settings").get("ps1").ambassador_min_payout_xaf === 500);
  const r = await settings.setAmbassadorPayoutMinimum(a, U.admin, "1000");
  check("setting: an admin can change it (numeric string accepted), the change is audited with before/after", r.ok && a._tables.get("platform_settings").get("ps1").ambassador_min_payout_xaf === 1000 && a._calls.rpc.some((c) => c.name === "ambassador_log_action" && c.args.p_action === "min_payout_changed" && c.args.p_before.ambassador_min_payout_xaf === 500 && c.args.p_after.ambassador_min_payout_xaf === 1000));
  check("setting: an unreadable/absent setting yields null (no invented default)", (await settings.getAmbassadorPayoutMinimum(makeFakeAdmin({}))) === null);
  const serverMod = load("lib/supabase/server.ts");
  const assertAdminMod = load("lib/assertAdmin.ts");
  serverMod.createAdminClient = () => a;
  assertAdminMod.assertAdmin = async () => null;
  const { POST, GET } = load("app/api/admin/ambassador-settings/route.ts");
  check("setting: the admin route refuses non-admins (GET and POST)", (await POST({ json: async () => ({ minPayoutXaf: 1 }) })).status === 403 && (await GET()).status === 403);
  const src = strip(read("src/lib/ambassador/settings.ts")) + strip(read("src/lib/ambassador/payouts.ts")) + strip(read("src/lib/ambassador/adminPayouts.ts"));
  check("setting: no numeric minimum-payout default exists anywhere in the application code", !/\b500\b/.test(src.replace(/slice\(0, 500\)|status: 500|, 500[)\]]/g, "")) );
  const columnDefaults = fs.readdirSync(path.join(REPO, "supabase/migrations")).map((f) => read(`supabase/migrations/${f}`)).join("\n").match(/ambassador_min_payout_xaf[^;]*default 500/g) || [];
  check("setting: the 500 default is defined exactly once — the column default", columnDefaults.length === 1);
}

// ================================================================== reconciliation with the new states
{
  reset();
  const now = new Date("2026-06-01T12:00:00Z");
  const old = new Date(now.getTime() - 30 * 60 * 1000).toISOString();
  const young = new Date(now.getTime() - 60 * 1000).toISOString();
  const a = world({
    payouts: [
      { n: 1, amount: 1000, status: "processing", trans: null, over: { claimed_at: old } },
      { n: 2, amount: 1000, status: "processing", trans: null, over: { claimed_at: young } },
      { n: 3, amount: 1000, status: "reconciliation_required", trans: "TX-OK" },
      { n: 4, amount: 1000, status: "reconciliation_required", trans: null },
    ],
  });
  a._now = now.getTime();
  statusImpl = async (tid) => ({ status: tid === "TX-OK" ? "SUCCESSFUL" : "CREATED" });
  const { value: s } = await capture(() => reconcileAmbassadorLifecycle(a, { now }));
  check("reconcile: a STALE claim with no transaction id is marked reconciliation_required (uncertainty made explicit)", payout(a, 1).status === "reconciliation_required" && s.payoutsMarkedUncertain === 1);
  check("reconcile: a young claim is left alone", payout(a, 2).status === "processing");
  check("reconcile: an uncertain payout whose KNOWN transaction Fapshi confirms is finalized (rows paid)", payout(a, 3).status === "paid" && ledgerRow(a, 3).status === "paid" && s.payoutsFinalized === 1);
  check("reconcile: an uncertain payout with no transaction id is never touched and never re-sent", payout(a, 4).status === "reconciliation_required" && payoutCalls.length === 0);
  check("reconcile: every uncertain payout is REPORTED for human review", s.integrity.some((f) => f.kind === "payout_reconciliation_required" && f.ids.includes(id(1)) && f.ids.includes(id(4))));
  const before = JSON.stringify(Array.from(a._tables.get("ambassador_payouts").values()));
  await capture(() => reconcileAmbassadorLifecycle(a, { now }));
  check("reconcile: a repeat run changes nothing further (idempotent) and never pays twice", JSON.stringify(Array.from(a._tables.get("ambassador_payouts").values())) === before && a._calls.rpc.filter((c) => c.name === "ambassador_process_payout").length === 1);
}

// ================================================================== notifications
{
  reset();
  const a = world({ payouts: [{ n: 1, amount: 7500, status: "processing", trans: "TX-9", over: { disbursement_attempts: 1 } }] });
  statusImpl = async () => ({ status: "FAILED", reason: "x" });
  await adminLib.checkPayoutFapshi(a, U.admin, id(1));
  await adminLib.checkPayoutFapshi(a, U.admin, id(1)); // no longer in flight: no second notification
  check("notifications: a failure notifies once", sent.filter((s) => s.category === "ambassador_payout_failed").length === 1);
  const n = load("lib/ambassador/notifications.ts");
  payout(a).disbursement_attempts = 2;
  await n.notifyPayoutStatus(a, id(1), "failed");
  check("notifications: a genuinely NEW attempt failing notifies again (dedupe key is per attempt)", sent.filter((s) => s.category === "ambassador_payout_failed").length === 2);
  const en = translations.en.ambassadorNotifications;
  const fr = translations.fr.ambassadorNotifications;
  const groups = ["ambassador", "teamLeader"];
  check("notifications: destination-change copy exists in English and French for both roles, and reveals no destination detail", groups.every((g) => en[g].destinationChanged?.title && fr[g].destinationChanged?.title && typeof en[g].destinationChanged.body === "string" && !/\d{3}/.test(en[g].destinationChanged.body + fr[g].destinationChanged.body) && en[g].destinationChanged.title !== fr[g].destinationChanged.title));
  const b = destWorld();
  await userLib.saveMyDestination(b, U.tl, { role: "team_leader", method: "bank", details: BANK });
  reset();
  await userLib.saveMyDestination(b, U.tl, { role: "team_leader", method: "bank", details: { ...BANK, accountNumber: "9999999999" } });
  const note = sent.find((s) => s.category === "ambassador_payout_destination_changed");
  check("notifications: a Team Leader's change notice goes to the Team Leader's dashboard and contains no account detail", note && note.userId === U.tl && note.url.startsWith("/dashboard/sales-team#") && !JSON.stringify(note).match(/9999999999|0012345678|Some Bank/));
  const sender = withBell.sendPushAndBellToUser;
  withBell.sendPushAndBellToUser = async () => {
    throw new Error("push down");
  };
  const c = destWorld();
  await userLib.saveMyDestination(c, U.amb, { role: "ambassador", method: "mobile_money", details: MOMO });
  const r = await capture(() => userLib.saveMyDestination(c, U.amb, { role: "ambassador", method: "mobile_money", details: { provider: "orange", phone: "699000111" } }));
  withBell.sendPushAndBellToUser = sender;
  check("failure: a failing notification never breaks a destination save", r.value.ok === true && r.value.coolingDown === true);
}

// ================================================================== audit-log snapshot + obsolete columns
{
  const route = strip(read("src/app/api/admin/ambassadors/[id]/route.ts"));
  check("audit: the ambassador update route no longer snapshots with select(\"*\")", !/select\("\*"\)/.test(route));
  const m = route.match(/from\("ambassador_profiles"\)\s*\.select\("([^"]+)"\)\s*\.eq\("id", params\.id\)\s*\.maybeSingle\(\)/);
  check("audit: the snapshot uses an explicit column list that contains no payout column", m && !/payout/.test(m[1]) && /sales_code/.test(m[1]), m && m[1]);
  const codeUsingProfilePayoutCols = ["src/lib", "src/app", "src/components"].flatMap((d) => {
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [path.join(dir, e.name)] : []));
    return walk(path.join(REPO, d));
  }).filter((f) => /from\("ambassador_profiles"\)\s*\.(select|update|insert|upsert)\((\{[^}]*|"[^"]*)payout_(method|details)/s.test(fs.readFileSync(f, "utf8")));
  check("privacy: no application code reads or writes payout columns on ambassador_profiles (safe to drop them)", codeUsingProfilePayoutCols.length === 0, codeUsingProfilePayoutCols.join());
}

// ================================================================== the SQL itself (static checks — NOT execution)
{
  const m24 = read("supabase/migrations/2026-11-24_ambassador_min_payout_setting.sql");
  const m25 = read("supabase/migrations/2026-11-25_ambassador_payout_destinations.sql");
  const m26 = read("supabase/migrations/2026-11-26_ambassador_financial_hardening.sql");
  const sql = (s) => s.replace(/--.*$/gm, "");
  const fn = (s, name) => {
    const i = s.indexOf(`function public.${name}(`);
    if (i < 0) return "";
    const j = s.indexOf("$$;", s.indexOf("$$", s.indexOf("as $$", i) ) + 2);
    return s.slice(i, j);
  };
  const c24 = sql(m24), c25 = sql(m25), c26 = sql(m26);

  check("sql 24: adds platform_settings.ambassador_min_payout_xaf, numeric, not null, default 500, positive check — additive only", /alter table platform_settings\s+add column if not exists ambassador_min_payout_xaf numeric\(10, 2\) not null default 500/.test(c24) && /check \(ambassador_min_payout_xaf > 0\)/.test(c24) && !/drop |update |delete /i.test(c24));
  check("sql 25: destinations table has RLS enabled and NO policy at all, and privileges revoked from anon/authenticated", /alter table public\.ambassador_payout_destinations enable row level security/.test(c25) && !/create policy[^;]*ambassador_payout_destinations/.test(c25) && /revoke all on table public\.ambassador_payout_destinations from anon/.test(c25) && /revoke all on table public\.ambassador_payout_destinations from authenticated/.test(c25));
  check("sql 25: one current destination per (user, role)", /unique \(user_id, recipient_type\)/.test(c25));
  check("sql 25: the 24-hour cooldown uses database time (now() + interval '24 hours'), never a parameter", /now\(\) \+ interval '24 hours'/.test(c25) && !/p_usable|p_now|p_cooldown/.test(c25));
  const setFn = fn(c25, "ambassador_set_payout_destination");
  const auditCalls = setFn.match(/ambassador_log_action\([^;]*;/gs) || [];
  check("sql 25: destination changes are audited with the MASKED label only — no raw details reach the audit record", auditCalls.length === 2 && auditCalls.every((c) => !/p_details|details/.test(c) && /masked/.test(c)), auditCalls.join(" | "));
  check("sql 25: a first destination is immediate; only a genuine change restarts the cooldown; an identical save changes nothing", /on conflict \(user_id, recipient_type\) do nothing/.test(setFn) && /v_existing\.method = p_method and v_existing\.details = p_details/.test(setFn));
  check("sql 25: the obsolete, leaky ambassador_profiles payout columns are dropped (additive migration, old file untouched)", /alter table public\.ambassador_profiles drop column if exists payout_method/.test(c25) && /alter table public\.ambassador_profiles drop column if exists payout_details/.test(c25));
  check("sql 25: owners can no longer read raw destination snapshots through PostgREST (payouts read policy is admin-only)", /drop policy if exists "ambassador_payouts own or admin read"/.test(c25) && /create policy "ambassador_payouts admin read"[^;]*is_admin\(\)/.test(c25));

  check("sql 26: payout status machine includes reconciliation_required, plus attempts/claimed_at/key columns", /check \(status in \('requested', 'processing', 'reconciliation_required', 'paid', 'rejected'\)\)/.test(c26) && /disbursement_attempts int not null default 0/.test(c26) && /add column if not exists disbursement_key text/.test(c26));
  check("sql 26: a Fapshi transaction id can be attached to only ONE payout (unique partial index)", /create unique index if not exists ambassador_payouts_fapshi_trans_unique_idx\s+on public\.ambassador_payouts \(fapshi_trans_id\) where fapshi_trans_id is not null/.test(c26));
  const reqFn = fn(c26, "ambassador_request_payout");
  check("sql 26: the minimum is enforced INSIDE ambassador_request_payout from the single setting, and fails closed if unreadable", /select ambassador_min_payout_xaf into v_min from public\.platform_settings/.test(reqFn) && /v_total < v_min/.test(reqFn) && /'settings_unavailable'/.test(reqFn) && !/\b500\b/.test(reqFn));
  check("sql 26: the request reads the owner's private destination FOR UPDATE and refuses one still cooling down", /from public\.ambassador_payout_destinations[\s\S]*?for update/.test(reqFn) && /usable_after > now\(\)/.test(reqFn) && /'destination_cooling_down'/.test(reqFn));
  check("sql 26: the request takes no amount and no destination parameter; rows are locked (FOR UPDATE, payout_id is null) then summed", /ambassador_request_payout\(p_recipient_type text, p_recipient_user_id uuid\)/.test(reqFn) && /payout_id is null/.test(reqFn) && /for update/.test(reqFn.slice(reqFn.indexOf("locked_rows"))));
  check("sql 26: the old 4-argument request function (which trusted a caller-supplied destination) is dropped", /drop function if exists public\.ambassador_request_payout\(text, uuid, text, jsonb\)/.test(c26));
  const revFn = fn(c26, "ambassador_reverse_commission");
  const lockAt = revFn.search(/for update/);
  const stateAt = revFn.search(/v_row\.status/);
  check("sql 26: reversal locks the ledger row BEFORE it inspects any state", lockAt > 0 && stateAt > lockAt);
  check("sql 26: reversal refuses an unpaid commission attached to a payout, and never edits a paid row (it inserts a separate reversal)", /v_row\.status <> 'paid' and v_row\.payout_id is not null[\s\S]*?'payout_in_progress'/.test(revFn) && /insert into public\.ambassador_commission_ledger/.test(revFn) && /entry_type[\s\S]*'reversal'/.test(revFn));
  const procFn = fn(c26, "ambassador_process_payout");
  check("sql 26: process_payout locks the payout, verifies the linked rows (state + exact sum) and the actor, and reports already_paid/not_found instead of ok:true", /from public\.ambassador_payouts where id = p_payout_id for update/.test(procFn) && /ambassador_payout_ledger_check/.test(procFn) && /'not_found'/.test(procFn) && /'already_paid'/.test(procFn) && /'not_authorized'/.test(procFn) && /'ledger_mismatch'/.test(procFn));
  check("sql 26: process_payout raises if it paid a different number of rows than it verified", /raise exception 'ambassador_process_payout: paid % rows but expected %'/.test(procFn));
  const chk = fn(c26, "ambassador_payout_ledger_check");
  check("sql 26: the ledger check locks every linked row (FOR UPDATE, id order) and compares the sum to the payout amount", /order by id\s+for update/.test(chk) && /v_sum = p_expected/.test(chk) && /bool_and/.test(chk));
  check("sql 26: the paid ledger row is fully immutable (trigger), core financial fields never change, illegal transitions are refused", /old\.status = 'paid' and new is distinct from old/.test(c26) && /new\.commission_amount is distinct from old\.commission_amount/.test(c26) && /new\.recipient_user_id is distinct from old\.recipient_user_id/.test(c26) && /new\.milestone is distinct from old\.milestone/.test(c26) && /new\.sale_id is distinct from old\.sale_id/.test(c26) && /illegal ambassador_commission_ledger status transition/.test(c26));
  check("sql 26: payout association and paid_at are protected (cannot re-point, only an unpaid eligible row may be released, paid requires paid_at + payout)", /a commission cannot be moved between payouts/.test(c26) && /only an unpaid eligible commission can be released from a payout/.test(c26) && /new\.paid_at is null or new\.payout_id is null/.test(c26));
  check("sql 26: ledger rows and payouts cannot be deleted, and a commission attached to a payout can't be reversed in place", /cannot be deleted/.test(c26) && /before delete on public\.ambassador_commission_ledger/.test(c26) && /before delete on public\.ambassador_payouts/.test(c26) && /attached to a payout cannot be reversed in place/.test(c26));
  check("sql 26: payout state machine transitions are whitelisted by trigger (and a paid payout is immutable)", /illegal ambassador_payouts status transition/.test(c26) && /a paid ambassador_payouts row is immutable/.test(c26));
  const fns = ["ambassador_claim_payout", "ambassador_record_disbursement_accepted", "ambassador_release_payout_claim", "ambassador_fail_disbursement", "ambassador_mark_payout_uncertain", "ambassador_resolve_uncertain_payout", "ambassador_reject_payout"];
  check("sql 26: every state-machine function exists, sets a pinned search_path, and is revoked from public/anon/authenticated and granted only to service_role", fns.every((f) => fn(c26, f).includes("set search_path = public") && new RegExp(`'public\\.${f}\\(`).test(c26)) && /revoke all on function %s from public/.test(c26) && /grant execute on function %s to service_role/.test(c26));
  const claim = fn(c26, "ambassador_claim_payout");
  check("sql 26: claiming locks the payout, needs an admin, requires status requested, verifies the ledger and stamps a per-attempt disbursement key", /for update/.test(claim) && /ambassador_actor_is_admin/.test(claim) && /v_p\.status <> 'requested'/.test(claim) && /ambassador_payout_ledger_check/.test(claim) && /disbursement_key = 'ambassador-payout-'/.test(claim));
  const uncertain = fn(c26, "ambassador_mark_payout_uncertain") + fn(c26, "ambassador_resolve_uncertain_payout");
  check("sql 26: an uncertain payout keeps its ledger rows linked (nothing in mark-uncertain touches the ledger) and only resolves with a note", !/ambassador_commission_ledger/.test(fn(c26, "ambassador_mark_payout_uncertain")) && /char_length\(btrim\(p_note\)\) < 3/.test(uncertain));
  const rej = fn(c26, "ambassador_reject_payout");
  check("sql 26: rejection is only from requested with no transaction id, and releases the rows only after locking them", /v_p\.status <> 'requested' or v_p\.fapshi_trans_id is not null/.test(rej) && /for update/.test(rej) && /set payout_id = null/.test(rej));
  check("sql: none of the three new migrations edits an earlier migration file (they only create/replace objects)", [m24, m25, m26].every((m) => !/2026-11-(18|19|20|21|22|23)_[a-z_]+\.sql/.test(sql(m))));
  const all = [c24, c25, c26].join("\n");
  check("sql: no new migration touches the legacy affiliate system", !/affiliate/i.test(all));
}

// ================================================================== i18n parity + code coverage
{
  const shape = (o) => (typeof o === "function" ? "fn" : o && typeof o === "object" ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, shape(v)])) : "str");
  check("i18n: ambassadorPayouts has identical keys/shape in English and French", JSON.stringify(shape(translations.en.ambassadorPayouts)) === JSON.stringify(shape(translations.fr.ambassadorPayouts)));
  const adminCodes = [...read("src/lib/ambassador/adminPayouts.ts").matchAll(/\| "([a-z_]+)"/g)].map((m) => m[1]);
  const adminErrors = translations.en.ambassadorPayouts.admin.errors;
  const frAdminErrors = translations.fr.ambassadorPayouts.admin.errors;
  check("i18n: every admin error code has English AND French text", adminCodes.length > 15 && adminCodes.every((c) => adminErrors[c] && frAdminErrors[c]), adminCodes.filter((c) => !adminErrors[c] || !frAdminErrors[c]).join());
  const userCodes = [...read("src/lib/ambassador/payouts.ts").split("export type PayoutErrorCode =")[1].split(";")[0].matchAll(/\| "([a-z_]+)"/g)].map((m) => m[1]);
  check("i18n: every requester error code has English AND French text", userCodes.length > 8 && userCodes.every((c) => translations.en.ambassadorPayouts.errors[c] && translations.fr.ambassadorPayouts.errors[c]), userCodes.filter((c) => !translations.en.ambassadorPayouts.errors[c]).join());
  check("i18n: French copy for the new destination/cooldown UI is genuinely translated", translations.fr.ambassadorPayouts.destinationTitle !== translations.en.ambassadorPayouts.destinationTitle && translations.fr.ambassadorPayouts.errors.destination_cooling_down !== translations.en.ambassadorPayouts.errors.destination_cooling_down && translations.fr.ambassadorPayouts.admin.reconciliationHint !== translations.en.ambassadorPayouts.admin.reconciliationHint);
  const ui = read("src/components/dashboard/AmbassadorPayoutPanel.tsx");
  check("privacy: the payout panel never receives or renders full destination details and clears typed values after saving", !/details\b[\s\S]{0,40}overview\.destination/.test(ui) && /setPhone\(""\)/.test(ui) && /setAccountNumber\(""\)/.test(ui) && !/lastDestination/.test(ui));
}

const failed = results.filter((x) => !x.pass);
console.log(`\nambassadorHardening: ${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
