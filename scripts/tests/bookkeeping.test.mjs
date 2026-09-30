// Business Toolkit Phase 1 — bookkeeping. Pure: no network, no database, no payments, nothing applied.
//   Run:  node scripts/tests/bookkeeping.test.mjs
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO, "src");
const jiti = require("jiti")(import.meta.url, { alias: { "@": SRC }, interopDefault: true });
const B = jiti(path.join(SRC, "lib/bookkeeping/summary.ts"));
const M = jiti(path.join(SRC, "lib/bookkeeping/money.ts"));
const { decideBookkeepingAccess, BOOKKEEPING_CATEGORIES } = jiti(path.join(SRC, "lib/bookkeeping/decision.ts"));
const { loadBookkeepingSummary } = jiti(path.join(SRC, "lib/bookkeeping/loader.ts"));
const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8").replace(/\r\n/g, "\n"); // same result on LF and CRLF checkouts
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/--.*$/gm, "");

let pass = 0, fail = 0;
const check = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log("  FAIL:", name, "|", detail); } };
const eq = (name, a, b) => check(name, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} !== ${JSON.stringify(b)}`);

const RANGE = { from: "2026-09-01", to: "2026-09-30", currency: "XAF" };
const E = (o) => ({ id: o.id || Math.random().toString(36).slice(2), kind: "sale", amount: 1000, currency: "XAF", entry_date: "2026-09-10", category: null, cash_settled: true, ...o });
const S = (id, amount, paidAt, currency = "XAF") => ({ id, source: "product_order", amount, currency, paidAt });

// =============================================================== currency precision (money.ts)
{
  eq("XAF has 0 decimals (no cents)", M.currencyMinorDigits("XAF"), 0);
  eq("XOF/JPY 0 decimals", [M.currencyMinorDigits("XOF"), M.currencyMinorDigits("JPY")], [0, 0]);
  eq("USD/EUR/GBP/NGN 2 decimals", ["USD", "EUR", "GBP", "NGN"].map(M.currencyMinorDigits), [2, 2, 2, 2]);
  eq("KWD/BHD/TND 3 decimals", ["KWD", "BHD", "TND"].map(M.currencyMinorDigits), [3, 3, 3]);
  eq("lowercase accepted", M.currencyMinorDigits("xaf"), 0);
  eq("XAF: '12000' / '12000.00' / 12000 are all 12000 minor units", [M.parseMinor("12000", 0), M.parseMinor("12000.00", 0), M.parseMinor(12000, 0)], [12000, 12000, 12000]);
  eq("XAF: a fractional franc is rejected, not rounded", [M.parseMinor("10.5", 0), M.parseMinor(10.5, 0), M.parseMinor("0.01", 0)], [null, null, null]);
  eq("USD: 10.5 -> 1050, '10.50' -> 1050, '0.07' -> 7", [M.parseMinor(10.5, 2), M.parseMinor("10.50", 2), M.parseMinor("0.07", 2)], [1050, 1050, 7]);
  eq("USD: 10.555 rejected", M.parseMinor("10.555", 2), null);
  eq("KWD: 1.234 -> 1234", M.parseMinor("1.234", 3), 1234);
  eq("KWD: 1.2345 rejected", M.parseMinor("1.2345", 3), null);
  eq("0.1 + 0.2 stay exact", M.parseMinor(0.1, 2) + M.parseMinor(0.2, 2), 30);
  eq("19.99 (float trap for *100) is exact", M.parseMinor(19.99, 2), 1999);
  eq("1.005 rejected at 2 decimals", M.parseMinor("1.005", 2), null);
  for (const bad of ["", " ", "abc", "-5", "1,000", "1e3", "1e21", NaN, Infinity, null, undefined, {}, "12.", ".5", "0x10"]) check(`unparseable ${String(bad)} rejected`, M.parseMinor(bad, 2) === null);
  eq("max amount accepted / over max rejected", [M.parseMinor("9999999999", 0), M.parseMinor("10000000000", 0)], [9999999999, null]);
  eq("minorToAmountString XAF/USD/KWD", [M.minorToAmountString(12000, 0), M.minorToAmountString(1050, 2), M.minorToAmountString(7, 2), M.minorToAmountString(1234, 3)], ["12000", "10.50", "0.07", "1.234"]);
  eq("round trip USD", M.minorToAmountString(M.parseMinor("123.40", 2), 2), "123.40");
  let threw = false; try { M.addMinor(Number.MAX_SAFE_INTEGER, 1); } catch { threw = true; }
  check("a sum beyond the exact range throws instead of losing precision", threw);
  // SQL and TS currency tables must be identical
  const sql = strip(read("supabase/migrations/2026-12-01_bookkeeping_foundation.sql"));
  const start = sql.indexOf("function bk_currency_digits");
  const fn = sql.slice(start, sql.indexOf("$$;", sql.indexOf("$$", start) + 2));
  const lists = [...fn.matchAll(/in \(([^)]*)\) then (\d)/g)].map((m) => ({ d: Number(m[2]), codes: [...m[1].matchAll(/'([A-Z]{3})'/g)].map((x) => x[1]).sort() }));
  eq("SQL zero-decimal list == TS list", lists.find((l) => l.d === 0)?.codes, [...M.ZERO_DECIMAL_CURRENCIES].sort());
  eq("SQL three-decimal list == TS list", lists.find((l) => l.d === 3)?.codes, [...M.THREE_DECIMAL_CURRENCIES].sort());
}

// =============================================================== distinct figures (XAF)
{
  const s = B.summarize({
    ...RANGE, cost: { kind: "none_needed" },
    autoSales: [S("o1", "20000.00", "2026-09-05T10:00:00Z")],
    entries: [
      E({ kind: "sale", amount: 5000 }), E({ kind: "sale", amount: 7000, cash_settled: false }), E({ kind: "other_income", amount: 3000 }),
      E({ kind: "expense", amount: 4000, category: "rent" }), E({ kind: "expense", amount: 1500, category: "transport", cash_settled: false }),
      E({ kind: "cash_in", amount: 50000 }), E({ kind: "cash_out", amount: 10000 }),
    ],
  });
  eq("minorDigits 0 for XAF", s.minorDigits, 0);
  eq("sales = auto + manual (incl. credit)", s.revenue.salesMinor, 32000);
  eq("revenue total adds other income", s.revenue.totalMinor, 35000);
  eq("cash inflow excludes credit sale, includes auto sale + cash_in", s.cash.inflowMinor, 20000 + 5000 + 3000 + 50000);
  eq("cash outflow excludes unpaid bill", s.cash.outflowMinor, 14000);
  eq("uncollected sales separate", s.uncollected.salesMinor, 7000);
  eq("unpaid expenses separate", s.unpaidExpensesMinor, 1500);
  eq("profit = revenue - operating expenses (not cash in - cash out)", s.profit, { status: "available", minor: 35000 - 5500, basis: "revenue_minus_operating_expenses_and_cost_of_goods" });
  check("profit differs from net cash movement", s.profit.minor !== s.cash.netMovementMinor);
  eq("counts", s.counts, { autoSales: 1, manualEntries: 7 });
}

// =============================================================== other currencies
{
  const usd = B.summarize({ from: "2026-09-01", to: "2026-09-30", currency: "USD", cost: { kind: "none_needed" }, entries: [E({ currency: "USD", amount: "19.99" }), E({ currency: "USD", amount: "0.01" }), E({ currency: "USD", kind: "expense", amount: "5.50", category: "rent" })] });
  eq("USD totals exact in cents", [usd.minorDigits, usd.revenue.salesMinor, usd.expenses.operatingMinor, usd.profit.minor], [2, 2000, 550, 1450]);
  const kwd = B.summarize({ from: "2026-09-01", to: "2026-09-30", currency: "KWD", cost: { kind: "none_needed" }, entries: [E({ currency: "KWD", amount: "1.234" }), E({ currency: "KWD", amount: "0.001" })] });
  eq("KWD totals exact in fils", [kwd.minorDigits, kwd.revenue.salesMinor], [3, 1235]);
  const ten = B.summarize({ from: "2026-09-01", to: "2026-09-30", currency: "USD", cost: { kind: "none_needed" }, entries: Array.from({ length: 10 }, () => E({ currency: "USD", amount: "0.10" })) });
  eq("ten x 0.10 is exactly 1.00", ten.revenue.salesMinor, 100);
  const bad = B.summarize({ ...RANGE, cost: { kind: "none_needed" }, entries: [E({ amount: "10.5" }), E({ amount: 1000 })] });
  eq("an over-precise stored amount is excluded AND surfaced, never rounded", [bad.revenue.salesMinor, bad.excluded.unreadableAmount], [1000, 1]);
  const mix = B.summarize({ ...RANGE, cost: { kind: "none_needed" }, autoSales: [S("usd", 100, "2026-09-05T10:00:00Z", "USD")], entries: [E({ amount: 100, currency: "USD" }), E({ amount: 1000 })] });
  eq("currencies are never mixed", [mix.revenue.salesMinor, mix.excluded.currencyMismatch], [1000, 2]);
}

// =============================================================== profit honesty / inventory cost
{
  const s = B.summarize({ ...RANGE, autoSales: [S("o1", 9000, "2026-09-05T10:00:00Z")], entries: [E({ kind: "expense", amount: 1000, category: "rent" })] });
  eq("goods sold, cost unknown => NO profit figure", s.profit, { status: "unavailable", reason: "cost_of_goods_unknown" });
  eq("default cost basis is unknown (never assumed)", B.summarize({ ...RANGE, cost: undefined, autoSales: [S("o1", 9000, "2026-09-05T10:00:00Z")], entries: [] }).profit.status, "unavailable");
  const k = B.summarize({ ...RANGE, cost: { kind: "known", costOfGoodsSoldMinor: 4000 }, autoSales: [S("o1", 9000, "2026-09-05T10:00:00Z")], entries: [E({ kind: "expense", amount: 1000, category: "rent" })] });
  eq("known cost of goods => profit", k.profit.minor, 4000);
  eq("no sales at all => profit available", B.summarize({ ...RANGE, entries: [E({ kind: "other_income", amount: 500 })] }).profit.status, "available");
  const st = B.summarize({ ...RANGE, cost: { kind: "none_needed" }, entries: [E({ amount: 10000 }), E({ kind: "expense", amount: 6000, category: B.STOCK_PURCHASE_CATEGORY }), E({ kind: "expense", amount: 1000, category: "rent" })] });
  eq("stock purchases are not an operating expense", [st.expenses.stockPurchasesMinor, st.expenses.operatingMinor, st.profit.minor, st.cash.outflowMinor], [6000, 1000, 9000, 7000]);
}

// =============================================================== duplicates, verification, corrections
{
  const s = B.summarize({ ...RANGE, cost: { kind: "none_needed" }, autoSales: [S("o1", 20000, "2026-09-05T10:00:00Z"), S("o1", 20000, "2026-09-05T10:00:00Z")], entries: [E({ amount: 20000, linked_order_type: "product_order", linked_order_id: "o1" })] });
  eq("an order is counted once", [s.revenue.salesMinor, s.excluded.doubleCountPrevented], [20000, 2]);
  eq("an expense linked to an order is fine", B.summarize({ ...RANGE, cost: { kind: "none_needed" }, entries: [E({ kind: "expense", amount: 500, linked_order_type: "product_order", linked_order_id: "o1" })] }).expenses.totalMinor, 500);
  const row = (status, paid_at = "2026-09-05T10:00:00Z") => ({ id: "o", status, total: "12000.00", currency: "XAF", paid_at });
  for (const st of ["awaiting_payment", "expired", "cancelled", "payment_review", "refunded"]) check(`status ${st} is not a sale`, B.autoSaleFromProductOrder(row(st)) === null);
  check("paid and fulfilled are sales; paid without paid_at is not", B.autoSaleFromProductOrder(row("paid")) && B.autoSaleFromProductOrder(row("fulfilled")) && !B.autoSaleFromProductOrder(row("paid", null)));
  const v = B.summarize({ ...RANGE, cost: { kind: "none_needed" }, entries: [E({ kind: "expense", amount: 9999, category: "rent", voided_at: "2026-09-11T00:00:00Z" }), E({ kind: "expense", amount: 1200, category: "rent" })] });
  eq("voided entries excluded and surfaced", [v.expenses.totalMinor, v.excluded.voided], [1200, 1]);
}

// =============================================================== business-local dates
{
  eq("Douala day start is 23:00Z the day before", B.localDayStart("2026-09-01").toISOString(), "2026-08-31T23:00:00.000Z");
  eq("range instants [start, endExclusive)", B.localRangeInstants("2026-09-01", "2026-09-30"), { start: "2026-08-31T23:00:00.000Z", endExclusive: "2026-09-30T23:00:00.000Z" });
  eq("NY spring-forward day is 23h long", [B.localDayStart("2026-03-08", "America/New_York").toISOString(), B.localDayStart("2026-03-09", "America/New_York").toISOString()], ["2026-03-08T05:00:00.000Z", "2026-03-09T04:00:00.000Z"]);
  eq("NY DST-end day start", B.localDayStart("2026-11-01", "America/New_York").toISOString(), "2026-11-01T04:00:00.000Z");
  eq("invalid zone falls back to Douala", B.localDayStart("2026-09-01", "Not/AZone").toISOString(), "2026-08-31T23:00:00.000Z");
  const edge = B.summarize({ ...RANGE, cost: { kind: "none_needed" }, autoSales: [S("late", 1000, "2026-09-30T23:30:00Z"), S("early", 2000, "2026-08-31T23:30:00Z")], entries: [] });
  eq("23:30Z Sep 30 is Oct 1 in Douala (out); 23:30Z Aug 31 is Sep 1 (in)", edge.revenue.salesMinor, 2000);
  eq("instant exactly at local midnight belongs to the new day", B.toLocalDateKey("2026-08-31T23:00:00Z"), "2026-09-01");
  eq("one second earlier is the previous day", B.toLocalDateKey("2026-08-31T22:59:59Z"), "2026-08-31");
  eq("a different zone shifts the bucket", B.summarize({ ...RANGE, timeZone: "UTC", cost: { kind: "none_needed" }, autoSales: [S("late", 1000, "2026-09-30T23:30:00Z")], entries: [] }).revenue.salesMinor, 1000);
  // the query window (used to fetch rows) and the bucket function (used to total them) must agree at every boundary
  const { start, endExclusive } = B.localRangeInstants("2026-09-01", "2026-09-30");
  for (const iso of ["2026-08-31T22:59:59Z", "2026-08-31T23:00:00Z", "2026-09-30T22:59:59Z", "2026-09-30T23:00:00Z"]) {
    const t = Date.parse(iso);
    const inWindow = t >= Date.parse(start) && t < Date.parse(endExclusive);
    const inBucket = B.toLocalDateKey(iso) >= "2026-09-01" && B.toLocalDateKey(iso) <= "2026-09-30";
    check(`window and bucket agree at ${iso}`, inWindow === inBucket);
  }
  const d = B.summarize({ ...RANGE, cost: { kind: "none_needed" }, entries: [E({ entry_date: "2026-08-31", amount: 1 }), E({ entry_date: "2026-09-01", amount: 2 }), E({ entry_date: "2026-09-30", amount: 3 }), E({ entry_date: "2026-10-01", amount: 4 })] });
  eq("entry_date range inclusive both ends", d.revenue.salesMinor, 5);
  const empty = B.summarize({ ...RANGE, entries: [] });
  eq("empty month is zeros and profit 0, not invented", [empty.revenue.totalMinor, empty.profit.minor], [0, 0]);
  eq("monthRange leap year / december", [B.monthRange("2028-02-10"), B.monthRange("2026-12-31")], [{ from: "2028-02-01", to: "2028-02-29" }, { from: "2026-12-01", to: "2026-12-31" }]);
  let t = false; try { B.summarize({ ...RANGE, from: "2026-09-30", to: "2026-09-01", entries: [] }); } catch { t = true; }
  check("inverted range rejected", t);
  check("isDateKey rejects 2026-02-30, accepts leap day", !B.isDateKey("2026-02-30") && B.isDateKey("2028-02-29"));
}

// =============================================================== input validation
{
  const ok = { kind: "expense", amount: 2500, entry_date: "2026-09-10", category: "rent" };
  const v = (o, cur = "XAF") => B.validateEntryInput({ ...ok, ...o }, { currency: cur, today: "2026-09-30" });
  check("valid input passes and returns minor units", v({}).ok && v({}).minor === 2500);
  check("unknown kind", v({ kind: "gift" }).errors.includes("invalid_kind"));
  for (const a of [0, -5, "abc", null, "1e3"]) check(`amount ${a} invalid`, v({ amount: a }).errors.includes("invalid_amount"));
  check("XAF fractional franc => amount_too_precise", v({ amount: 10.5 }).errors.includes("amount_too_precise"));
  check("USD accepts cents, rejects 3 decimals", v({ amount: 10.5 }, "USD").ok && v({ amount: "10.555" }, "USD").errors.includes("amount_too_precise"));
  check("KWD accepts 3 decimals", v({ amount: "1.234" }, "KWD").ok && v({ amount: "1.234" }, "KWD").minor === 1234);
  check("bad and future dates", v({ entry_date: "2026-13-40" }).errors.includes("invalid_date") && v({ entry_date: "2026-10-01" }).errors.includes("date_in_future"));
  check("description too long", v({ description: "x".repeat(501) }).errors.includes("description_too_long"));
  check("unsettled cash_in rejected", v({ kind: "cash_in", cash_settled: false }).errors.includes("cash_entry_must_be_settled"));
  check("half a link rejected", v({ linked_order_type: "product_order" }).errors.includes("invalid_link"));
  const L = { linked_order_type: "product_order", linked_order_id: "0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a" };
  check("manual sale linked to a product order rejected; expense accepted", v({ kind: "sale", ...L }).errors.includes("sale_link_auto_counted") && v(L).ok);
}

// =============================================================== access decision (owner-only, fail closed)
{
  const prof = (o = {}) => ({ id: "p1", user_id: "u1", category: "business_ecommerce", categories: [], is_demo: false, ...o });
  const d = (o) => decideBookkeepingAccess({ userId: "u1", profile: prof(), planEnabled: true, ...o });
  check("owner + category + plan => allowed", d({}).ok);
  eq("signed out", d({ userId: null }).reason, "not_signed_in");
  eq("no profile", d({ profile: null }).reason, "no_profile");
  eq("a staff member of the business is denied (profile is not theirs)", d({ userId: "staff-user" }).reason, "not_owner");
  eq("demo denied", d({ profile: prof({ is_demo: true }) }).reason, "demo_profile");
  eq("other category denied", d({ profile: prof({ category: "restaurant_food" }) }).reason, "category_not_enabled");
  check("secondary category counts", d({ profile: prof({ category: "restaurant_food", categories: ["business_ecommerce"] }) }).ok);
  for (const p of [false, null, undefined]) eq(`plan flag ${p} denied (fail closed)`, d({ planEnabled: p }).reason, "plan_not_enabled");
  eq("enabled for Business & E-commerce only (initially)", [...BOOKKEEPING_CATEGORIES], ["business_ecommerce"]);
}

// =============================================================== loader: scoping + pagination
{
  const calls = [];
  const makeDb = (tables) => ({ from(table) {
    const q = { table, filters: [] };
    const add = (op) => (c, v) => (q.filters.push([op, c, v]), chain);
    const chain = { select: () => chain, order: () => chain, eq: add("eq"), in: add("in"), gte: add("gte"), lt: add("lt"), lte: add("lte"),
      range: async (a, b) => { calls.push({ ...q }); const rows = tables[table].filter((r) => q.filters.every(([op, c, v]) => op === "eq" ? r[c] === v : op === "in" ? v.includes(r[c]) : op === "gte" ? r[c] >= v : op === "lt" ? r[c] < v : r[c] <= v)); return { data: rows.slice(a, b + 1), error: null }; } };
    return chain;
  } });
  const many = Array.from({ length: 2500 }, (_, i) => ({ id: "e" + i, profile_id: "A", kind: "sale", amount: "10", currency: "XAF", entry_date: "2026-09-10", category: null, cash_settled: true, linked_order_type: null, linked_order_id: null, voided_at: null }));
  const db = makeDb({
    bk_entries: [...many, { id: "x", profile_id: "B", kind: "sale", amount: "999999", currency: "XAF", entry_date: "2026-09-10", cash_settled: true }],
    product_orders: [
      { id: "o1", profile_id: "A", status: "paid", total: "5000.00", currency: "XAF", paid_at: "2026-09-30T22:30:00Z" },   // 23:30 Douala Sep 30 -> in
      { id: "o2", profile_id: "A", status: "paid", total: "7000.00", currency: "XAF", paid_at: "2026-09-30T23:30:00Z" },   // Oct 1 Douala -> out
      { id: "o3", profile_id: "A", status: "refunded", total: "9000.00", currency: "XAF", paid_at: "2026-09-10T10:00:00Z" },
      { id: "o4", profile_id: "B", status: "paid", total: "8000.00", currency: "XAF", paid_at: "2026-09-10T10:00:00Z" },
    ],
  });
  const s = await loadBookkeepingSummary(db, { profileId: "A", currency: "XAF", from: "2026-09-01", to: "2026-09-30", cost: { kind: "none_needed" } });
  eq("2,500 rows all counted (paged past the 1000-row cap)", s.revenue.manualSalesMinor, 25000);
  eq("only this business's verified, in-window orders are auto sales", [s.revenue.autoSalesMinor, s.counts.autoSales], [5000, 1]);
  check("every query filters by profile_id", calls.length > 0 && calls.every((c) => c.filters.some(([op, col, v]) => op === "eq" && col === "profile_id" && v === "A")));
  check("the other business's data never leaks into totals", s.revenue.salesMinor === 30000);
}

// =============================================================== pagination when the server caps rows BELOW the page size
{
  const { fetchAllRows } = jiti(path.join(SRC, "lib/bookkeeping/loader.ts"));
  // A PostgREST-like source: honours range(from,to) but never returns more than `cap` rows per request (the
  // project's "max rows" setting), so a page can be short without being the last one.
  const source = (rows, cap, log = []) => () => ({ range: async (a, b) => { const n = Math.min(b - a + 1, cap); log.push([a, b]); return { data: rows.slice(a, a + n), error: null }; } });
  const mk = (n) => Array.from({ length: n }, (_, i) => ({ id: "r" + i, v: i }));
  const ids = (rows) => rows.map((r) => r.id);

  for (const cap of [1000, 999, 500, 300, 1]) {
    const got = await fetchAllRows(source(mk(1234), cap), cap === 1 ? { pageSize: 1000, maxRows: 5000 } : {});
    check(`server cap ${cap} < page size: all 1,234 rows returned, none missing or repeated`, got.length === 1234 && new Set(ids(got)).size === 1234 && got[1233].id === "r1233", `got ${got.length}`);
  }
  check("an exact multiple of the page size ends on an empty page, no duplicates", (await fetchAllRows(source(mk(2000), 1000))).length === 2000);
  check("zero rows returns an empty list", (await fetchAllRows(source([], 1000))).length === 0);
  check("a single short non-empty page is still followed by one confirming request", (() => { const log = []; return fetchAllRows(source(mk(7), 1000, log)).then((r) => r.length === 7 && log.length === 2 && log[1][0] === 7); })());
  const log2 = []; await fetchAllRows(source(mk(1234), 300, log2));
  check("offsets advance by rows actually received, not by the requested size", JSON.stringify(log2.map((x) => x[0])) === JSON.stringify([0, 300, 600, 900, 1200, 1234]), JSON.stringify(log2.map((x) => x[0])));
  let capErr = null; try { await fetchAllRows(source(mk(50), 10), { pageSize: 10, maxRows: 30 }); } catch (e) { capErr = e.message; }
  check("exceeding the safety cap throws instead of returning a partial list", /safety row cap/.test(capErr || ""));
  let dbErr = null; try { await fetchAllRows(() => ({ range: async () => ({ data: null, error: { message: "boom" } }) })); } catch (e) { dbErr = e.message; }
  check("a database error propagates", /boom/.test(dbErr || ""));
  check("the loader no longer infers the last page from a page's length", !/rows\.length\s*<\s*PAGE/.test(strip(read("src/lib/bookkeeping/loader.ts"))));

  // end to end: totals stay exact, scoped, windowed and time-zoned when the server returns 300 rows at a time
  const CAP = 300;
  const tables = {
    bk_entries: [
      ...Array.from({ length: 1234 }, (_, i) => ({ id: "e" + String(i).padStart(5, "0"), profile_id: "A", kind: "sale", amount: "10", currency: "XAF", entry_date: "2026-09-10", category: null, cash_settled: true, linked_order_type: null, linked_order_id: null, voided_at: null })),
      { id: "zz1", profile_id: "A", kind: "sale", amount: "777", currency: "XAF", entry_date: "2026-10-01", category: null, cash_settled: true, linked_order_type: null, linked_order_id: null, voided_at: null }, // out of range
      { id: "zz2", profile_id: "B", kind: "sale", amount: "999999", currency: "XAF", entry_date: "2026-09-10", category: null, cash_settled: true, linked_order_type: null, linked_order_id: null, voided_at: null }, // other business
      { id: "zz3", profile_id: "A", kind: "sale", amount: "50", currency: "USD", entry_date: "2026-09-10", category: null, cash_settled: true, linked_order_type: null, linked_order_id: null, voided_at: null }, // other currency
    ],
    product_orders: [
      ...Array.from({ length: 650 }, (_, i) => ({ id: "o" + String(i).padStart(5, "0"), profile_id: "A", status: "paid", total: "100.00", currency: "XAF", paid_at: "2026-09-15T12:00:00Z" })),
      { id: "p-in", profile_id: "A", status: "paid", total: "5000.00", currency: "XAF", paid_at: "2026-09-30T22:59:59Z" },   // Sep 30 23:59:59 Douala: in
      { id: "p-out", profile_id: "A", status: "paid", total: "7000.00", currency: "XAF", paid_at: "2026-09-30T23:00:00Z" },  // Oct 1 00:00 Douala: out
      { id: "p-ref", profile_id: "A", status: "refunded", total: "9000.00", currency: "XAF", paid_at: "2026-09-15T12:00:00Z" },
      { id: "p-other", profile_id: "B", status: "paid", total: "8000.00", currency: "XAF", paid_at: "2026-09-15T12:00:00Z" },
    ],
  };
  const capped = { from(table) {
    const f = []; const add = (op) => (c, v) => (f.push([op, c, v]), chain); let ord = [];
    const chain = { select: () => chain, order: (c) => (ord.push(c), chain), eq: add("eq"), in: add("in"), gte: add("gte"), lt: add("lt"), lte: add("lte"),
      range: async (a, b) => { const rows = tables[table].filter((r) => f.every(([op, c, v]) => op === "eq" ? r[c] === v : op === "in" ? v.includes(r[c]) : op === "gte" ? r[c] >= v : op === "lt" ? r[c] < v : r[c] <= v)).sort((x, y) => (x[ord[0]] < y[ord[0]] ? -1 : x[ord[0]] > y[ord[0]] ? 1 : x.id < y.id ? -1 : 1)); return { data: rows.slice(a, a + Math.min(b - a + 1, CAP)), error: null }; } };
    return chain;
  } };
  const s = await loadBookkeepingSummary(capped, { profileId: "A", currency: "XAF", from: "2026-09-01", to: "2026-09-30", cost: { kind: "none_needed" } });
  eq("capped server: manual sales total exact (1,234 x 10)", s.revenue.manualSalesMinor, 12340);
  eq("capped server: auto sales exact (650 x 100 + 5,000; the 23:00Z order is October in Douala; refunded excluded)", [s.revenue.autoSalesMinor, s.counts.autoSales], [65000 + 5000, 651]);
  eq("capped server: grand total exact, other business / month / currency excluded", s.revenue.salesMinor, 12340 + 70000);
}

// =============================================================== static checks: migration (NOT applied)
{
  const raw = read("supabase/migrations/2026-12-01_bookkeeping_foundation.sql");
  const code = strip(raw);
  const main = code.split(/\ncommit;/i)[0];
  const alters = [...main.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?(\w+)/gi)].map((m) => m[1]);
  check("only `plans` (one column) and the new bk_* tables are altered", alters.every((t) => t === "plans" || t.startsWith("bk_")) && alters.filter((t) => t === "plans").length === 1, alters.join(","));
  check("the plans change is one guarded ADD COLUMN", /information_schema\.columns[\s\S]*?business_toolkit_enabled[\s\S]*?alter table plans add column business_toolkit_enabled boolean not null default false/.test(main));
  check("seed runs only inside the add-column branch, naming only the two Business plans", /alter table plans add column[^;]*;\s*update plans set business_toolkit_enabled = true where name in \('business_basic', 'business_pro'\);\s*end if/.test(main) && (main.match(/update plans/g) || []).length === 1);
  check("no TRUNCATE/DELETE statement, and no drop of anything (the BEFORE TRUNCATE guard trigger is fine)", !/^\s*(truncate|delete\s+from)\b/im.test(main) && /before truncate on bk_entries/.test(main) && /before truncate on bk_entry_events/.test(main) &&!/\bdrop\s+(table|column|function|policy|index|constraint)\b/i.test(main));
  check("drop trigger only on bk_* tables", [...main.matchAll(/drop trigger if exists \w+ on (\w+)/gi)].every((m) => m[1].startsWith("bk_")));
  check("no CASCADE in the migration", !/cascade/i.test(main));
  check("triggers/policies are created only on new bk_* tables", [...main.matchAll(/create\s+(?:trigger|policy)[^;]*?\bon\s+(\w+)/gi)].every((m) => m[1].startsWith("bk_")));
  check("financial rows never deleted (restrict + delete guard)", /on delete restrict/i.test(main) && /never deleted/.test(raw));
  check("RLS enabled on both tables", /alter table bk_entries enable row level security/i.test(main) && /alter table bk_entry_events enable row level security/i.test(main));
  check("no client write grants", !/grant\s+(insert|update|delete)[^;]*to\s+authenticated/i.test(main));
  check("RLS read is OWNER-only (no team/staff permission, no admin)", /profiles p where p\.id = profile_id and p\.user_id = auth\.uid\(\)/.test(main) && !/has_org_permission|is_org_member|is_admin|organization_members/.test(main));
  check("RPCs are service_role only", /revoke all on function bk_record_entry[^;]*from public, anon, authenticated/i.test(main) && /grant execute on function bk_record_entry[^;]*to service_role/i.test(main) && /grant execute on function bk_void_entry[^;]*to service_role/i.test(main));
  check("both RPCs require the actor to be the owner and the plan flag", (main.match(/not_owner/g) || []).length >= 2 && (main.match(/toolkit_not_enabled/g) || []).length >= 2);
  check("demo profiles refused", /demo_profile_not_supported/.test(main));
  check("idempotency key unique per business", /bk_entries_request_idx on bk_entries \(profile_id, client_request_id\)/.test(main));
  check("one live manual sale per order + CHECK against product_order sale links", /bk_entries_one_live_sale_link_idx/.test(main) && /check \(kind <> 'sale' or linked_order_type is distinct from 'product_order'\)/.test(main));
  check("currency comes from the profile; amount scale enforced per currency", !/p_currency/.test(main.slice(main.indexOf("function bk_record_entry"), main.indexOf("function bk_void_entry"))) && /from profiles p where p\.id = p_profile_id/.test(main) && /amount = round\(amount, bk_currency_digits\(currency\)\)/.test(main));
  check("money column holds 3-decimal currencies exactly", /amount numeric\(14,3\)/.test(main));
  check("linked order ownership verified in the RPC", /profile_id = p_profile_id/.test(main) && /linked_order_not_found/.test(main));
  check("single transaction", /^\s*begin;/im.test(main) && /\ncommit;/i.test(raw));
  const rb = raw.split("-- ROLLBACK")[1].split("\n").filter((l) => /^--\s{3}\S/.test(l)).map((l) => l.replace(/^--\s+/, ""));
  const drops = rb.filter((l) => /^drop /i.test(l));
  check("rollback drops only bk_* objects, by exact name", drops.length >= 6 && drops.every((l) => /^drop (function|table) if exists bk_\w+/i.test(l)), drops.join(" | "));
  check("rollback has no CASCADE and exactly one ALTER (the plans column)", !rb.some((l) => /cascade/i.test(l)) && rb.filter((l) => /^alter /i.test(l)).length === 1 && rb.some((l) => /^alter table plans drop column if exists business_toolkit_enabled;/i.test(l)));
  const order = rb.map((l) => (l.match(/bk_\w+/) || [""])[0]);
  check("rollback drops the CHECK's function after the table", order.indexOf("bk_currency_digits") > order.indexOf("bk_entries"));
  const pre = strip(read("supabase/support/2026-12-01_bookkeeping_foundation.preflight.sql")).replace(/'[^']*'/g, "");
  check("preflight file is read-only", !/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke)\b/i.test(pre));
}

// =============================================================== static checks: routes + plan gate wiring
{
  const files = ["src/app/api/bookkeeping/entries/route.ts", "src/app/api/bookkeeping/entries/[id]/void/route.ts", "src/app/api/bookkeeping/summary/route.ts"];
  const routes = files.map((f) => [f, strip(read(f))]);
  for (const [f, s] of routes) {
    const firstUse = Math.min(...["request.json", "rpc(", "loadBookkeepingSummary("].map((k) => (s.indexOf(k) < 0 ? 1e9 : s.indexOf(k))));
    check(`${f}: authorises through resolveBookkeepingOwner before doing anything`, s.includes("resolveBookkeepingOwner()") && s.indexOf("resolveBookkeepingOwner()") < firstUse);
    check(`${f}: never reads a profile/organization id from the client`, !/body\??\.(profile_id|organization_id|org_id)|searchParams\.get\(["'](profile|org)/i.test(s));
  }
  check("entries route uses the caller's own profile and user id for the RPC", /p_profile_id: owner\.profile\.id/.test(routes[0][1]) && /p_actor_user_id: owner\.userId/.test(routes[0][1]));
  check("void route uses the caller's own profile and user id for the RPC", /p_profile_id: owner\.profile\.id/.test(routes[1][1]) && /p_actor_user_id: owner\.userId/.test(routes[1][1]));
  check("summary route uses the owner-scoped (RLS) client, not the service role", /loadBookkeepingSummary\(owner\.supabase/.test(routes[2][1]));
  const acc = strip(read("src/lib/bookkeeping/access.ts"));
  check("access resolves the profile from the session user only", /eq\("user_id", user\.id\)/.test(acc) && !/params|searchParams|request/.test(acc));
  check("plan flag read fails closed", /typeof v === "boolean" \? v : null/.test(acc));
  check("no dependency on team permissions or the active-org cookie", !/team\/access|ACTIVE_ORG|organization_members|hasPermission|sales\.view|payments\.view|reports\.view/.test(acc + strip(read("src/lib/bookkeeping/decision.ts"))));
  check("admin PATCH whitelist includes the new flag", /"business_toolkit_enabled"/.test(read("src/app/api/admin/plans/[id]/route.ts")));
  const pm = read("src/components/admin/PlansManager.tsx");
  check("PlansManager sends/shows the flag only when the column exists", (pm.match(/"business_toolkit_enabled" in plan/g) || []).length === 2);
}

// =============================================================== regressions from the staging-review pass
{
  const main = strip(read("supabase/migrations/2026-12-01_bookkeeping_foundation.sql")).split(/\ncommit;/i)[0];
  check("no ON DELETE SET NULL (it is an UPDATE the immutability guards would reject)", !/on delete set null/i.test(main));
  check("every foreign key is ON DELETE RESTRICT", [...main.matchAll(/references\s+[\w.]+\s*\(\w+\)\s*(on delete \w+(?: \w+)?)?/gi)].every((m) => /^on delete restrict$/i.test(m[1] || "")));
  check("concurrent duplicate submissions are serialised before the idempotency lookup", /pg_advisory_xact_lock\(hashtextextended\(p_profile_id::text \|\| ':' \|\| p_client_request_id::text, 0\)\);\s*select \* into v_existing/.test(main));
  check("a second live manual sale for one order is refused with order_already_counted before insert", /kind = 'sale'\s+and linked_order_type = p_linked_order_type[\s\S]*?raise exception 'order_already_counted'/.test(main));
  const http = read("src/lib/bookkeeping/http.ts");
  check("the unique-index backstop maps to 409, not 500", /bk_entries_one_live_sale_link_idx[\s\S]*?order_already_counted[\s\S]*?409/.test(http));
  const ok = { kind: "expense", amount: 100, entry_date: "2026-09-10" };
  const vv = (o) => B.validateEntryInput({ ...ok, ...o }, { currency: "XAF", today: "2026-09-30" });
  check("cash_settled must be a boolean", vv({ cash_settled: "yes" }).errors.includes("invalid_cash_settled") && vv({ cash_settled: 1 }).errors.includes("invalid_cash_settled") && vv({ cash_settled: false }).ok && vv({}).ok);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
