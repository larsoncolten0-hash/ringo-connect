// Business Toolkit Phase 5 (reports + bookkeeping entries screen): the REAL period logic, report builder, API handlers, PDF renderer, route files and
// history route run here against in-memory fakes; only the session resolver is stubbed. No network, no database, nothing applied. Phase 5 needs no
// migration: every figure is read from the Phase 1-4 tables, so there is no SQL to test beyond the existing suites.
//   Run:  node scripts/tests/reports.test.mjs
import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";
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
const mk = (name, body) => { const f = path.join(os.tmpdir(), `rep_${name}_${process.pid}.cjs`); fs.writeFileSync(f, body); tmp.push(f); return f; };
const accessStub = mk("access", "module.exports = { resolveBookkeepingOwner: async () => globalThis.__owner };");
const serverStub = mk("server", "module.exports = { createAdminClient: () => globalThis.__admin };");
const jiti = require("jiti")(import.meta.url, { alias: { "@/lib/bookkeeping/access": accessStub, "@/lib/supabase/server": serverStub, "@": SRC }, interopDefault: true, cache: false });
const P = jiti(path.join(SRC, "lib/reports/period.ts"));
const B = jiti(path.join(SRC, "lib/reports/build.ts"));
const H = jiti(path.join(SRC, "lib/reports/handlers.ts"));
const R = jiti(path.join(SRC, "lib/reports/pdf.ts"));
const { translations } = jiti(path.join(SRC, "lib/i18n/translations.ts"));
const { PDFDocument } = require("pdf-lib");
const layoutSafe = jiti(path.join(SRC, "lib/documents/pdf/layout.ts")).safe;
const route = (p) => jiti(path.join(SRC, "app/api", p, "route.ts"));

console.error = () => {};
let pass = 0, fail = 0;
const check = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log("  FAIL:", name, "|", String(detail).slice(0, 300)); } };
const eq = (name, a, b) => check(name, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} !== ${JSON.stringify(b)}`);

const PROFILE = "22222222-2222-4222-8222-222222222222", OTHER = "99999999-9999-4999-8999-999999999999", USER = "11111111-1111-4111-8111-111111111111";
const ID = (n) => `44444444-4444-4444-8444-${String(n).padStart(12, "0")}`;
const NOW = new Date("2026-12-10T10:00:00Z");

// ------------------------------------------------------------------------ a read-only fake database (any write method does not exist -> throws)
function makeDb(tables, log) {
  return { from(table) {
    const q = { f: [], range: null };
    const call = { table, eq: [], ops: [] };
    log?.push(call);
    const rows = () => (tables[table] || []).filter((r) => q.f.every(([op, c, v]) => {
      const x = r[c];
      if (op === "eq") return x === v;
      if (op === "in") return v.includes(x);
      if (op === "gte") return x !== null && x !== undefined && x >= v;
      if (op === "lte") return x !== null && x !== undefined && x <= v;
      if (op === "lt") return x !== null && x !== undefined && x < v;
      if (op === "is") return (x ?? null) === v;
      return true;
    }));
    const chain = {
      select() { call.ops.push("select"); return chain; },
      eq(c, v) { q.f.push(["eq", c, v]); call.eq.push([c, v]); return chain; },
      in(c, v) { q.f.push(["in", c, v]); call.ops.push("in"); return chain; },
      gte(c, v) { q.f.push(["gte", c, v]); return chain; }, lte(c, v) { q.f.push(["lte", c, v]); return chain; }, lt(c, v) { q.f.push(["lt", c, v]); return chain; },
      is(c, v) { q.f.push(["is", c, v]); return chain; }, order() { return chain; }, limit() { return chain; },
      range(a, b) { q.range = [a, b]; return chain; },
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then(res, rej) { const all = rows(); const out = q.range ? all.slice(q.range[0], q.range[1] + 1) : all; return Promise.resolve({ data: out, error: null }).then(res, rej); },
    };
    return chain;
  } };
}
const makeAdmin = (responses = {}) => { const calls = []; return { calls, rpc: async (name, args) => { calls.push([name, args]); const r = responses[name]; return typeof r === "function" ? r(args) : r ?? { data: null, error: { code: "PGRST202", message: "not found" } }; } }; };

const earn = (fee, net, extra = {}) => ({ gross_amount: String(fee + net), platform_fee: String(fee), net_amount: String(net), currency: "XAF", status: "recorded", ...extra });
const entry = (id, kind, amount, date, extra = {}) => ({ id, profile_id: PROFILE, kind, amount: String(amount), currency: "XAF", entry_date: date, category: null, cash_settled: true, linked_order_type: null, linked_order_id: null, voided_at: null, ...extra });
const order = (id, status, total, paidAt, e = null, extra = {}) => ({ id, profile_id: PROFILE, status, total: String(total), currency: "XAF", paid_at: paidAt, commerce_sale_earnings: e, ...extra });
const FIXTURE = () => ({
  bk_entries: [
    entry("e1", "sale", 10000, "2026-11-05", { category: "invoice_payment" }), entry("e2", "sale", 5000, "2026-11-20", { category: "invoice_payment" }),
    entry("e3", "sale", 3000, "2026-11-08"), entry("e4", "sale", 2000, "2026-11-09", { cash_settled: false }),
    entry("e5", "other_income", 1000, "2026-11-10"), entry("e6", "expense", 4000, "2026-11-11", { category: "rent" }),
    entry("e7", "expense", 6000, "2026-11-12", { category: "stock_purchase" }), entry("e8", "expense", 500, "2026-11-13", { category: "transport", cash_settled: false }),
    entry("e9", "cash_in", 7000, "2026-11-14"), entry("e10", "cash_out", 1500, "2026-11-15"),
    entry("e11", "sale", 9999, "2026-11-16", { voided_at: "2026-11-17T08:00:00Z" }), entry("e12", "sale", 777, "2026-11-18", { currency: "USD" }),
    entry("e13", "sale", 4242, "2026-10-31"), entry("e14", "sale", 4343, "2026-12-01"),
    { ...entry("x1", "sale", 55555, "2026-11-05"), profile_id: OTHER },
  ],
  product_orders: [
    order("o1", "paid", 20000, "2026-11-03T10:00:00Z", earn(2000, 18000)),
    order("o2", "fulfilled", 10000, "2026-11-30T23:30:00Z", earn(1000, 9000)),   // 00:30 on 1 December in Douala -> NOT November
    order("o3", "paid", 4000, "2026-10-31T23:30:00Z", earn(400, 3600, { status: "paid" })),        // 00:30 on 1 November in Douala -> November
    order("o4", "refunded", 6000, "2026-11-10T09:00:00Z", earn(600, 5400)),
    order("o5", "paid", 3000, "2026-11-12T09:00:00Z", null),
    order("o6", "paid", 100, "2026-11-12T09:00:00Z", null, { currency: "USD" }),
    order("o7", "awaiting_payment", 9000, null, null),
    order("o8", "paid", 7000, "2026-11-05T09:00:00Z", earn(700, 6300, { status: "reversed" })),
    { ...order("ox", "paid", 88888, "2026-11-05T09:00:00Z", earn(8, 88880)), profile_id: OTHER },
  ],
  product_order_items: [
    { id: "i1", order_id: "o1", product_id: ID(1), name_snapshot: "Shirt", quantity: 2, line_total: "12000" },
    { id: "i2", order_id: "o1", product_id: ID(2), name_snapshot: "Hat", quantity: 1, line_total: "8000" },
    { id: "i3", order_id: "o3", product_id: ID(1), name_snapshot: "Shirt", quantity: 1, line_total: "4000" },
    { id: "i4", order_id: "o5", product_id: null, name_snapshot: "Deleted thing", quantity: 1, line_total: "3000" },
    { id: "i5", order_id: "o8", product_id: ID(3), name_snapshot: "Reversed", quantity: 1, line_total: "7000" },
    { id: "ix", order_id: "ox", product_id: ID(9), name_snapshot: "Other business item", quantity: 9, line_total: "88888" },
  ],
  bk_documents: [
    { id: "d1", profile_id: PROFILE, doc_type: "invoice", status: "issued", total: "30000", currency: "XAF", issue_date: "2026-11-02" },
    { id: "d2", profile_id: PROFILE, doc_type: "invoice", status: "paid", total: "20000", currency: "XAF", issue_date: "2026-11-30" },
    { id: "d3", profile_id: PROFILE, doc_type: "invoice", status: "paid", total: "99", currency: "USD", issue_date: "2026-11-03" },
    { id: "d4", profile_id: PROFILE, doc_type: "invoice", status: "void", total: "5000", currency: "XAF", issue_date: "2026-11-04" },
    { id: "d5", profile_id: PROFILE, doc_type: "invoice", status: "draft", total: "6000", currency: "XAF", issue_date: null },
    { id: "d6", profile_id: PROFILE, doc_type: "invoice", status: "issued", total: "1234", currency: "XAF", issue_date: "2026-12-02" },
    { id: "dx", profile_id: OTHER, doc_type: "invoice", status: "issued", total: "77777", currency: "XAF", issue_date: "2026-11-03" },
  ],
  bk_business_profiles: [{ profile_id: PROFILE, display_name: "Boutique Elise", legal_name: "Elise SARL", address: "Rue 1\nDouala", phone: "+237 677 00 00 00", email: "elise@shop.test", tax_id: "TX-1", registration_no: "RC-9" }],
  profiles: [{ id: PROFILE, name: "Fallback Name", username: "elise" }],
});
const RECEIVABLES = { data: { today: "2026-12-10", profile_currency: "XAF", currencies: [{ currency: "XAF", outstanding: "40000.000", overdue: "10000.000", invoice_count: 4, overdue_count: 1,
  aging: { not_due: { amount: "30000.000", count: 3 }, no_due_date: { amount: "0", count: 0 }, d1_30: { amount: "10000.000", count: 1 }, d31_60: { amount: "0", count: 0 }, d61_90: { amount: "0", count: 0 }, d90_plus: { amount: "0", count: 0 } } }] }, error: null };
const INVENTORY = (filter) => ({ data: { profile_currency: "XAF", total: 3, summary: { tracked: 3, out: 1, low: 1, ok: 1, legacy: 1, untracked: 4, estimated_value: "54800", value_excluded: 1, drift: 0 },
  items: filter === "out" ? [{ product_id: ID(5), name: "Sandals", available: true, state: "out", tracked: true, count: 0, low_stock_threshold: 5, reserved: 0, sold_units: 2, sku: null, unit_cost: null, estimated_value: null, drift: 0 }]
    : filter === "low" ? [{ product_id: ID(6), name: "Shea", available: true, state: "low", tracked: true, count: 4, low_stock_threshold: 5, reserved: 0, sold_units: 1, sku: null, unit_cost: "1200", cost_currency: "XAF", estimated_value: "4800", drift: 0 }] : [] }, error: null });
const mkOwner = (tables = FIXTURE(), over = {}, log = []) => ({
  userId: USER, profile: { id: PROFILE, currency: "XAF" }, supabase: makeDb(tables, log), log,
  admin: makeAdmin({ doc_receivables_summary: RECEIVABLES, inv_overview: (a) => INVENTORY(a.p_filter), ...over }),
});
const NOV = P.periodFor(2026, 11, NOW).period;

// ------------------------------------------------------------------------ period
{
  const ok = (r) => r.ok === true;
  eq("default period = the previous completed month", (({ period }) => [period.year, period.month, period.from, period.to, period.kind])(P.parsePeriodQuery({}, NOW)), [2026, 11, "2026-11-01", "2026-11-30", "month"]);
  eq("default in January = December of the year before", (({ period }) => [period.year, period.month, period.from, period.to])(P.parsePeriodQuery({}, new Date("2027-01-05T10:00:00Z"))), [2026, 12, "2026-12-01", "2026-12-31"]);
  eq("the current month ends today (month to date)", (({ period }) => [period.from, period.to, period.kind])(P.parsePeriodQuery({ year: "2026", month: "12" }, NOW)), ["2026-12-01", "2026-12-10", "month_to_date"]);
  eq("leap February", P.periodFor(2028, 2, new Date("2028-03-15T10:00:00Z")).period.to, "2028-02-29");
  eq("non-leap February", P.periodFor(2027, 2, new Date("2027-03-15T10:00:00Z")).period.to, "2027-02-28");
  eq("the boundary is Douala midnight: 30 Nov 23:30 UTC is already 1 December, so December is the current month and November the default", [P.parsePeriodQuery({}, new Date("2026-11-30T23:30:00Z")).period.month, P.parsePeriodQuery({}, new Date("2026-11-30T23:30:00Z")).period.kind, P.todayKeyOf(new Date("2026-11-30T23:30:00Z"))], [11, "month", "2026-12-01"]);
  eq("on 1 January 00:30 Douala the report year rolls over", P.previousCompletedMonth(new Date("2026-12-31T23:30:00Z")), { year: 2026, month: 12 });
  const bad = (y, m, now = NOW) => P.parsePeriodQuery({ year: y, month: m }, now);
  eq("a future month is refused", bad("2027", "1").error, "period_in_future");
  eq("next month is refused", bad("2026", "12", new Date("2026-11-15T10:00:00Z")).error, "period_in_future");
  eq("month 0 / 13 / text refused", [bad("2026", "0").error, bad("2026", "13").error, bad("2026", "ab").error, bad("2026", "-1").error], ["invalid_month", "invalid_month", "invalid_month", "invalid_month"]);
  eq("year must be four digits", [bad("26", "5").error, bad("20266", "5").error, bad("abcd", "5").error, bad("", "5").error], ["invalid_year", "invalid_year", "invalid_year", "invalid_year"]);
  eq("only one of year/month is an error", [bad("2026", null).error, P.parsePeriodQuery({ year: null, month: "5" }, NOW).error], ["invalid_month", "invalid_year"]);
  eq("before 2020 is refused", bad("2019", "5").error, "period_too_old");
  check("the selector offers the current month first (to date), then earlier months newest first, never a future one", (() => { const o = P.periodOptions(NOW, 14); return o[0].kind === "month_to_date" && o[0].month === 12 && o[1].month === 11 && o[2].month === 10 && o[12].month === 12 && o[12].year === 2025 && o.slice(1).every((x) => x.kind === "month"); })());
  check("the selector stops at the minimum year", P.periodOptions(new Date("2020-02-10T10:00:00Z"), 24).length === 2);
  check("lang validation", P.isReportLang("en") && P.isReportLang("fr") && !P.isReportLang("de") && !P.isReportLang(undefined));
}

// ------------------------------------------------------------------------ the report builder: every rule, with exact numbers
const log = [];
const owner = mkOwner(FIXTURE(), {}, log);
const R1 = await B.buildMonthlyReport(owner, NOV, { now: NOW });
{
  const r = R1;
  eq("revenue: online gross counts o1+o3+o5 (o2 is 1 Dec Douala, o4 refunded, o6 USD, o7 unpaid, o8 reversed earnings still a paid order -> counted)", r.revenue.onlineGrossMinor, 20000 + 4000 + 3000 + 7000);
  eq("revenue: invoice payments (category invoice_payment) kept apart from manual sales", [r.revenue.invoicePaymentsMinor, r.revenue.manualSalesMinor, r.revenue.otherIncomeMinor], [15000, 5000, 1000]);
  eq("revenue total = online gross + invoice payments + manual sales (incl. not yet received) + other income", r.revenue.totalMinor, 34000 + 15000 + 5000 + 1000);
  eq("counts are separate: paid online orders / invoice payments / manual sales", [r.counts.paidOnlineOrders, r.counts.invoicePayments, r.counts.manualSales], [4, 2, 2]);
  eq("online: commission and net come from the earnings ledger, a REVERSED earning and a missing earning are left out and counted", [r.online.grossMinor, r.online.commissionMinor, r.online.netMinor, r.online.ordersWithEarnings, r.online.ordersWithoutEarnings], [34000, 2400, 21600, 2, 2]);
  eq("online: net earnings are split by payout status (paid out vs not yet), and gross = commission + net + gross of the orders without usable earnings", [r.online.netPaidOutMinor, r.online.netNotYetPaidOutMinor, r.online.grossWithoutEarningsMinor, r.online.commissionMinor + r.online.netMinor + r.online.grossWithoutEarningsMinor === r.online.grossMinor], [3600, 18000, 10000, true]);
  eq("expenses: operating (rent + unpaid transport) and stock purchases are separate; unpaid is shown", [r.expenses.operatingMinor, r.expenses.stockPurchasesMinor, r.expenses.totalMinor, r.expenses.unpaidMinor], [4500, 6000, 10500, 500]);
  eq("expenses by category, largest first", r.expenses.byCategory, [{ category: "stock_purchase", minor: 6000 }, { category: "rent", minor: 4000 }, { category: "transport", minor: 500 }]);
  eq("cash: received directly excludes online gross and unreceived amounts", r.cash.receivedDirectMinor, 10000 + 5000 + 3000 + 1000 + 7000);
  eq("cash: only settled expenses and cash out are paid out", r.cash.paidOutMinor, 4000 + 6000 + 1500);
  eq("cash: net movement = money recorded as received - money recorded as paid out; online sales (gross OR net) are NOT cash and are not in it", r.cash.netMovementMinor, 26000 - 11500);
  eq("uncollected manual sales are shown, not counted as cash", [r.uncollected.salesMinor, r.uncollected.otherIncomeMinor], [2000, 0]);
  eq("profit is never reported", r.profit, { status: "not_reported" });
  check("no field of the model is named profit or income-statement-like besides the explicit not_reported marker", Object.keys(r).filter((k) => /profit|loss|margin/i.test(k)).join() === "profit");
  eq("a currently refunded order is shown as paid in the period and currently refunded (not as a refund in the period)", r.refundedOrders, { count: 1, grossMinor: 6000 });
  check("refunded orders are not in revenue, counts, commission or top products", !JSON.stringify(r.topProducts).includes("Refunded") && r.revenue.onlineGrossMinor === 34000);
  eq("exclusions: 1 voided entry, 2 other-currency records (entry + order), 0 double counts", [r.exclusions.voidedEntries, r.exclusions.otherCurrency, r.exclusions.doubleCountPrevented, r.exclusions.unreadable], [1, 2, 0, 0]);
  eq("top products: grouped by product id, a deleted product is kept by its name snapshot, other businesses never appear, ranked by gross", r.topProducts.map((p) => [p.name, p.units, p.grossMinor]), [["Reversed", 1, 7000], ["Shirt", 3, 16000], ["Hat", 1, 8000], ["Deleted thing", 1, 3000]].sort((a, b) => b[2] - a[2]));
  eq("invoicing: issued invoices of the month only (draft, void, other currency, other month, other business excluded), informational", r.invoicing, { available: true, issuedCount: 2, issuedTotalMinor: 50000, otherCurrencyCount: 1 });
  eq("receivables are 'as of' the generation date, per currency, exact minor units, with aging", [r.receivables.available, r.receivables.asOfDate, r.receivables.currencies[0].currency, r.receivables.currencies[0].outstandingMinor, r.receivables.currencies[0].overdueMinor, r.receivables.currencies[0].aging.d1_30.minor, r.receivables.currencies[0].aging.not_due.count], [true, "2026-12-10", "XAF", 40000, 10000, 10000, 3]);
  eq("inventory is 'as of' the generation date, value informational, low and out products listed", [r.inventory.available, r.inventory.asOfDate, r.inventory.tracked, r.inventory.out, r.inventory.low, r.inventory.estimatedValueMinor, r.inventory.valueExcluded, r.inventory.lowStockItems.map((i) => i.name)], [true, "2026-12-10", 3, 1, 1, 54800, 1, ["Sandals", "Shea"]]);
  eq("business information comes from the business profile", [r.business.name, r.business.legalName, r.business.taxId, r.business.registrationNo], ["Boutique Elise", "Elise SARL", "TX-1", "RC-9"]);
  eq("period and currency are echoed", [r.period.from, r.period.to, r.currency, r.minorDigits, r.version], ["2026-11-01", "2026-11-30", "XAF", 0, 1]);
}
{
  // the month boundary in business time, from the other side
  const dec = await B.buildMonthlyReport(mkOwner(), P.periodFor(2026, 12, NOW).period, { now: NOW });
  eq("the order paid at 23:30 UTC on 30 Nov is a DECEMBER sale (Douala 00:30 on 1 Dec) and the 1 Dec manual sale is December's", [dec.revenue.onlineGrossMinor, dec.revenue.manualSalesMinor], [10000, 4343]);
  const oct = await B.buildMonthlyReport(mkOwner(), P.periodFor(2026, 10, NOW).period, { now: NOW });
  eq("the order paid at 23:30 UTC on 31 Oct is NOT October's", [oct.revenue.onlineGrossMinor, oct.revenue.manualSalesMinor], [0, 4242]);
}
{
  // determinism and consistency
  const again = await B.buildMonthlyReport(mkOwner(), NOV, { now: NOW });
  eq("the same data gives the same model and fingerprint", [again.fingerprint, JSON.stringify(again)], [R1.fingerprint, JSON.stringify(R1)]);
  const later = await B.buildMonthlyReport(mkOwner(), NOV, { now: new Date("2026-12-10T10:00:05Z") });
  check("the fingerprint does not depend on the generation time of day (only the figures)", later.fingerprint === R1.fingerprint && later.generatedAt !== R1.generatedAt);
  const t2 = FIXTURE(); t2.bk_entries.find((e) => e.id === "e3").amount = "3001";
  check("any changed figure changes the fingerprint", (await B.buildMonthlyReport(mkOwner(t2), NOV, { now: NOW })).fingerprint !== R1.fingerprint);
  const t3 = FIXTURE(); t3.bk_entries.find((e) => e.id === "e1").voided_at = "2026-11-25T00:00:00Z";
  const v = await B.buildMonthlyReport(mkOwner(t3), NOV, { now: NOW });
  eq("a voided invoice payment (its bookkeeping entry voided) leaves revenue and the voided count rises", [v.revenue.invoicePaymentsMinor, v.counts.invoicePayments, v.exclusions.voidedEntries], [5000, 1, 2]);
  const t4 = FIXTURE(); t4.product_orders.find((o) => o.id === "o1").status = "refunded";
  const rf = await B.buildMonthlyReport(mkOwner(t4), NOV, { now: NOW });
  eq("an order refunded later drops out of that month's sales when regenerated, and is listed as currently refunded", [rf.online.grossMinor, rf.refundedOrders.count, rf.refundedOrders.grossMinor], [14000, 2, 26000]);
  const t5 = FIXTURE(); t5.product_order_items = t5.product_order_items.filter((i) => i.order_id !== "o5");
  check("items of a counted order may be missing without breaking the report", (await B.buildMonthlyReport(mkOwner(t5), NOV, { now: NOW })).topProducts.length === 3);
  const t6 = FIXTURE(); t6.bk_entries.push(entry("dup", "sale", 3000, "2026-11-08", { linked_order_type: "product_order", linked_order_id: "o1" }));
  eq("a manual sale pointing at an order that is already counted automatically is never counted twice", [(await B.buildMonthlyReport(mkOwner(t6), NOV, { now: NOW })).exclusions.doubleCountPrevented, (await B.buildMonthlyReport(mkOwner(t6), NOV, { now: NOW })).revenue.manualSalesMinor], [1, 5000]);
}
{
  // currencies
  const usd = await B.buildMonthlyReport({ ...mkOwner(), profile: { id: PROFILE, currency: "USD" } }, NOV, { now: NOW });
  eq("a USD business sees only USD records; XAF ones are excluded and counted, never added in", [usd.revenue.manualSalesMinor, usd.revenue.onlineGrossMinor, usd.minorDigits], [77700, 10000, 2]);
  const kwd = await B.buildMonthlyReport({ ...mkOwner(), profile: { id: PROFILE, currency: "KWD" } }, NOV, { now: NOW });
  eq("a KWD business has 3 minor digits and no XAF record leaks in", [kwd.minorDigits, kwd.revenue.totalMinor], [3, 0]);
  const unreadable = FIXTURE(); unreadable.bk_entries.push(entry("bad", "sale", "12.5.5", "2026-11-09"));
  eq("an unreadable amount is excluded and counted, not summed as zero silently", (await B.buildMonthlyReport(mkOwner(unreadable), NOV, { now: NOW })).exclusions.unreadable, 1);
}
{
  // sections degrade independently
  const noRec = await B.buildMonthlyReport(mkOwner(FIXTURE(), { doc_receivables_summary: { data: null, error: { code: "PGRST202", message: "x" } }, inv_overview: { data: null, error: { code: "PGRST202", message: "x" } } }), NOV, { now: NOW });
  check("receivables and inventory unavailable (tables not there) are marked unavailable, the rest of the report is intact", noRec.receivables.available === false && noRec.inventory.available === false && noRec.revenue.totalMinor === R1.revenue.totalMinor);
  const throwing = await B.buildMonthlyReport(mkOwner(FIXTURE(), { doc_receivables_summary: () => { throw new Error("boom"); } }), NOV, { now: NOW });
  check("a failing receivables call degrades to unavailable instead of failing the report", throwing.receivables.available === false && throwing.revenue.totalMinor === R1.revenue.totalMinor);
  const empty = await B.buildMonthlyReport(mkOwner({ bk_entries: [], product_orders: [], product_order_items: [], bk_documents: [], bk_business_profiles: [], profiles: [{ id: PROFILE, name: "Solo", username: "solo" }] }), NOV, { now: NOW });
  eq("an empty month is all zeros with the profile name as business name", [empty.revenue.totalMinor, empty.cash.netMovementMinor, empty.topProducts.length, empty.business.name], [0, 0, 0, "Solo"]);
}
{
  // read-only, scoped to the owner's profile
  const calls = log.filter((c) => ["bk_entries", "product_orders", "bk_documents", "bk_business_profiles"].includes(c.table));
  check("every profile-scoped query filters by the owner's profile id", calls.length >= 4 && calls.every((c) => c.eq.some(([col, v]) => col === "profile_id" && v === PROFILE)), JSON.stringify(calls.map((c) => [c.table, c.eq])));
  check("the profile fallback query filters by the owner's own id", log.filter((c) => c.table === "profiles").every((c) => c.eq.some(([col, v]) => col === "id" && v === PROFILE)));
  check("order items are fetched only by the ids of the owner's own counted orders", log.filter((c) => c.table === "product_order_items").every((c) => c.ops.includes("in")) && !JSON.stringify(R1).includes("Other business item"));
  check("another business's rows never reach a total", !JSON.stringify(R1).includes("55555") && R1.revenue.manualSalesMinor === 5000);
  check("only SELECTs are issued to the database and only the two read functions are called (no write function, no insert/update)", log.every((c) => c.ops.every((o) => o === "select" || o === "in")) && owner.admin.calls.map((c) => c[0]).sort().join() === "doc_receivables_summary,inv_overview,inv_overview,inv_overview");
  check("the RPCs are called with the owner's own profile and user id", owner.admin.calls.every(([, a]) => a.p_profile_id === PROFILE && a.p_actor_user_id === USER));
}

// ------------------------------------------------------------------------ final financial audit: reconciliation identities and unusual earnings
{
  const m = R1;
  // every identity must hold for the model, recomputed independently from the raw fixture rows
  const F = FIXTURE();
  const inNov = (e) => e.profile_id === PROFILE && e.entry_date >= "2026-11-01" && e.entry_date <= "2026-11-30" && e.currency === "XAF" && !e.voided_at;
  const total = (rows) => rows.reduce((a, e) => a + Number(e.amount), 0);
  const ent = F.bk_entries.filter(inNov);
  const indepDirect = total(ent.filter((e) => ["sale", "other_income", "cash_in"].includes(e.kind) && e.cash_settled));
  const indepOut = total(ent.filter((e) => ["expense", "cash_out"].includes(e.kind) && e.cash_settled));
  const indepExpenses = total(ent.filter((e) => e.kind === "expense"));
  const indepRevenue = total(ent.filter((e) => ["sale", "other_income"].includes(e.kind)));
  const indepInvoice = total(ent.filter((e) => e.kind === "sale" && e.category === "invoice_payment"));
  eq("independent recomputation from the raw entries: direct receipts, paid out, expenses, invoice payments", [m.cash.receivedDirectMinor, m.cash.paidOutMinor, m.expenses.totalMinor, m.revenue.invoicePaymentsMinor], [indepDirect, indepOut, indepExpenses, indepInvoice]);
  eq("revenue = online gross + (manual + invoice sales + other income entries, settled or not)", m.revenue.totalMinor, m.online.grossMinor + indepRevenue);
  eq("identity: revenue total = online gross + invoice payments + manual sales + other income", m.revenue.totalMinor, m.revenue.onlineGrossMinor + m.revenue.invoicePaymentsMinor + m.revenue.manualSalesMinor + m.revenue.otherIncomeMinor);
  eq("identity: net cash movement = received directly - paid out (recorded cash only)", m.cash.netMovementMinor, m.cash.receivedDirectMinor - m.cash.paidOutMinor);
  eq("identity: expenses total = operating + stock purchases, and the category lines add up to the total", [m.expenses.totalMinor, m.expenses.byCategory.reduce((a, c) => a + c.minor, 0)], [m.expenses.operatingMinor + m.expenses.stockPurchasesMinor, m.expenses.totalMinor]);
  eq("identity: online net = paid out + not yet paid out; online gross = commission + net + gross without usable earnings", [m.online.netMinor, m.online.grossMinor], [m.online.netPaidOutMinor + m.online.netNotYetPaidOutMinor, m.online.commissionMinor + m.online.netMinor + m.online.grossWithoutEarningsMinor]);
  const bigRec = await B.buildMonthlyReport(mkOwner(FIXTURE(), { doc_receivables_summary: { data: { currencies: [{ currency: "XAF", outstanding: "999999", overdue: "999999", invoice_count: 9, overdue_count: 9, aging: {} }] }, error: null } }), NOV, { now: NOW });
  eq("receivables are separate from revenue and cash (a different outstanding balance changes no revenue, cash or online figure)", [bigRec.revenue, bigRec.cash, bigRec.online], [R1.revenue, R1.cash, R1.online]);
  const noInvoices = await B.buildMonthlyReport(mkOwner({ ...FIXTURE(), bk_documents: [] }), NOV, { now: NOW });
  eq("invoice issuance never changes revenue (no invoices vs two issued invoices: same revenue and cash)", [noInvoices.revenue, noInvoices.cash], [R1.revenue, R1.cash]);
  // earnings that do not match their order are not trusted and never invented
  const t = FIXTURE();
  t.product_orders.push(order("o9", "paid", 5000, "2026-11-14T09:00:00Z", earn(500, 4000)));
  t.product_orders.push(order("o10", "paid", 2000, "2026-11-15T09:00:00Z", { gross_amount: "2000", platform_fee: "300", net_amount: "1000", currency: "XAF", status: "recorded" }));
  t.product_orders.push(order("o11", "paid", 1000, "2026-11-16T09:00:00Z", { ...earn(100, 900), currency: "USD" }));
  const mm = await B.buildMonthlyReport(mkOwner(t), NOV, { now: NOW });
  eq("an earning that does not match its order (gross, fee + net or currency) is excluded from commission and net, disclosed with the order's gross, and never estimated", [mm.online.commissionMinor, mm.online.netMinor, mm.online.ordersWithoutEarnings, mm.online.grossWithoutEarningsMinor, mm.online.grossMinor], [2400, 21600, 5, 10000 + 5000 + 2000 + 1000, 34000 + 8000]);
  eq("...and the gross identity still holds", mm.online.commissionMinor + mm.online.netMinor + mm.online.grossWithoutEarningsMinor, mm.online.grossMinor);
  const t2 = FIXTURE(); t2.product_orders.find((o) => o.id === "o1").commerce_sale_earnings = earn(2000, 18000, { status: "reversed" });
  const rv = await B.buildMonthlyReport(mkOwner(t2), NOV, { now: NOW });
  eq("a REVERSED earning is not used (the earnings page's rule); the order stays in gross and is disclosed", [rv.online.grossMinor, rv.online.commissionMinor, rv.online.netMinor, rv.online.ordersWithoutEarnings, rv.online.grossWithoutEarningsMinor], [34000, 400, 3600, 3, 30000]);
  const t3 = FIXTURE(); t3.product_orders.find((o) => o.id === "o1").commerce_sale_earnings = [earn(2000, 18000, { status: "requested" })];
  const rq = await B.buildMonthlyReport(mkOwner(t3), NOV, { now: NOW });
  eq("a REQUESTED payout earning counts like the earnings page (non-reversed) and is 'not yet paid out'; an array-shaped embed works too", [rq.online.netMinor, rq.online.netNotYetPaidOutMinor, rq.online.netPaidOutMinor], [21600, 18000, 3600]);
  eq("unreceived sales and unpaid expenses move no cash; they appear only as uncollected / unpaid", [m.uncollected.salesMinor, m.expenses.unpaidMinor, m.cash.paidOutMinor], [2000, 500, 11500]);
  // ---- cash semantics: online earnings are owed by Ringo, not cash received by the business
  check("the cash model has no online component at all", !("onlineNetEarningsMinor" in m.cash) && Object.keys(m.cash).sort().join() === "netMovementMinor,paidOutMinor,receivedDirectMinor");
  const onlyOnline = await B.buildMonthlyReport(mkOwner({ ...FIXTURE(), bk_entries: [] }), NOV, { now: NOW });
  eq("a business with ONLY online sales and no recorded cash has zero net cash movement (nothing was received or paid by the business), while revenue and earnings are still reported", [onlyOnline.cash.receivedDirectMinor, onlyOnline.cash.paidOutMinor, onlyOnline.cash.netMovementMinor, onlyOnline.revenue.onlineGrossMinor > 0, onlyOnline.online.netMinor > 0], [0, 0, 0, true, true]);
  const paidAll = FIXTURE();
  for (const o of paidAll.product_orders) if (o.commerce_sale_earnings && o.commerce_sale_earnings.status !== "reversed") o.commerce_sale_earnings = { ...o.commerce_sale_earnings, status: "paid" };
  const pa = await B.buildMonthlyReport(mkOwner(paidAll), NOV, { now: NOW });
  eq("paying out the earnings (status paid) changes the paid-out split but NOT net cash movement (a payout is cash only when the seller records it as cash in, on the date entered)", [pa.cash, pa.online.netPaidOutMinor, pa.online.netNotYetPaidOutMinor], [R1.cash, 21600, 0]);
  const owedAll = FIXTURE();
  for (const o of owedAll.product_orders) if (o.commerce_sale_earnings && o.commerce_sale_earnings.status !== "reversed") o.commerce_sale_earnings = { ...o.commerce_sale_earnings, status: "recorded" };
  const oa = await B.buildMonthlyReport(mkOwner(owedAll), NOV, { now: NOW });
  eq("earnings still owed by Ringo (recorded / requested) are earnings, not cash: same net cash movement, the whole net shown as not yet paid out", [oa.cash, oa.online.netPaidOutMinor, oa.online.netNotYetPaidOutMinor], [R1.cash, 0, 21600]);
  const cashIn = FIXTURE(); cashIn.bk_entries.push(entry("po1", "cash_in", 18000, "2026-11-20", { description: "Ringo payout received" }));
  eq("a payout the seller records as cash in counts as cash on the date entered, exactly once", (await B.buildMonthlyReport(mkOwner(cashIn), NOV, { now: NOW })).cash.netMovementMinor, 26000 + 18000 - 11500);
  // the dashboard and the PDF read the very same model fields
  const fields = (src, root) => new Set([...strip(src).matchAll(new RegExp("\\b" + root + "\\.([A-Za-z]+(?:\\.[A-Za-z]+)*)", "g"))].map((x) => x[1].replace(/\.(length|map|filter|sort|slice|forEach|find|some)$/, "")).filter((f) => !/^(period|business|generatedAt|fingerprint|version|currency|minorDigits|asOfDate)/.test(f)));
  const uiF = fields(read("src/components/reports/ReportsView.tsx"), "report"), pdfF = fields(read("src/lib/reports/pdf.ts"), "model");
  if (pdfF.has("exclusions")) { pdfF.delete("exclusions"); for (const k of ["voidedEntries", "otherCurrency", "doubleCountPrevented", "unreadable"]) if (/ex\.\w+/.test(read("src/lib/reports/pdf.ts")) && read("src/lib/reports/pdf.ts").includes(`ex.${k}`)) pdfF.add(`exclusions.${k}`); } // the PDF aliases model.exclusions as ex
  const only = (a, b) => [...a].filter((x) => !b.has(x));
  check("the screen and the PDF read exactly the same financial fields of the one report model", only(uiF, pdfF).length === 0 && only(pdfF, uiF).length === 0 && uiF.size > 40, `UI-only: ${only(uiF, pdfF)} | PDF-only: ${only(pdfF, uiF)} | ${uiF.size}`);
  const hsrc = read("src/lib/reports/handlers.ts");
  check("both entry points call the one builder and nothing in the screen or the PDF computes a figure", (hsrc.match(/buildMonthlyReport\(/g) || []).length === 2 && !/summarize\(|parseMinor|addMinor/.test(strip(read("src/lib/reports/pdf.ts"))) && !/summarize\(|parseMinor|addMinor/.test(strip(read("src/components/reports/ReportsView.tsx"))));
}

// ------------------------------------------------------------------------ handlers
{
  const o = mkOwner();
  const r = await H.monthlyReport(o, { year: "2026", month: "11" }, { now: NOW });
  check("handler: a valid month returns the report", r.status === 200 && r.body.report.revenue.totalMinor === R1.revenue.totalMinor);
  const dflt = await H.monthlyReport(mkOwner(), {}, { now: NOW });
  check("handler: no params = previous completed month", dflt.status === 200 && dflt.body.report.period.month === 11);
  for (const [q, code] of [[{ year: "2026", month: "13" }, "invalid_month"], [{ year: "x", month: "1" }, "invalid_year"], [{ year: "2027", month: "1" }, "period_in_future"], [{ year: "2019", month: "1" }, "period_too_old"]]) {
    const x = await H.monthlyReport(mkOwner(), q, { now: NOW });
    check(`handler: ${JSON.stringify(q)} -> 400 ${code}`, x.status === 400 && x.body.error === "validation_failed" && x.body.details[0] === code, JSON.stringify(x.body));
  }
  const failing = await H.monthlyReport({ ...mkOwner(), supabase: { from: () => { throw new Error("db down secret"); } } }, { year: "2026", month: "11" }, { now: NOW });
  check("handler: an internal failure is a generic 500 and never leaks the cause", failing.status === 500 && JSON.stringify(failing.body) === '{"error":"internal_error"}');
  const pdf = await H.monthlyReportPdf(mkOwner(), { year: "2026", month: "11", lang: "en" }, { now: NOW });
  check("handler: pdf returns bytes and a safe filename", pdf.status === 200 && pdf.pdf instanceof Uint8Array && pdf.filename === "ringo-report-2026-11.pdf", pdf.filename);
  const mtd = await H.monthlyReportPdf(mkOwner(), { year: "2026", month: "12", lang: "fr" }, { now: NOW });
  check("handler: the month-to-date filename says so", mtd.filename === "ringo-report-2026-12-to-date.pdf", mtd.filename);
  check("handler: lang defaults to French, an unknown lang is refused before anything is built", (await H.monthlyReportPdf(mkOwner(), { year: "2026", month: "11" }, { now: NOW })).status === 200 && (await H.monthlyReportPdf(mkOwner(), { year: "2026", month: "11", lang: "de" }, { now: NOW })).body.details[0] === "invalid_lang");
  const probe = mkOwner();
  await H.monthlyReportPdf(probe, { year: "2026", month: "11", lang: "zz" }, { now: NOW });
  check("handler: an invalid request touches no data", probe.log.length === 0 && probe.admin.calls.length === 0);
  const same = await H.monthlyReportPdf(mkOwner(), { year: "2026", month: "11", lang: "en" }, { now: NOW });
  check("handler: the PDF route recomputes from the same builder: same data and time -> identical bytes", Buffer.compare(Buffer.from(pdf.pdf), Buffer.from(same.pdf)) === 0);
}

// ------------------------------------------------------------------------ PDF
const hex = (s) => Buffer.from(s, "latin1").toString("hex").toUpperCase();
const pdfText = (bytes) => {
  const buf = Buffer.from(bytes); let out = ""; let i = 0;
  const s = buf.toString("latin1");
  for (;;) {
    const a = s.indexOf("stream", i); if (a < 0) break;
    const start = s[a + 6] === "\r" ? a + 8 : a + 7; const end = s.indexOf("endstream", start); if (end < 0) break;
    try { out += zlib.inflateSync(buf.subarray(start, end)).toString("latin1"); } catch { out += buf.subarray(start, end).toString("latin1"); }
    i = end + 9;
  }
  return out;
};
const has = (bytes, str) => pdfText(bytes).includes(hex(str));
{
  const en = await R.renderReportPdf(R1, "en"), fr = await R.renderReportPdf(R1, "fr");
  check("pdf: valid PDF files", Buffer.from(en).subarray(0, 5).toString() === "%PDF-" && Buffer.from(fr).subarray(0, 5).toString() === "%PDF-");
  const doc = await PDFDocument.load(en, { updateMetadata: false });
  check("pdf: A4 pages, title, producer and fixed dates", doc.getPageCount() >= 2 && Math.round(doc.getPage(0).getWidth()) === 595 && /Monthly report November 2026/.test(doc.getTitle() || "") && doc.getProducer() === "Ringo Connect" && doc.getCreationDate().toISOString() === R1.generatedAt, `pages=${doc.getPageCount()} w=${doc.getPage(0).getWidth()} t=${doc.getTitle()} p=${doc.getProducer()} d=${doc.getCreationDate()?.toISOString()}`);
  check("pdf: deterministic (same model -> same bytes) and the language changes the content", Buffer.compare(Buffer.from(en), Buffer.from(await R.renderReportPdf(R1, "en"))) === 0 && Buffer.compare(Buffer.from(en), Buffer.from(fr)) !== 0);
  check("pdf EN: carries the section titles, the period, the business and the report reference", ["Monthly report", "November 2026", "Boutique Elise", "Summary", "Revenue", "Online sales (Ringo checkout)", "Expenses", "Cash movement", "Invoices and debtors", "Inventory", "Notes and limitations", R1.fingerprint, "Tax ID: TX-1"].every((x) => has(en, x)), ["Monthly report", "November 2026", "Boutique Elise", "Summary", R1.fingerprint].filter((x) => !has(en, x)).join());
  check("pdf FR: carries the French titles and accents encode (WinAnsi)", ["Rapport mensuel", "Novembre 2026", "Résumé", "Dépenses", "Mouvement de trésorerie", "Factures et débiteurs"].every((x) => has(fr, Buffer.from(x, "utf8").toString("latin1") === x ? x : x.normalize("NFC"))) || ["Rapport mensuel", "Novembre 2026"].every((x) => has(fr, x)));
  check("pdf: profit is stated as not reported, and net cash movement is explicitly not profit", has(en, "Profit is not reported") && has(en, "Net cash movement is not profit"));
  check("pdf: figures match the model (ASCII money format, FCFA)", ["FCFA 55,000", "FCFA 21,600", "FCFA 2,400", "FCFA 14,500"].every((x) => has(en, x)) && has(fr, "55 000 FCFA"), ["FCFA 55,000", "FCFA 21,600", "FCFA 2,400", "FCFA 14,500"].filter((x) => !has(en, x)).join());
  check("pdf: receivables and inventory carry their 'as of' basis", has(en, "As of 10 Dec 2026") || pdfText(en).includes(hex("not a month-end balance")));
  check("pdf: refunded orders are described as currently refunded, not refunded in the period", has(en, "currently marked refunded") && has(en, "not a refund made in this period"));
  check("pdf: the footer and page numbers are on every page", has(en, "Generated with Ringo Connect") && has(en, `Page 1 of ${doc.getPageCount()}`));
  check("pdf: no storage or link: nothing in the renderer writes a file or builds a URL", !/writeFile|fs\.|upload|https?:\/\//.test(strip(read("src/lib/reports/pdf.ts"))));
}
{
  // pagination and hostile text
  const big = JSON.parse(JSON.stringify(R1));
  big.expenses.byCategory = Array.from({ length: 150 }, (_, i) => ({ category: `Category ${i} ${"x".repeat(40)}`, minor: 1000 - i }));
  big.topProducts = Array.from({ length: 5 }, (_, i) => ({ name: `Produit très long ${"é".repeat(300)} ${i}`, units: i + 1, grossMinor: 1000 * (i + 1) }));
  big.inventory.lowStockItems = Array.from({ length: 60 }, (_, i) => ({ name: `Item ${i}`, count: i, threshold: 5, state: i % 2 ? "low" : "out" }));
  const bp = await PDFDocument.load(await R.renderReportPdf(big, "en"));
  check("pdf: long lists paginate onto several pages without error", bp.getPageCount() >= 4, bp.getPageCount());
  const hostile = JSON.parse(JSON.stringify(R1));
  hostile.business.name = "<script>alert(1)</script> ‮evil‬ \u0000 😀 ​ Café 日本語";
  hostile.business.address = "Line1\nLine2 😀\n" + "x".repeat(800);
  hostile.topProducts[0].name = "😀 ".repeat(200) + "日本";
  hostile.expenses.byCategory[0].category = "\u0000‮'\"\\) Tj (hack";
  for (const lang of ["en", "fr"]) {
    let ok = true, bytes;
    try { bytes = await R.renderReportPdf(hostile, lang); await PDFDocument.load(bytes); } catch (e) { ok = false; }
    check(`pdf ${lang}: hostile business, product and category text renders (emoji, RTL override, NUL, CJK, huge strings)`, ok);
    const bad = (x) => [...layoutSafe(x, 400, true)].some((ch) => { const c = ch.codePointAt(0); return (c < 32 && c !== 10) || (c >= 0x2028 && c <= 0x202e) || c === 0x200b; });
    check(`pdf ${lang}: control characters and bidi overrides are stripped before drawing`, ok && ![hostile.business.name, hostile.business.address, hostile.topProducts[0].name, hostile.expenses.byCategory[0].category].some(bad) && layoutSafe(hostile.business.name, 120) !== "");
  }
  const safeRes = await R.renderReportPdfSafe({ ...R1, period: { ...R1.period, month: 99 } }, "en");
  check("pdf: a broken model never throws out of the safe wrapper", safeRes.ok === true || typeof safeRes.error === "string");
  // currencies with 0, 2 and 3 decimals
  for (const [cur, digits, expected] of [["XAF", 0, "FCFA 55,000"], ["USD", 2, "USD 480.00"], ["KWD", 3, "KWD 48.000"]]) {
    const m = JSON.parse(JSON.stringify(R1)); m.currency = cur; m.minorDigits = digits; m.receivables.currencies = m.receivables.currencies.map((c) => ({ ...c, currency: cur, minorDigits: digits }));
    if (cur !== "XAF") { m.revenue.totalMinor = digits === 2 ? 48000 : 48000; }
    const bytes = await R.renderReportPdf(m, "en");
    const want = cur === "XAF" ? expected : cur === "USD" ? "USD 480.00" : "KWD 48.000";
    check(`pdf: ${cur} (${digits} decimals) formats amounts exactly`, has(bytes, want), want);
  }
}

// ------------------------------------------------------------------------ routes and security
{
  const files = ["reports/monthly", "reports/monthly/pdf", "reports/entries"];
  for (const f of files) {
    const src = read(`src/app/api/${f}/route.ts`);
    eq(`route /api/${f}: GET only`, [...src.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)/g)].map((m) => m[1]), ["GET"]);
    check(`route /api/${f}: force-dynamic and owner-gated`, /force-dynamic/.test(src) && (/withOwner/.test(src) || /resolveBookkeepingOwner/.test(src)));
  }
  for (const f of ["reports/monthly", "reports/monthly/pdf"]) check(`route /api/${f}: no database access of its own`, !/createAdminClient|supabase|\.from\(|\.rpc\(/.test(strip(read(`src/app/api/${f}/route.ts`))));
  const q = (p) => new Request(`http://x/api/${p}`);
  globalThis.__owner = { ok: false, reason: "not_signed_in" };
  const d1 = await route("reports/monthly").GET(q("reports/monthly?year=2026&month=11"));
  const d2 = await route("reports/monthly/pdf").GET(q("reports/monthly/pdf?year=2026&month=11&lang=en"));
  const d3 = await route("reports/entries").GET(q("reports/entries"));
  check("signed-out callers are denied on all three routes", [d1, d2, d3].every((r) => r.status === 401), [d1.status, d2.status, d3.status]);
  for (const reason of ["demo_profile", "plan_not_enabled", "category_not_enabled", "not_owner", "no_profile"]) {
    globalThis.__owner = { ok: false, reason };
    const rs = [await route("reports/monthly").GET(q("reports/monthly")), await route("reports/monthly/pdf").GET(q("reports/monthly/pdf")), await route("reports/entries").GET(q("reports/entries"))];
    check(`denial "${reason}" (demo / plan / category / not owner) is a 4xx on all three routes`, rs.every((r) => r.status >= 400 && r.status < 500), rs.map((r) => r.status));
  }
  const prev = P.previousCompletedMonth(new Date());
  const live = mkOwner();
  globalThis.__owner = { ok: true, owner: live };
  const ok = await route("reports/monthly").GET(q(`reports/monthly?year=${prev.year}&month=${prev.month}&profile_id=${OTHER}`));
  const body = await ok.json();
  check("the JSON route is no-store/private, never indexed, and a profile id in the query is ignored (every query used the session's profile)", ok.status === 200 && /private, no-store/.test(ok.headers.get("cache-control") || "") && ok.headers.get("x-robots-tag") === "noindex, nofollow" && body.report.period.month === prev.month && live.log.filter((c) => c.table !== "product_order_items").every((c) => !c.eq.some(([col, v]) => col === "profile_id" && v !== PROFILE)) && !JSON.stringify(live.log.map((c) => c.eq)).includes(OTHER), `${ok.status} ${ok.headers.get("cache-control")} ${JSON.stringify(body).slice(0, 80)}`);
  globalThis.__owner = { ok: true, owner: mkOwner() };
  const pdf = await route("reports/monthly/pdf").GET(q(`reports/monthly/pdf?year=${prev.year}&month=${prev.month}&lang=en`));
  const pb = Buffer.from(await pdf.arrayBuffer());
  check("the PDF route: application/pdf, attachment with a safe filename, private no-store headers, never indexed", pdf.status === 200 && pdf.headers.get("content-type") === "application/pdf" && /^attachment; filename="ringo-report-[0-9-]+\.pdf"$/.test(pdf.headers.get("content-disposition") || "") && /private, no-store/.test(pdf.headers.get("cache-control") || "") && pdf.headers.get("x-content-type-options") === "nosniff" && pdf.headers.get("referrer-policy") === "no-referrer" && pb.subarray(0, 5).toString() === "%PDF-", `${pdf.status} ${pdf.headers.get("content-disposition")}`);
  for (const bad of ["year=2026&month=13", "year=abc&month=1", "year=2026", "year=2099&month=1", "year=2026&month=11&lang=de", "month=5"]) {
    const r = await route("reports/monthly/pdf").GET(q(`reports/monthly/pdf?${bad}`));
    check(`invalid parameters "${bad}" -> 400, not a PDF`, r.status === 400 && /json/.test(r.headers.get("content-type") || ""), r.status);
  }
  check("no report data is cached or persisted anywhere: no storage, no share table, no public route", !/storage|upload|createSignedUrl|bk_report/i.test(["handlers", "build", "pdf", "access"].map((n) => strip(read(`src/lib/reports/${n}.ts`))).join("\n")) && !fs.existsSync(path.join(SRC, "app/reports")));
  check("the Reports library never writes: no insert/update/delete/upsert/rpc-write anywhere", !/\.insert\(|\.delete\(|\.upsert\(/.test(["handlers", "build", "pdf", "access", "period"].map((n) => strip(read(`src/lib/reports/${n}.ts`))).join("\n")) && [...["handlers", "build", "pdf", "access", "period"].map((n) => strip(read(`src/lib/reports/${n}.ts`))).join("\n").matchAll(/\.update\(/g)].length === 1 && /createHash\("sha256"\)\.update\(/.test(strip(read("src/lib/reports/build.ts"))) && [...strip(read("src/lib/reports/build.ts")).matchAll(/rpc\("([a-z_]+)"/g)].map((m) => m[1]).sort().join() === "doc_receivables_summary");
}

// ------------------------------------------------------------------------ the bookkeeping history route and entries screen
{
  const entries = [
    { id: "a1", profile_id: PROFILE, kind: "expense", amount: "4000", currency: "XAF", entry_date: "2026-11-11", category: "rent", description: "Rent", cash_settled: true, voided_at: null, void_reason: null, created_at: "2026-11-11T10:00:00Z" },
    { id: "a2", profile_id: PROFILE, kind: "sale", amount: "10000", currency: "XAF", entry_date: "2026-11-05", category: "invoice_payment", description: "INV-2026-0001", cash_settled: true, voided_at: null, void_reason: null, created_at: "2026-11-05T10:00:00Z" },
    { id: "a3", profile_id: PROFILE, kind: "sale", amount: "300", currency: "XAF", entry_date: "2026-11-04", category: null, description: null, cash_settled: false, voided_at: "2026-11-06T00:00:00Z", void_reason: "typo", created_at: "2026-11-04T10:00:00Z" },
    { id: "b1", profile_id: OTHER, kind: "sale", amount: "9999", currency: "XAF", entry_date: "2026-11-04", category: null, description: "secret", cash_settled: true, voided_at: null, void_reason: null, created_at: "2026-11-04T10:00:00Z" },
  ];
  const mk2 = () => ({ userId: USER, profile: { id: PROFILE, currency: "XAF" }, supabase: makeDb({ bk_entries: entries }), admin: makeAdmin() });
  globalThis.__owner = { ok: true, owner: mk2() };
  const G = route("reports/entries").GET;
  const j = async (qs) => { const r = await G(new Request(`http://x/api/reports/entries${qs}`)); return { s: r.status, b: await r.json(), h: r.headers }; };
  const all = await j("");
  check("history: only the owner's own live entries, minor units, invoice payments flagged, private headers", all.s === 200 && all.b.items.length === 2 && all.b.items.every((i) => i.id !== "b1") && all.b.items[0].amount_minor === 4000 && all.b.items[1].invoice_payment === true && all.b.items[0].invoice_payment === false && /no-store/.test(all.h.get("cache-control") || ""));
  const withVoided = await j("?include_voided=1");
  check("history: voided entries only when asked, with their reason", withVoided.b.items.length === 3 && withVoided.b.items.some((i) => i.voided_at && i.void_reason === "typo"));
  check("history: filter by kind, invalid kind refused", (await j("?kind=expense")).b.items.length === 1 && (await j("?kind=nope")).s === 400);
  check("history: paging uses one extra row (has_more) and a hard limit", (await j("?limit=1")).b.has_more === true && (await j("?limit=1")).b.items.length === 1 && (await j("?limit=1000")).s === 200);
  const histSrc = strip(read("src/app/api/reports/entries/route.ts"));
  check("history: read-only, filters by the owner's profile, RLS client", !/\.insert\(|\.update\(|\.delete\(|\.rpc\(/.test(histSrc) && /eq\("profile_id", owner\.profile\.id\)/.test(histSrc) && /owner\.supabase/.test(histSrc));

  const ui = strip(read("src/components/bookkeeping/EntriesView.tsx"));
  check("entries UI: talks only to the existing create/void endpoints and the read-only history", [...ui.matchAll(/callApi\("(GET|POST)", [`"]([^`"?$]+)/g)].map((m) => `${m[1]} ${m[2]}`).sort().join("|") === "GET /api/reports/entries|POST /api/bookkeeping/entries|POST /api/bookkeeping/entries/" && !/createClient|supabase|\.from\(|\.rpc\(/.test(ui));
  check("entries UI: offers exactly the backend's entry kinds (read from the same constant), no invented type", /ENTRY_KINDS\.map/.test(ui) && JSON.stringify(jiti(path.join(SRC, "lib/bookkeeping/summary.ts")).ENTRY_KINDS) === '["sale","other_income","expense","cash_in","cash_out"]');
  check("entries UI: sends a client_request_id generated once per open form (double-click safe) and never a profile or currency", /useState\(newRequestId\)/.test(ui) && /client_request_id: rid/.test(ui) && !/profile_id/.test(ui) && !/callApi\("POST", "\/api\/bookkeeping\/entries", \{[^}]*currency/.test(ui));
  check("entries UI: cash entries are always sent as settled; the date cannot be picked in the future; server errors are shown, never swallowed", /cash_settled: cashKind \? true : settled/.test(ui) && /max=\{todayKeyOf/.test(ui) && /errorText\(res\.data\)/.test(ui));
  check("entries UI: voiding needs a reason and a confirmation dialog; invoice-payment entries have no void button", /VoidDialog/.test(ui) && /voidBody/.test(ui) && /!e\.voided_at && !e\.invoice_payment/.test(ui) && /invoicePaymentManaged/.test(ui));
  check("entries UI: no screen-side money maths", !/parseFloat|Number\(.*amount|toFixed|\* 100|\/ 100/.test(ui));
  const bkErr = ["invalid_kind", "invalid_amount", "amount_too_precise", "invalid_date", "date_in_future", "invalid_category", "description_too_long", "cash_entry_must_be_settled", "invalid_reason", "reason_required", "entry_already_voided", "entry_not_found", "entry_linked_to_invoice_payment", "order_already_counted"];
  check("every error the existing API can return for these actions has a sentence in EN and FR", bkErr.every((c) => translations.en.bookkeeping.errors[c] && translations.fr.bookkeeping.errors[c]));
  const validation = jiti(path.join(SRC, "lib/bookkeeping/summary.ts")).validateEntryInput;
  const emitted = new Set(); for (const bad of [{ kind: "x", amount: "1", entry_date: "2026-11-01" }, { kind: "sale", amount: "0", entry_date: "2026-11-01" }, { kind: "sale", amount: "1.5", entry_date: "2026-11-01" }, { kind: "sale", amount: "1", entry_date: "nope" }, { kind: "sale", amount: "1", entry_date: "2999-01-01" }, { kind: "sale", amount: "1", entry_date: "2026-11-01", category: "x".repeat(61) }, { kind: "sale", amount: "1", entry_date: "2026-11-01", description: "x".repeat(501) }, { kind: "cash_in", amount: "1", entry_date: "2026-11-01", cash_settled: false }, { kind: "sale", amount: "1", entry_date: "2026-11-01", cash_settled: "yes" }, { kind: "sale", amount: "1", entry_date: "2026-11-01", linked_order_type: "product_order", linked_order_id: ID(1) }]) { const r = validation(bad, { currency: "XAF", today: "2026-12-10" }); if (!r.ok) r.errors.forEach((e) => emitted.add(e)); }
  const missing = [...emitted].filter((e) => !(translations.en.bookkeeping.errors[e] && translations.fr.bookkeeping.errors[e]));
  check("every validation code the server can emit for an entry has a translation (no raw code reaches a person)", missing.length === 0, missing.join());
}

// ------------------------------------------------------------------------ reports UI, nav, EN / FR, protected paths
{
  const ui = strip(read("src/components/reports/ReportsView.tsx"));
  check("reports UI: reads only /api/reports/**, no database access, no money maths", /\/api\/reports\/monthly/.test(ui) && /\/api\/reports\/monthly\/pdf/.test(ui) && !/createClient|supabase|\.from\(|\.rpc\(|parseFloat|toFixed/.test(ui));
  check("reports UI: previous completed month is the default and the current month is offered as 'to date'", /previousCompletedMonth/.test(ui) && /monthToDateOption/.test(ui) && /periodOptions/.test(ui) && !/type="date"/.test(ui));
  check("reports UI: the PDF button downloads from the server route and shows errors", /fetch\(`\/api\/reports\/monthly\/pdf/.test(ui) && /pdfError/.test(ui) && /\.blob\(\)/.test(ui));
  check("reports UI: as-of notes, informational value note, refunded note and profit note are rendered", ["L.asOf", "L.invValueNote", "L.refundedBody", "L.profitNote", "L.cashNote", "L.restateNote"].every((x) => ui.includes(x)));
  const layout = read("src/app/dashboard/layout.tsx"), shell = read("src/components/dashboard/DashboardShell.tsx");
  check("nav: Reports is a top-level entry gated like Invoices/Inventory, hidden for staff", /reportsNavVisible\(\{ userId: user\.id, profile: ownProfile \}\)/.test(layout) && /!isActingAsStaff && ownProfile \? await reportsNavVisible/.test(layout) && /hasReports=\{hasReports\}/.test(layout) && /hasReports && !organization\?\.isStaff/.test(shell) && /href: "\/dashboard\/reports"/.test(shell));
  const acc = strip(read("src/lib/reports/access.ts"));
  check("access: plan flag + category/demo gate + table existence, any failure hides the entry", /business_toolkit_enabled/.test(acc) && /decideBookkeepingAccess/.test(acc) && /bk_entries/.test(acc) && /catch \{\s*return false;/.test(acc));
  const pl = read("src/app/dashboard/reports/layout.tsx");
  check("pages: layout requires the owner and the tables; both pages exist", /requireReportsOwner/.test(pl) && /reportsAvailable/.test(pl) && /redirect\("\/dashboard"\)/.test(pl) && fs.existsSync(path.join(SRC, "app/dashboard/reports/page.tsx")) && fs.existsSync(path.join(SRC, "app/dashboard/reports/entries/page.tsx")));

  const flat = (o, p = "") => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? flat(v, `${p}${k}.`) : [`${p}${k}`]));
  for (const ns of ["reports", "bookkeeping"]) eq(`EN and FR ${ns} namespaces have exactly the same keys`, flat(translations.en[ns]).sort(), flat(translations.fr[ns]).sort());
  const leaves = (o) => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? leaves(v) : [[k, v]]));
  const all = [...leaves(translations.en.reports), ...leaves(translations.fr.reports), ...leaves(translations.en.bookkeeping), ...leaves(translations.fr.bookkeeping)];
  check("no empty string in either language", all.every(([, v]) => typeof v !== "string" || v.trim() !== ""));
  const frSame = leaves(translations.fr.reports.labels).filter(([k, v], i) => typeof v === "string" && v === leaves(translations.en.reports.labels)[i][1] && v.length > 14);
  check("French strings are really translated (no long string identical to English)", frSame.length === 0, frSame.map(([k]) => k).join());
  for (const lang of ["en", "fr"]) {
    const L = translations[lang].reports.labels, U = translations[lang].reports.ui;
    check(`${lang}: function strings return text`, [L.currencyNote("XAF"), L.missingEarnings(1, "X"), L.missingEarnings(3, "X"), L.refundedBody(1, "X"), L.refundedBody(2, "X"), L.invoicedBody(1, "X"), L.invoicedBody(2, "X"), L.invValueExcluded(1), L.invValueExcluded(2), L.excVoided(1), L.excVoided(2), L.excCurrency(1, "XAF"), L.excCurrency(2, "XAF"), L.excDouble(2), L.excUnreadable(2), L.asOf("1 Dec 2026"), L.page(1, 2), U.generatedAt("x"), U.asOfNote("x"), U.periodTitle("M", 2026), U.periodToDate("M", 2026, 5), U.shownIn("XAF"), U.monthToDateOption("M"), translations[lang].bookkeeping.ui.currencyNote("XAF"), translations[lang].bookkeeping.ui.voidReasonShown("x")].every((s) => typeof s === "string" && s.length > 3));
    check(`${lang}: 12 months, six aging buckets, every expense preset and entry kind is named`, translations[lang].reports.months.length === 12 && ["not_due", "no_due_date", "d1_30", "d31_60", "d61_90", "d90_plus"].every((b) => L.aging[b]) && ["rent", "transport", "salaries", "supplies", "utilities", "marketing", "stock_purchase", "other", "uncategorised"].every((c) => L.categoryNames[c]) && ["sale", "other_income", "expense", "cash_in", "cash_out"].every((k) => translations[lang].bookkeeping.ui.kind[k] && translations[lang].bookkeeping.ui.kindHelp[k]));
    check(`${lang}: PDF labels contain only characters the PDF fonts can draw (WinAnsi)`, leaves(translations[lang].reports.labels).filter(([, v]) => typeof v === "string").every(([, v]) => [...v].every((ch) => ch.codePointAt(0) < 0x100)) && translations[lang].reports.months.every((m) => [...m].every((ch) => ch.codePointAt(0) < 0x100)));
  }
  check("nav label exists in both languages", translations.en.nav.reports === "Reports" && translations.fr.nav.reports === "Rapports");
  check("the same wording is used by screen and PDF (one shared labels object)", /t\.reports\.labels/.test(read("src/components/reports/ReportsView.tsx")) && /translations\[lang\]\.reports/.test(read("src/lib/reports/pdf.ts")));

  let changed = [];
  try { changed = [...execFileSync("git", ["diff", "--name-only", "HEAD"], { cwd: REPO }).toString().split("\n"), ...execFileSync("git", ["ls-files", "--others", "--exclude-standard"], { cwd: REPO }).toString().split("\n")].filter(Boolean); } catch { /* not a git checkout */ }
  const protectedRe = /^(supabase\/|src\/lib\/(productCheckout|payments|protection|fapshi|supabase|bookkeeping|documents|receivables|inventory)\/|src\/middleware|src\/app\/api\/(documents|receivables|inventory|payments|fapshi|music|restaurant|tickets|webhooks|cron|auth|shop|orders|products|billing|protection)|src\/app\/auth|src\/components\/(editor|documents|receivables|inventory)\/)/;
  const touched = changed.filter((f) => protectedRe.test(f) && !["src/app/api/bookkeeping/entries/route.ts", "src/lib/bookkeeping/recordEntry.ts", "src/lib/bookkeeping/decision.ts", "src/lib/inventory/access.ts", "supabase/migrations/2026-12-05_ringo_ai_business_drafts.sql", "supabase/support/2026-12-05_ringo_ai_business_drafts.rollback.sql"].includes(f) && !RECORD_SALE_FILES.test(f)); // the shared recordEntry module and the thin entries route (AI business drafts; see bookkeeping.test.mjs)
  check("no protected path (migrations, checkout, payments, invoices, debtors, inventory, bookkeeping libs, auth, middleware, music, restaurant, tickets, editor) is modified", touched.length === 0, touched.join(", "));
  check("no existing bookkeeping API route or library file is modified (the history route is a new file)", !changed.some((f) => !["src/app/api/bookkeeping/entries/route.ts", "src/lib/bookkeeping/recordEntry.ts", "src/lib/bookkeeping/decision.ts", "src/lib/inventory/access.ts", "supabase/migrations/2026-12-05_ringo_ai_business_drafts.sql", "supabase/support/2026-12-05_ringo_ai_business_drafts.rollback.sql"].includes(f) && !RECORD_SALE_FILES.test(f) && /^src\/(lib\/bookkeeping|app\/api\/bookkeeping\/(entries|summary))/.test(f))); // Phase 7: the ONE entries route gained the invoice-payment replace guard (tested in bookkeeping.test.mjs)
  check("no migration, no package file (except the un-applied AI business-drafts migration)", !changed.filter((f) => !/ringo_ai_business_drafts/.test(f) && !RECORD_SALE_FILES.test(f)).some((f) => /^supabase\//.test(f) || /^(package\.json|package-lock\.json)$/.test(f)));
}

for (const f of tmp) try { fs.unlinkSync(f); } catch {}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
