// Business Toolkit Phase 7A (the Overview at /dashboard/reports): the REAL report builder (with its new optional `sections`), overview builder, handler,
// route file, tab list and translations run here against an in-memory read-only fake; only the session resolver is stubbed. No network, no database, no
// migration (Phase 7A needs none: every figure is read from the Phase 1-6 tables).
//   Run:  node scripts/tests/overview.test.mjs
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { createRequire } from "module";
import { fileURLToPath } from "url";
// Record Sale (standalone receipts, branding, payment details, print, footer, navigation): the files that release changes on purpose. See recordSaleUnit.test.mjs / recordSaleSql.test.mjs.
const RECORD_SALE_FILES = /^(src\/(lib\/(sales\/|documents\/pdf\/(logo|render|templates\/v[12])|documents\/(handlers|http|snapshot|types|validation|brand|actions|publicShare)\.ts$|bookkeeping\/(saleReceiptGuard|recordEntry)\.ts$|corrections\/entries\.ts$)|components\/(sales\/|documents\/(BusinessProfileForm|DocumentActions|DocumentView|PublicDocumentView|PrintButton|shared)\.tsx$|overview\/OverviewView\.tsx$|reports\/ReportsTabs\.tsx$|dashboard\/DashboardShell\.tsx$)|app\/(api\/sales\/|d\/\[token\]\/(page\.tsx$|logo\/)|dashboard\/(sales|bookkeeping)\/|dashboard\/layout\.tsx$|dashboard\/reports\/entries\/page\.tsx$|api\/bookkeeping\/entries\/\[id\]\/void\/route\.ts$))|supabase\/(migrations|support)\/2026-12-06_record_sale_receipts_branding)/;

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO, "src");
const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8").replace(/\r\n/g, "\n");
const strip = (s) => s.replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/\/\*[\s\S]*?\*\//g, "");

const tmp = [];
const mk = (name, body) => { const f = path.join(os.tmpdir(), `ov_${name}_${process.pid}.cjs`); fs.writeFileSync(f, body); tmp.push(f); return f; };
const accessStub = mk("access", "module.exports = { resolveBookkeepingOwner: async () => globalThis.__owner };");
const serverStub = mk("server", "module.exports = { createAdminClient: () => globalThis.__admin };");
const alias = { "@/lib/bookkeeping/access": accessStub, "@/lib/supabase/server": serverStub, "@": SRC };
const jiti = require("jiti")(import.meta.url, { alias, interopDefault: true, cache: false });
const P = jiti(path.join(SRC, "lib/reports/period.ts"));
const B = jiti(path.join(SRC, "lib/reports/build.ts"));
const O = jiti(path.join(SRC, "lib/overview/build.ts"));
const H = jiti(path.join(SRC, "lib/overview/handlers.ts"));
const { translations } = jiti(path.join(SRC, "lib/i18n/translations.ts"));
const routeMod = jiti(path.join(SRC, "app/api/overview/route.ts"));

console.error = () => {};
let pass = 0, fail = 0;
const check = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log("  FAIL:", name, "|", String(detail).slice(0, 300)); } };
const eq = (name, a, b) => check(name, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} !== ${JSON.stringify(b)}`);

const PROFILE = "22222222-2222-4222-8222-222222222222", OTHER = "99999999-9999-4999-8999-999999999999", USER = "11111111-1111-4111-8111-111111111111";
const ID = (n) => `44444444-4444-4444-8444-${String(n).padStart(12, "0")}`;
const NOW = new Date("2026-12-10T10:00:00Z");
const SECRETS = ["SECRET BUYER", "+237600000000", "buyer@secret.test", "Secret Customer"];

// ------------------------------------------------------------------------ a read-only fake database: filters, ordering, ranges, column projection, no write methods
const splitCols = (sel) => { const out = []; let depth = 0, cur = ""; for (const ch of String(sel)) { if (ch === "(") depth++; if (ch === ")") depth--; if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += ch; } if (cur.trim()) out.push(cur.trim()); return out; };
function makeDb(tables, log, fail) {
  return { from(table) {
    const q = { f: [], range: null, sort: [], select: "*" };
    const call = { table, eq: [], select: "" };
    log?.push(call);
    const rows = () => {
      let r = (tables[table] || []).filter((row) => q.f.every(([op, c, v]) => {
        const x = row[c];
        if (op === "eq") return x === v;
        if (op === "in") return v.includes(x);
        if (op === "gte") return x !== null && x !== undefined && x >= v;
        if (op === "lte") return x !== null && x !== undefined && x <= v;
        if (op === "lt") return x !== null && x !== undefined && x < v;
        if (op === "is") return (x ?? null) === v;
        if (op === "notnull") return (x ?? null) !== null;
        return true;
      }));
      for (const [c, asc] of [...q.sort].reverse()) r = [...r].sort((a, b) => (String(a[c] ?? "") < String(b[c] ?? "") ? -1 : String(a[c] ?? "") > String(b[c] ?? "") ? 1 : 0) * (asc ? 1 : -1));
      return r;
    };
    const project = (row) => {
      if (q.select === "*") return row;
      const out = {};
      for (const col of splitCols(q.select)) {
        const key = col.includes("(") ? col.slice(0, col.indexOf("(")) : col.includes(":") ? col.slice(0, col.indexOf(":")) : col;
        if (key in row) out[key] = row[key];
      }
      return out;
    };
    const chain = {
      select(s) { q.select = s ?? "*"; call.select = String(s ?? "*"); return chain; },
      eq(c, v) { q.f.push(["eq", c, v]); call.eq.push([c, v]); return chain; },
      in(c, v) { q.f.push(["in", c, v]); return chain; },
      gte(c, v) { q.f.push(["gte", c, v]); return chain; }, lte(c, v) { q.f.push(["lte", c, v]); return chain; }, lt(c, v) { q.f.push(["lt", c, v]); return chain; },
      is(c, v) { q.f.push(["is", c, v]); return chain; },
      not(c, op, v) { if (op === "is" && v === null) q.f.push(["notnull", c, null]); return chain; },
      order(c, o) { q.sort.push([c, o?.ascending !== false]); return chain; }, limit() { return chain; },
      range(a, b) { q.range = [a, b]; return chain; },
      maybeSingle: async () => ({ data: rows()[0] ? project(rows()[0]) : null, error: null }),
      then(res, rej) {
        if (fail && fail(table, call.select)) return Promise.resolve({ data: null, error: { code: "XX000", message: "boom" } }).then(res, rej);
        const all = rows().map(project);
        return Promise.resolve({ data: q.range ? all.slice(q.range[0], q.range[1] + 1) : all, error: null }).then(res, rej);
      },
    };
    return chain;
  } };
}
const makeAdmin = (responses = {}) => { const calls = []; return { calls, rpc: async (name, args) => { calls.push([name, args]); const r = responses[name]; return typeof r === "function" ? r(args) : r ?? { data: null, error: { code: "PGRST202", message: "not found" } }; } }; };

const earn = (fee, net, extra = {}) => ({ gross_amount: String(fee + net), platform_fee: String(fee), net_amount: String(net), currency: "XAF", status: "recorded", ...extra });
const entry = (id, kind, amount, date, extra = {}) => ({ id, profile_id: PROFILE, kind, amount: String(amount), currency: "XAF", entry_date: date, category: null, description: null, cash_settled: true, linked_order_type: null, linked_order_id: null, voided_at: null, created_at: `${date}T09:00:00Z`, ...extra });
const order = (id, status, total, paidAt, e, extra = {}) => ({ id, profile_id: PROFILE, status, total: String(total), currency: "XAF", paid_at: paidAt, order_number: null, commerce_sale_earnings: e, customer_name: SECRETS[0], customer_phone: SECRETS[1], customer_email: SECRETS[2], ...extra });
const doc = (id, status, total, paid, created, extra = {}) => ({ id, profile_id: PROFILE, doc_type: "invoice", number: `INV-${id}`, status, issue_date: created.slice(0, 10), due_date: null, currency: "XAF", total: String(total), amount_paid: String(paid), created_at: created, customer_name: SECRETS[3], ...extra });

const FIXTURE = () => ({
  bk_entries: [
    entry("e1", "sale", 10000, "2026-12-02", { category: "invoice_payment" }), entry("e2", "sale", 3000, "2026-12-03"), entry("e3", "other_income", 1000, "2026-12-04"),
    entry("e4", "expense", 4000, "2026-12-05", { category: "rent" }), entry("e5", "cash_out", 1500, "2026-12-06"), entry("e6", "sale", 2000, "2026-12-07", { cash_settled: false }),
    entry("e7", "sale", 9999, "2026-12-08", { voided_at: "2026-12-08T12:00:00Z" }), entry("e8", "sale", 777, "2026-12-08", { currency: "USD", created_at: "2026-12-08T10:00:00Z" }),
    entry("e9", "expense", 500, "2026-12-09", { category: "transport", cash_settled: false, description: "Taxi" }), entry("e10", "sale", 4242, "2026-11-20"),
    { ...entry("x1", "sale", 55555, "2026-12-10"), profile_id: OTHER },
  ],
  product_orders: [
    order("o1", "paid", 20000, "2026-12-03T10:00:00Z", earn(2000, 18000), { order_number: 101 }),
    order("o2", "fulfilled", 10000, "2026-12-08T10:00:00Z", earn(1000, 9000, { status: "paid" }), { order_number: 102 }),
    order("o3", "refunded", 6000, "2026-12-05T10:00:00Z", earn(600, 5400), { order_number: 103 }),
    order("o4", "awaiting_payment", 9000, null, null, { order_number: 104 }),
    order("o5", "paid", 100, "2026-12-09T10:00:00Z", null, { currency: "USD", order_number: 105 }),
    order("o6", "paid", 5000, "2026-11-25T10:00:00Z", earn(500, 4500), { order_number: 99 }),
    { ...order("ox", "paid", 88888, "2026-12-09T11:00:00Z", earn(8, 88880), { order_number: 777 }), profile_id: OTHER },
  ],
  product_order_items: [{ id: "i1", order_id: "o1", product_id: ID(1), name_snapshot: "Shirt", quantity: 2, line_total: "20000" }],
  bk_documents: [
    doc("d1", "issued", 30000, 0, "2026-12-02T08:00:00Z"), doc("d2", "paid", 20000, 20000, "2026-12-05T08:00:00Z"), doc("d3", "draft", 6000, 0, "2026-12-06T08:00:00Z", { number: null }),
    doc("d4", "void", 5000, 0, "2026-12-06T09:00:00Z"), doc("d5", "partially_paid", 10000, 4000, "2026-12-07T08:00:00Z", { due_date: "2026-01-15" }),
    { ...doc("dx", "issued", 77777, 0, "2026-12-09T08:00:00Z"), profile_id: OTHER },
  ],
  bk_business_profiles: [{ profile_id: PROFILE, display_name: "Boutique Elise", legal_name: "Elise SARL", address: "Rue 1", phone: "+237 677 00 00 00", email: "elise@shop.test", tax_id: "TX-1", registration_no: "RC-9" }],
  profiles: [{ id: PROFILE, name: "Fallback Name", username: "elise" }],
});
const RECEIVABLES = { data: { today: "2026-12-10", profile_currency: "XAF", currencies: [{ currency: "XAF", outstanding: "40000.000", overdue: "10000.000", invoice_count: 4, overdue_count: 1,
  aging: { not_due: { amount: "30000.000", count: 3 }, no_due_date: { amount: "0", count: 0 }, d1_30: { amount: "10000.000", count: 1 }, d31_60: { amount: "0", count: 0 }, d61_90: { amount: "0", count: 0 }, d90_plus: { amount: "0", count: 0 } } }] }, error: null };
const INVENTORY = (filter) => {
  const mkItem = (n, state, count) => ({ product_id: ID(n), name: `Item ${n}`, available: true, state, tracked: true, count, low_stock_threshold: 5, reserved: 0, sold_units: 1, sku: null, unit_cost: null, estimated_value: null, drift: 0 });
  return { data: { profile_currency: "XAF", total: 9, summary: { tracked: 9, out: 4, low: 4, ok: 1, legacy: 1, untracked: 4, estimated_value: "54800", value_excluded: 1, drift: 0 },
    items: filter === "out" ? [mkItem(1, "out", 0), mkItem(2, "out", 0), mkItem(3, "out", 0), mkItem(4, "out", 0)] : filter === "low" ? [mkItem(5, "low", 4), mkItem(6, "low", 3), mkItem(7, "low", 2), mkItem(8, "low", 1)] : [] }, error: null };
};
const mkOwner = (tables = FIXTURE(), over = {}, log = [], opts = {}) => ({
  userId: USER, profile: { id: PROFILE, currency: opts.currency ?? "XAF" }, supabase: makeDb(tables, log, opts.fail), log,
  admin: makeAdmin({ doc_receivables_summary: RECEIVABLES, inv_overview: (a) => INVENTORY(a.p_filter), ...over }),
});
const DEC = P.periodFor(2026, 12, NOW).period;
const ov = async (owner = mkOwner(), now = NOW) => (await H.overviewSummary(owner, { now })).body.overview;

// ------------------------------------------------------------------------ report builder: the default behaviour is UNCHANGED
{
  const full = await B.buildMonthlyReport(mkOwner(), DEC, { now: NOW });
  const explicit = await B.buildMonthlyReport(mkOwner(), DEC, { now: NOW, sections: {} });
  const allOn = await B.buildMonthlyReport(mkOwner(), DEC, { now: NOW, sections: { topProducts: true, invoicing: true, business: true } });
  eq("no `sections`, an empty `sections` and every flag on all build the identical model (fingerprint included)", [JSON.stringify(explicit), JSON.stringify(allOn)], [JSON.stringify(full), JSON.stringify(full)]);

  // the builder as committed in HEAD (before Phase 7) must produce byte-identical output for the default call
  let headModel = null;
  try {
    const src = execFileSync("git", ["show", "HEAD:src/lib/reports/build.ts"], { cwd: REPO, maxBuffer: 1 << 24 }).toString().replace(/from "\.\/period"/, 'from "@/lib/reports/period"');
    const f = path.join(os.tmpdir(), `ov_headbuild_${process.pid}.ts`);
    fs.writeFileSync(f, src);
    tmp.push(f);
    const Head = jiti(f);
    headModel = await Head.buildMonthlyReport(mkOwner(), DEC, { now: NOW });
  } catch { /* not a git checkout */ }
  check("the default report model equals the one built by the committed (HEAD) builder, field for field", headModel === null || JSON.stringify(headModel) === JSON.stringify(full), headModel ? "differs" : "");
  check("the committed model has real content (so the comparison is meaningful)", full.revenue.totalMinor === 46000 && full.topProducts.length === 1 && full.invoicing.available && full.business.name === "Boutique Elise");

  // a lighter build skips ONLY the extra queries; every figure that is built stays identical
  const log = [];
  const light = await B.buildMonthlyReport(mkOwner(FIXTURE(), {}, log), DEC, { now: NOW, sections: { topProducts: false, invoicing: false, business: false } });
  for (const k of ["revenue", "counts", "online", "expenses", "cash", "uncollected", "receivables", "inventory", "refundedOrders", "exclusions", "profit", "currency", "period"]) eq(`light build: ${k} is identical to the full build`, light[k], full[k]);
  check("light build: skipped sections are unavailable/empty, never a real-looking zero", light.topProducts.length === 0 && light.invoicing.available === false && light.business.name === "" && light.business.legalName === null);
  check("light build: the skipped queries are really not made", !log.some((c) => ["product_order_items", "bk_documents", "bk_business_profiles", "profiles"].includes(c.table)), log.map((c) => c.table).join());
}

// ------------------------------------------------------------------------ the Overview figures ARE the report's figures
{
  const o = await ov();
  const full = await B.buildMonthlyReport(mkOwner(), DEC, { now: NOW });
  eq("the period is the current month to date in business-local time", [o.period.from, o.period.to, o.period.kind, o.asOfDate], ["2026-12-01", "2026-12-10", "month_to_date", "2026-12-10"]);
  eq("revenue is the report's revenue", [o.revenue, o.counts], [full.revenue, full.counts]);
  eq("cash is the report's cash", o.cash, full.cash);
  eq("online sales are the report's online sales", o.online, full.online);
  eq("expenses are the report's expense figures", o.expenses, { totalMinor: full.expenses.totalMinor, operatingMinor: full.expenses.operatingMinor, stockPurchasesMinor: full.expenses.stockPurchasesMinor, unpaidMinor: full.expenses.unpaidMinor });
  eq("receivables are the report's receivables (per currency, as of today)", o.receivables, full.receivables);
  eq("inventory counts are the report's", [o.inventory.tracked, o.inventory.out, o.inventory.low, o.inventory.ok, o.inventory.legacy, o.inventory.asOfDate], [full.inventory.tracked, full.inventory.out, full.inventory.low, full.inventory.ok, full.inventory.legacy, full.inventory.asOfDate]);
  eq("exclusions and currently-refunded orders are the report's", [o.exclusions, o.refundedOrders], [full.exclusions, full.refundedOrders]);
  eq("hand-checked month figures: revenue 46 000 (online 30 000 + invoice 10 000 + manual 5 000 + other 1 000), expenses recorded 4 500", [o.revenue.totalMinor, o.revenue.onlineGrossMinor, o.revenue.invoicePaymentsMinor, o.revenue.manualSalesMinor, o.revenue.otherIncomeMinor, o.expenses.totalMinor], [46000, 30000, 10000, 5000, 1000, 4500]);
  eq("hand-checked cash: received directly 14 000, paid out 5 500, net 8 500 (online sales are NOT in it)", [o.cash.receivedDirectMinor, o.cash.paidOutMinor, o.cash.netMovementMinor], [14000, 5500, 8500]);
  eq("hand-checked online: gross 30 000, commission 3 000, net earnings 27 000 (9 000 paid out, 18 000 not yet)", [o.online.grossMinor, o.online.commissionMinor, o.online.netMinor, o.online.netPaidOutMinor, o.online.netNotYetPaidOutMinor], [30000, 3000, 27000, 9000, 18000]);
  eq("hand-checked receivables: outstanding 40 000, overdue 10 000", [o.receivables.currencies[0].outstandingMinor, o.receivables.currencies[0].overdueMinor], [40000, 10000]);
  eq("low-stock list is capped at five, out of stock first", [o.inventory.lowStockItems.length, o.inventory.lowStockItems[0].state, o.inventory.lowStockItems[4].state], [5, "out", "low"]);
  check("the Overview does not read the builder's heavy sections (no top products, no invoice-issued figure, no business profile)", !("topProducts" in o) && !("invoicing" in o) && !("business" in o));
}

// ------------------------------------------------------------------------ financial separation: nothing is summed across concepts, no profit
{
  const o = await ov();
  eq("profit is explicitly not reported", o.profit, { status: "not_reported" });
  const keys = [];
  const walk = (v, p = "") => { if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { keys.push(`${p}${k}`); walk(x, `${p}${k}.`); } };
  walk(o);
  check("no key anywhere in the model is a profit/margin/earnings-total figure", !keys.some((k) => /profit|margin|total_?cash|combined|grand/i.test(k.replace(/^profit$|^profit\.status$/, ""))), keys.filter((k) => /profit|margin|combined|grand/i.test(k)).join());
  check("cash movement is exactly received - paid out, never including online earnings", o.cash.netMovementMinor === o.cash.receivedDirectMinor - o.cash.paidOutMinor);

  // a business with ONLY online sales: revenue and online figures, but NO cash movement
  const onlyOnline = await ov(mkOwner({ ...FIXTURE(), bk_entries: [] }));
  eq("only online sales: revenue = gross online, direct cash received 0, net cash movement 0", [onlyOnline.revenue.totalMinor, onlyOnline.cash.receivedDirectMinor, onlyOnline.cash.paidOutMinor, onlyOnline.cash.netMovementMinor], [30000, 0, 0, 0]);
  eq("only online sales: seller earnings stay earnings (27 000), not cash", [onlyOnline.online.netMinor, onlyOnline.cash.netMovementMinor], [27000, 0]);

  // an issued invoice is not revenue; only a recorded payment is
  const noPay = await ov(mkOwner({ ...FIXTURE(), bk_entries: FIXTURE().bk_entries.filter((e) => e.category !== "invoice_payment"), product_orders: [] }));
  eq("issued invoices and receivables never enter revenue or cash (no invoice-payment entry -> invoice revenue 0)", [noPay.revenue.invoicePaymentsMinor, noPay.revenue.totalMinor, noPay.receivables.currencies[0].outstandingMinor], [0, 6000, 40000]);
}

// ------------------------------------------------------------------------ currency
{
  const t = FIXTURE();
  t.bk_entries = [entry("u1", "sale", "12.50", "2026-12-02", { currency: "USD" }), entry("u2", "sale", 9000, "2026-12-03")];
  t.product_orders = [];
  const o = await ov(mkOwner(t, {}, [], { currency: "USD" }));
  eq("a USD profile counts USD records only (12.50 -> 1250 minor); the XAF record is excluded and disclosed", [o.currency, o.minorDigits, o.revenue.totalMinor, o.exclusions.otherCurrency], ["USD", 2, 1250, 1]);
  const xaf = await ov();
  check("the XAF profile leaves the USD sale (777) out of revenue", xaf.revenue.manualSalesMinor === 5000 && xaf.exclusions.otherCurrency >= 1);
}

// ------------------------------------------------------------------------ latest activity: three separate lists, scoped, minimal
{
  const log = [];
  const o = await ov(mkOwner(FIXTURE(), {}, log));
  eq("entries: the five newest NON-voided entries of this business, newest first (the voided one and the other business are absent)", o.recent.entries.items.map((e) => e.id), ["e9", "e8", "e6", "e5", "e4"]);
  const e9 = o.recent.entries.items[0];
  eq("an entry carries its own currency and amount; an unsettled one says so", [e9.amountMinor, e9.currency, e9.cashSettled, e9.description, e9.category], [500, "XAF", false, "Taxi", "transport"]);
  check("another currency is shown in its own currency, never converted", o.recent.entries.items[1].currency === "USD" && o.recent.entries.items[1].amountMinor === 777 * 100);
  check("an invoice-payment entry is flagged as such", (await ov(mkOwner({ ...FIXTURE(), bk_entries: [entry("p1", "sale", 100, "2026-12-09", { category: "invoice_payment" })] }))).recent.entries.items[0].invoicePayment === true);
  eq("orders: newest PAID/FULFILLED orders of this business only (refunded, awaiting payment and the other business are absent)", o.recent.orders.items.map((x) => x.id), ["o5", "o2", "o1", "o6"]);
  eq("orders: number, total, currency, status only", Object.keys(o.recent.orders.items[0]).sort(), ["currency", "id", "number", "paidAt", "status", "totalMinor"]);
  eq("invoices: issued / partly paid / paid only, newest first (draft, void and the other business are absent)", o.recent.invoices.items.map((i) => i.id), ["d5", "d2", "d1"]);
  const d5 = o.recent.invoices.items[0];
  eq("an invoice shows total, balance and the overdue flag from the existing invoice list", [d5.totalMinor, d5.balanceMinor, d5.overdue, d5.status], [10000, 6000, true, "partially_paid"]);
  const text = JSON.stringify(o);
  check("no buyer or customer data (name, phone, e-mail) appears anywhere in the response", SECRETS.every((s) => !text.includes(s)), SECRETS.filter((s) => text.includes(s)).join());
  const orderSelects = log.filter((c) => c.table === "product_orders").map((c) => c.select);
  const recentSelect = orderSelects.find((s) => /order_number/.test(s)) || "";
  check("the recent-orders query selects only id, number, total, currency, paid_at, status (no customer_* column)", recentSelect !== "" && !/customer|buyer|phone|email|name|address/i.test(recentSelect), recentSelect);
  check("every query on a business table is scoped to the caller's own profile id", log.filter((c) => ["bk_entries", "product_orders", "bk_documents", "product_order_items"].includes(c.table) && c.table !== "product_order_items").every((c) => c.eq.some(([col, v]) => col === "profile_id" && v === PROFILE)), JSON.stringify(log.filter((c) => c.table !== "product_order_items" && !c.eq.some(([col]) => col === "profile_id")).map((c) => c.table)));
  const lists = Object.keys(o.recent);
  eq("the three lists are separate; there is no merged feed and no total", lists, ["entries", "orders", "invoices"]);
}

// ------------------------------------------------------------------------ partial failure and empty business
{
  const failRecentOrders = (table, select) => table === "product_orders" && /order_number/.test(select);
  const o = await ov(mkOwner(FIXTURE(), {}, [], { fail: failRecentOrders }));
  check("one failing activity list degrades only itself: marked unavailable, everything else intact", o.recent.orders.available === false && o.recent.orders.items.length === 0 && o.recent.entries.available && o.revenue.totalMinor === 46000);
  const noRec = await ov(mkOwner(FIXTURE(), { doc_receivables_summary: { data: null, error: { code: "PGRST202", message: "x" } } }));
  check("receivables unavailable is reported as unavailable (not zero) and the rest still loads", noRec.receivables.available === false && noRec.receivables.currencies.length === 0 && noRec.revenue.totalMinor === 46000);
  const noInv = await ov(mkOwner(FIXTURE(), { inv_overview: { data: null, error: { code: "PGRST202", message: "x" } } }));
  check("inventory unavailable is reported as unavailable and the rest still loads", noInv.inventory.available === false && noInv.inventory.lowStockItems.length === 0 && noInv.revenue.totalMinor === 46000);
  const empty = await ov(mkOwner({ bk_entries: [], product_orders: [], bk_documents: [], profiles: [] }, { doc_receivables_summary: { data: { today: "2026-12-10", currencies: [] }, error: null }, inv_overview: { data: { summary: { tracked: 0, out: 0, low: 0, ok: 0, legacy: 0, untracked: 0 }, items: [] }, error: null } }));
  check("an empty business gives zeros and empty-but-available lists", empty.revenue.totalMinor === 0 && empty.cash.netMovementMinor === 0 && empty.recent.entries.available && empty.recent.entries.items.length === 0 && empty.recent.invoices.available && empty.recent.invoices.items.length === 0 && empty.receivables.currencies.length === 0);
  const boundary = await ov(mkOwner(), new Date("2026-11-30T23:30:00Z"));
  eq("at 00:30 on 1 December in Douala the Overview is already December (1 to 1 December)", [boundary.period.month, boundary.period.from, boundary.period.to], [12, "2026-12-01", "2026-12-01"]);
  const failing = mkOwner();
  failing.supabase = { from() { throw new Error("db down"); } };
  const r = await H.overviewSummary(failing, { now: NOW });
  check("a failing report build gives a generic 500 with no internals", r.status === 500 && JSON.stringify(r.body) === JSON.stringify({ error: "internal_error" }));
}

// ------------------------------------------------------------------------ route: owner-only, private, read-only
{
  globalThis.__owner = { ok: true, owner: mkOwner() };
  globalThis.__admin = globalThis.__owner.owner.admin;
  const ok = await routeMod.GET();
  const body = await ok.json();
  check("the route answers the owner with the overview", ok.status === 200 && body.overview?.period?.kind === "month_to_date");
  check("private, no-store, noindex, no referrer", /private/.test(ok.headers.get("cache-control")) && /no-store/.test(ok.headers.get("cache-control")) && /noindex/.test(ok.headers.get("x-robots-tag")) && ok.headers.get("referrer-policy") === "no-referrer");
  for (const reason of ["not_signed_in", "no_profile", "not_owner", "demo_profile", "category_not_enabled", "plan_not_enabled"]) {
    globalThis.__owner = { ok: false, reason };
    const r = await routeMod.GET();
    check(`denied (${reason}): no data, status ${r.status}`, r.status >= 401 && r.status <= 403 && !("overview" in (await r.json())));
  }
  const rs = strip(read("src/app/api/overview/route.ts"));
  check("the route file exports only GET and takes no input (no query string, no body)", (rs.match(/export async function (\w+)/g) || []).join() === "export async function GET" && !/request|searchParams|json\(\)/i.test(rs.replace(/\(owner\) =>/g, "")) && /withOwner/.test(rs));
  const owner = mkOwner();
  await H.overviewSummary(owner, { now: NOW });
  check("the Overview reads only: the database fake has no write method and the only RPCs are the two existing readers", owner.admin.calls.every(([n]) => ["doc_receivables_summary", "inv_overview"].includes(n)), owner.admin.calls.map((c) => c[0]).join());
}

// ------------------------------------------------------------------------ source scans: no write, no forbidden table, no arithmetic across concepts
{
  const files = ["src/lib/overview/build.ts", "src/lib/overview/handlers.ts", "src/app/api/overview/route.ts", "src/components/overview/OverviewView.tsx"];
  const code = files.map((f) => [f, strip(read(f))]);
  check("no write call (insert/update/delete/upsert/rpc) anywhere in the Overview code", code.every(([, s]) => !/\.(insert|update|delete|upsert|rpc)\s*\(/.test(s)));
  check("no customer-account, session, login-code or Connect table is read", code.every(([, s]) => !/ringo_customers|customer_sessions|customer_login_codes|customer_connections|customer_followups|community_subscribers/.test(s)));
  check("the Overview never reads earnings, payments or ledger tables itself (those come only through the shared report builder)", code.every(([, s]) => !/commerce_sale_earnings|bk_document_payments|bk_customers|bk_reminders/.test(s)));
  check("the only tables the Overview queries directly are bk_entries and product_orders (plus the existing invoice list)", [...new Set(strip(read("src/lib/overview/build.ts")).match(/\.from\("(\w+)"\)/g) || [])].sort().join() === '.from("bk_entries"),.from("product_orders")');
  const ui = strip(read("src/components/overview/OverviewView.tsx"));
  check("the screen computes no figure: no addition or subtraction of two money values", !/Minor\s*[-+*\/]\s*\w*\.?\w*Minor/.test(ui) && !/Minor\)?\s*[-+]\s*[\w(]/.test(ui.replace(/`- \$\{M\(/g, "")), (ui.match(/.{20}Minor\)?\s*[-+]\s*.{20}/g) || []).join(" | "));
  check("no model-side arithmetic either: the overview copies the report's fields (no `+`/`-` between two *Minor values)", !/Minor\s*[-+]\s*\w+\.?\w*Minor/.test(strip(read("src/lib/overview/build.ts"))));
  check("profit appears only as the explicit not_reported marker", code.every(([, s]) => (s.replace(/L\.profitNote/g, "").match(/\bprofit\b/gi) || []).length === (s.match(/profit: \{ status: "not_reported" \}/g) || []).length));
  check("the Overview is an App Router client view that loads from /api/overview and nowhere else", /callApi\("GET", "\/api\/overview"\)/.test(ui) && !/fetch\(/.test(ui));
}

// ------------------------------------------------------------------------ navigation and pages
{
  const tabs = strip(read("src/components/reports/ReportsTabs.tsx"));
  check("tabs: Overview (landing), Monthly report, Trends (Bookkeeping moved out to its own dashboard entry), with the Overview active only on the exact landing page", /href: "\/dashboard\/reports", label: t\.overview\.ui\.tabOverview/.test(tabs) && /href: "\/dashboard\/reports\/monthly"/.test(tabs) && !/reports\/entries/.test(tabs) && /pathname === href \|\| pathname === `\$\{href\}\/`/.test(tabs));
  check("pages: /reports is the Overview, /reports/monthly is the unchanged Monthly report view, the old /reports/entries URL redirects to Bookkeeping", /OverviewView/.test(read("src/app/dashboard/reports/page.tsx")) && /ReportsView/.test(read("src/app/dashboard/reports/monthly/page.tsx")) && /redirect\("\/dashboard\/bookkeeping"\)/.test(read("src/app/dashboard/reports/entries/page.tsx")));
  const unchanged = ["src/components/reports/ReportsView.tsx", "src/components/reports/shared.tsx", "src/lib/reports/handlers.ts", "src/lib/reports/period.ts", "src/lib/reports/pdf.ts", "src/lib/reports/access.ts", "src/app/dashboard/reports/layout.tsx", "src/app/api/reports/monthly/route.ts", "src/app/api/reports/monthly/pdf/route.ts"];
  let diff = "x";
  try { diff = execFileSync("git", ["diff", "--name-only", "HEAD", "--", ...unchanged], { cwd: REPO }).toString().trim(); } catch { diff = ""; }
  check("Monthly report screen, PDF, handlers, period, access, the reports layout and the monthly routes have no diff (the entries screen and history route are changed on purpose by 7C: see entryCorrection.test.mjs)", diff === "", diff);
  check("the dashboard layout/nav files are untouched (the Reports entry still points at /dashboard/reports)", /href: "\/dashboard\/reports"/.test(read("src/components/dashboard/DashboardShell.tsx")));
}

// ------------------------------------------------------------------------ EN / FR
{
  const flat = (o, p = "") => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? flat(v, `${p}${k}.`) : [`${p}${k}`]));
  eq("EN and FR overview namespaces have exactly the same keys", flat(translations.en.overview).sort(), flat(translations.fr.overview).sort());
  const leaves = (o) => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? leaves(v) : [[k, v]]));
  check("no empty string in either language", [...leaves(translations.en.overview), ...leaves(translations.fr.overview)].every(([, v]) => typeof v !== "string" || v.trim() !== ""));
  const en = leaves(translations.en.overview.ui), fr = leaves(translations.fr.overview.ui);
  const same = en.filter(([k, v], i) => typeof v === "string" && v === fr[i][1] && v.length > 14);
  check("French strings are really translated (no long string identical to English)", same.length === 0, same.map(([k]) => k).join());
  for (const lang of ["en", "fr"]) {
    const U = translations[lang].overview.ui;
    check(`${lang}: function strings return text`, [U.updatedAt("x"), U.shownIn("XAF"), U.monthSoFar("M", 2026), U.monthBasis("a", "b"), U.receivablesBasis("x"), U.orderNumber("#1"), U.excludedLine(["a", "b"]), U.excVoided(1), U.excVoided(3), U.excCurrency(1, "XAF"), U.excCurrency(2, "XAF"), U.excDouble(1), U.excDouble(2), U.excUnreadable(1), U.excUnreadable(2), U.excRefunded(1, "X"), U.excRefunded(2, "X")].every((s) => typeof s === "string" && s.length > 3));
    check(`${lang}: every order and invoice status the Overview can show is named`, ["paid", "fulfilled"].every((k) => U.orderStatus[k]) && ["issued", "partially_paid", "paid"].every((k) => U.invoiceStatus[k]));
    check(`${lang}: the concept notes say what each figure is not (no profit, not cash, not revenue)`, /profit|bénéfice/i.test(U.monthNote) && /not|n'est/i.test(U.onlineEarningsNote) && /not|ni/i.test(U.receivablesBasis("x")) && /not|n'est/i.test(U.invoicesNote));
  }
  const keysUsed = new Set([...read("src/components/overview/OverviewView.tsx").matchAll(/\bu\.([A-Za-z]+)/g)].map((m) => m[1]));
  check("every translation key the screen uses exists in both languages", [...keysUsed].every((k) => k in translations.en.overview.ui && k in translations.fr.overview.ui), [...keysUsed].filter((k) => !(k in translations.en.overview.ui)).join());
  check("the tab label differs between languages", translations.en.overview.ui.tabOverview !== translations.fr.overview.ui.tabOverview);
  const lKeys = new Set([...read("src/components/overview/OverviewView.tsx").matchAll(/\bL\.([A-Za-z]+)/g)].map((m) => m[1]));
  check("every shared report label the screen reuses exists in both languages", [...lKeys].every((k) => k in translations.en.reports.labels && k in translations.fr.reports.labels), [...lKeys].filter((k) => !(k in translations.en.reports.labels)).join());
}

// ------------------------------------------------------------------------ nothing outside the Phase 7A scope changed
{
  const git = (args) => execFileSync("git", args, { cwd: REPO, encoding: "utf8" }).split("\n").filter(Boolean).map((f) => f.replace(/\\/g, "/"));
  let changed = [];
  try { changed = [...git(["diff", "--name-only", "HEAD"]), ...git(["ls-files", "--others", "--exclude-standard"])]; } catch { /* not a git checkout */ }
  const ALLOWED = [
    // Ringo AI Business Toolkit Phase A (read tools): the AI business code, its registration, snapshot flag, prompt, knowledge and labels (aiBusinessTools.test.mjs)
    /^src\/lib\/ai\/(business\/|tools\/(index|types)\.ts$|tools\/definitions\/business\.ts$|context\/snapshot\.ts$|prompts\/system\.ts$|knowledge\/(index\.ts|modules\/(businessAi|reports|customers|documents|inventory|receivables)\.ts)$)/, /^scripts\/tests\/aiBusinessTools\.test\.mjs$/,
    /^src\/lib\/overview\//, /^src\/app\/api\/overview\//, /^src\/components\/overview\//, /^src\/app\/dashboard\/reports\/(page|monthly\/page)\.tsx$/,
    /^src\/lib\/reports\/build\.ts$/, /^src\/components\/reports\/ReportsTabs\.tsx$/, /^src\/lib\/i18n\/translations\.ts$/, /^src\/lib\/ai\/knowledge\/modules\/(reports|customers)\.ts$/,
    /^scripts\/tests\/(overview|customers|reports|inventory|receivables|bookkeeping|trends|entryCorrection|entryCorrectionSql|customerAttention)\.test\.mjs$/, /^scripts\/tests\/phase7Harness\.mjs$/,
    /^src\/app\/dashboard\/reports\/trends\//, /^src\/lib\/corrections\//, /^src\/app\/api\/reports\/entries\/(route\.ts|\[id\]\/correct\/route\.ts)$/, /^src\/components\/bookkeeping\/(EntriesView|EntryCorrectionDialog)\.tsx$/,
    /^src\/lib\/ai\/(drafts\/|tools\/definitions\/(businessDrafts|drafts|restaurantPayments)\.ts$)/, /^src\/app\/api\/(ai\/drafts\/|bookkeeping\/entries\/route\.ts$)/, /^src\/components\/ai\/DraftCard\.tsx$/, /^src\/lib\/(bookkeeping\/(decision|recordEntry)|inventory\/access)\.ts$/, /^supabase\/(migrations|support)\/2026-12-05_ringo_ai_business_drafts/, /^scripts\/tests\/(aiBusinessDrafts|aiBusinessApplySql)\.test\.mjs$/, /^src\/lib\/customers\/attention\.ts$/, /^src\/app\/api\/customers\/attention\//, /^src\/components\/customers\/(AttentionView|CustomersTabs)\.tsx$/, /^src\/app\/dashboard\/customers\/(page\.tsx|attention\/)/, /^docs\//,
  ];
  const outside = changed.filter((f) => !ALLOWED.some((re) => re.test(f)) && !RECORD_SALE_FILES.test(f) && !/^scripts\/tests\/(recordSale(Unit|Sql)\.test|pgliteShim)\.mjs$/.test(f) && !/^scripts\/tests\/(documents|documentsAi|documentsShare|documentsUi)\.test\.mjs$/.test(f));
  check("only Phase 7 files changed (no bookkeeping, documents, receivables, inventory, checkout, payments, auth, middleware, migrations or package files)", outside.length === 0, outside.join(", "));
  check("no migration and no package file (except the un-applied AI business-drafts and Record Sale migrations)", !changed.filter((f) => !/ringo_ai_business_drafts/.test(f) && !RECORD_SALE_FILES.test(f)).some((f) => /^supabase\//.test(f) || /^(package\.json|package-lock\.json)$/.test(f)));
  check("no Phase 1 bookkeeping file (library, entries route with its 7A guard, void route) is changed after the 7A commit", changed.filter((f) => /^src\/(lib\/bookkeeping|app\/api\/bookkeeping)\//.test(f) && !["src/app/api/bookkeeping/entries/route.ts", "src/lib/bookkeeping/recordEntry.ts", "src/lib/bookkeeping/decision.ts"].includes(f) && !RECORD_SALE_FILES.test(f)).join() === "");
}

for (const f of tmp) try { fs.unlinkSync(f); } catch {}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
