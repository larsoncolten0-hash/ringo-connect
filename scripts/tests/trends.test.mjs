// Business Toolkit Phase 7B (trends, month comparison, year to date): the REAL trend/YTD builders, handlers, route files, tab list and translations run
// against an in-memory read-only fake; only the session resolver is stubbed. No network, no database, no migration.
//   Run:  node scripts/tests/trends.test.mjs
import fs from "fs";
import path from "path";
import { SRC, PROFILE, OTHER, ID, makeJiti, mkOwner, earn, entry, order, counters } from "./phase7Harness.mjs";

const REPO = path.join(SRC, "..");
const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8").replace(/\r\n/g, "\n");
const strip = (s) => s.replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/\/\*[\s\S]*?\*\//g, "");
const tmp = [];
const jiti = makeJiti(tmp, "trends");
const P = jiti(path.join(SRC, "lib/reports/period.ts"));
const B = jiti(path.join(SRC, "lib/reports/build.ts"));
const T = jiti(path.join(SRC, "lib/overview/trends.ts"));
const H = jiti(path.join(SRC, "lib/overview/handlers.ts"));
const { translations } = jiti(path.join(SRC, "lib/i18n/translations.ts"));
const trendsRoute = jiti(path.join(SRC, "app/api/overview/trends/route.ts"));
const ytdRoute = jiti(path.join(SRC, "app/api/overview/ytd/route.ts"));

console.error = () => {};
const { c, check, eq } = counters();
const NOW = new Date("2026-12-10T10:00:00Z");

const FIXTURE = () => ({
  bk_entries: [
    entry("s1", "sale", 1000, "2026-09-05"), entry("s2", "expense", 400, "2026-09-20", { category: "rent" }),
    entry("o1", "sale", 2000, "2026-10-03"), entry("o2", "sale", 500, "2026-10-12"), entry("o3", "expense", 700, "2026-10-05", { category: "rent" }), entry("o4", "cash_in", 300, "2026-10-10"),
    entry("n1", "sale", 4000, "2026-11-02"), entry("n2", "sale", 6000, "2026-11-25"), entry("n3", "expense", 1000, "2026-11-08", { category: "rent" }), entry("n4", "other_income", 500, "2026-11-09"),
    entry("n5", "cash_out", 200, "2026-11-15"), entry("n6", "sale", 999, "2026-11-10", { voided_at: "2026-11-11T08:00:00Z", void_reason: "x" }),
    entry("d1", "sale", 3000, "2026-12-03"), entry("d2", "sale", 8000, "2026-12-20"), entry("d3", "expense", 500, "2026-12-05", { category: "rent" }), entry("d4", "sale", 1500, "2026-12-09"),
    entry("u1", "sale", 777, "2026-12-04", { currency: "USD" }),
    { ...entry("x1", "sale", 55555, "2026-12-02"), profile_id: OTHER }, { ...entry("x2", "sale", 44444, "2026-11-02"), profile_id: OTHER },
  ],
  product_orders: [
    order("p1", "paid", 5000, "2026-10-20T10:00:00Z", earn(500, 4500, { status: "paid" })), order("p2", "paid", 10000, "2026-11-03T10:00:00Z", earn(1000, 9000)),
    order("p3", "paid", 20000, "2026-12-04T10:00:00Z", earn(2000, 18000)), order("p4", "refunded", 3000, "2026-12-05T10:00:00Z", earn(300, 2700)),
    { ...order("px", "paid", 88888, "2026-12-04T10:00:00Z", earn(8, 88880)), profile_id: OTHER },
  ],
});
const owner = (log = [], opts = {}, tables = FIXTURE()) => mkOwner(tables, {}, log, opts);
const trend = async (q, o = owner(), now = NOW) => { const r = await H.overviewTrends(o, q, { now }); return { status: r.status, body: r.body, trend: r.body.trend }; };
const ytd = async (q, o = owner(), now = NOW) => { const r = await H.overviewYtd(o, q, { now }); return { status: r.status, body: r.body, ytd: r.body.ytd }; };
const pt = (t, y, m) => t.points.find((p) => p.year === y && p.month === m);

// ------------------------------------------------------------------------ pure comparison rules
{
  eq("previous zero: no percentage (never divide by zero, never a fake 0%)", T.compareValues(500, 0), { currentMinor: 500, previousMinor: 0, changeMinor: 500, percent: null, percentReason: "previous_zero" });
  eq("both zero: change 0, percentage unavailable (not 0%)", [T.compareValues(0, 0).changeMinor, T.compareValues(0, 0).percent, T.compareValues(0, 0).percentReason], [0, null, "previous_zero"]);
  eq("increase", [T.compareValues(150, 100).changeMinor, T.compareValues(150, 100).percent], [50, 50]);
  eq("decrease keeps its sign", [T.compareValues(50, 100).changeMinor, T.compareValues(50, 100).percent], [-50, -50]);
  eq("down to zero is -100%", T.compareValues(0, 100).percent, -100);
  eq("negative base: less negative is an improvement relative to the base magnitude", [T.compareValues(-50, -100).changeMinor, T.compareValues(-50, -100).percent], [50, 50]);
  eq("sign change: percentage unavailable with its reason", [T.compareValues(50, -100).percent, T.compareValues(50, -100).percentReason, T.compareValues(-20, 100).percent, T.compareValues(-20, 100).percentReason], [null, "sign_change", null, "sign_change"]);
  eq("one decimal", T.compareValues(4, 3).percent, 33.3);
  eq("the month list ends at the chosen month, oldest first, and stops at the first reportable year", [T.monthsEndingAt(2026, 2, 6).map((m) => `${m.year}-${m.month}`), T.monthsEndingAt(2020, 2, 6).map((m) => `${m.year}-${m.month}`)], [["2025-9", "2025-10", "2025-11", "2025-12", "2026-1", "2026-2"], ["2020-1", "2020-2"]]);
  eq("spans are exactly 3, 6 and 12", T.TREND_SPANS, [3, 6, 12]);
}

// ------------------------------------------------------------------------ the series equals independent per-month builds of the SAME builder
{
  const { trend: t } = await trend({ year: "2026", month: "12", span: "3" });
  eq("span 3 ends at the selected month, oldest first", t.points.map((p) => `${p.year}-${p.month}`), ["2026-10", "2026-11", "2026-12"]);
  for (const p of t.points) {
    const per = P.periodFor(p.year, p.month, NOW).period;
    const r = await B.buildMonthlyReport(owner(), per, { now: NOW });
    eq(`${p.year}-${p.month}: every trend field equals the Monthly report's own figure`, [p.revenueMinor, p.expensesMinor, p.cashReceivedMinor, p.cashPaidOutMinor, p.netCashMinor, p.onlineGrossMinor, p.commissionMinor, p.onlineNetMinor, p.onlineNetPaidOutMinor, p.onlineNetNotPaidMinor, p.paidOnlineOrders, p.exclusions, p.refunded],
      [r.revenue.totalMinor, r.expenses.totalMinor, r.cash.receivedDirectMinor, r.cash.paidOutMinor, r.cash.netMovementMinor, r.online.grossMinor, r.online.commissionMinor, r.online.netMinor, r.online.netPaidOutMinor, r.online.netNotYetPaidOutMinor, r.counts.paidOnlineOrders, r.exclusions, { count: r.refundedOrders.count, grossMinor: r.refundedOrders.grossMinor }]);
  }
  const oct = pt(t, 2026, 10), nov = pt(t, 2026, 11), dec = pt(t, 2026, 12);
  eq("hand-checked October: revenue 7 500, expenses 700, cash in 2 800, out 700, net 2 100", [oct.revenueMinor, oct.expensesMinor, oct.cashReceivedMinor, oct.cashPaidOutMinor, oct.netCashMinor], [7500, 700, 2800, 700, 2100]);
  eq("hand-checked November: revenue 20 500, expenses 1 000, cash in 10 500, out 1 200, net 9 300; one voided entry disclosed", [nov.revenueMinor, nov.expensesMinor, nov.cashReceivedMinor, nov.cashPaidOutMinor, nov.netCashMinor, nov.exclusions.voidedEntries], [20500, 1000, 10500, 1200, 9300, 1]);
  eq("hand-checked online (November): gross 10 000, commission 1 000, net 9 000 (none paid out yet), 1 order", [nov.onlineGrossMinor, nov.commissionMinor, nov.onlineNetMinor, nov.onlineNetPaidOutMinor, nov.onlineNetNotPaidMinor, nov.paidOnlineOrders], [10000, 1000, 9000, 0, 9000, 1]);
  eq("October's online net earnings that were paid out stay separate from cash (cash received 2 800 has no online amount)", [oct.onlineNetMinor, oct.onlineNetPaidOutMinor, oct.cashReceivedMinor], [4500, 4500, 2800]);
  eq("hand-checked December to date: revenue 24 500 (the 20 December entry is in the future and NOT projected), expenses 500, net cash 4 000", [dec.revenueMinor, dec.expensesMinor, dec.netCashMinor, dec.kind, dec.to], [24500, 500, 4000, "month_to_date", "2026-12-10"]);
  check("the other-currency record and the other business are not in any month (USD sale disclosed; 55 555 and 44 444 never appear)", dec.exclusions.otherCurrency === 1 && t.points.every((p) => p.revenueMinor < 40000));
  eq("a currently refunded order is disclosed, not sold", [dec.refunded.count, dec.refunded.grossMinor, dec.onlineGrossMinor], [1, 3000, 20000]);
  eq("the span-wide disclosures are the sum of the months' counts", [t.disclosures.exclusions.voidedEntries, t.disclosures.exclusions.otherCurrency, t.disclosures.refunded.count], [1, 1, 1]);
  eq("no profit: the model says so explicitly", t.profit, { status: "not_reported" });
  const keys = JSON.stringify(Object.keys(t.points[0]));
  check("a point has no profit/margin/receivable/inventory field", !/profit|margin|receivable|inventory|stock/i.test(keys), keys);
  eq("currency and digits come from the business profile", [t.currency, t.minorDigits], ["XAF", 0]);
}

// ------------------------------------------------------------------------ spans
{
  eq("default span is 6", (await trend({ year: "2026", month: "12" })).trend.points.length, 6);
  eq("span 12 builds twelve months (January to December)", (await trend({ year: "2026", month: "12", span: "12" })).trend.points.map((p) => p.month), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  for (const bad of ["4", "0", "13", "24", "abc", "-3", "3.5", "06", "6 "]) { const r = await trend({ year: "2026", month: "12", span: bad }); check(`span ${JSON.stringify(bad)} is refused`, r.status === 400 && r.body.details[0] === "invalid_span", JSON.stringify(r.body)); }
  const early = (await trend({ year: "2020", month: "2", span: "6" })).trend;
  eq("near the first reportable year the series is shortened, never invented", early.points.map((p) => `${p.year}-${p.month}`), ["2020-1", "2020-2"]);
  const first = (await trend({ year: "2020", month: "1", span: "3" })).trend;
  check("January 2020 has no earlier period: the comparison is unavailable", first.comparison.previous === null && first.comparison.metrics === null);
}

// ------------------------------------------------------------------------ comparison: completed month vs previous full month, current month vs the SAME DAYS
{
  const { trend: t } = await trend({ year: "2026", month: "11", span: "3" });
  eq("completed month: compared with the whole previous month", [t.comparison.previous.basis, t.comparison.previous.from, t.comparison.previous.to], ["full_month", "2026-10-01", "2026-10-31"]);
  const rev = t.comparison.metrics.revenue;
  eq("November vs October revenue: 20 500 vs 7 500 = +13 000 (+173.3%)", [rev.currentMinor, rev.previousMinor, rev.changeMinor, rev.percent], [20500, 7500, 13000, 173.3]);
  const { trend: t2 } = await trend({ year: "2026", month: "12", span: "3" });
  eq("current month: compared with the same days (1 to 10) of the previous month", [t2.comparison.previous.basis, t2.comparison.previous.from, t2.comparison.previous.to], ["same_days", "2026-11-01", "2026-11-10"]);
  const m = t2.comparison.metrics;
  eq("same-day comparison, revenue: 24 500 now vs 14 500 on 1-10 November (the 6 000 sale of 25 November is NOT in the base) = +10 000 (+69%)", [m.revenue.previousMinor, m.revenue.changeMinor, m.revenue.percent], [14500, 10000, 69]);
  eq("same-day comparison, expenses 500 vs 1 000 = -500 (-50%)", [m.expenses.changeMinor, m.expenses.percent], [-500, -50]);
  eq("same-day comparison, net cash 4 000 vs 3 500 = +500 (+14.3%); cash paid out 500 vs 1 000 (the 15 November payout is outside the days)", [m.netCash.previousMinor, m.netCash.changeMinor, m.netCash.percent, m.cashPaidOut.previousMinor], [3500, 500, 14.3, 1000]);
  eq("same-day comparison, online: gross 20 000 vs 10 000 (+100%), commission 2 000 vs 1 000", [m.onlineGross.percent, m.commission.previousMinor], [100, 1000]);
  check("the full previous month is NOT used as the base for a partial month", m.revenue.previousMinor !== 20500);
  eq("the series itself still shows December as month to date, not as a full month", t2.points[2].kind, "month_to_date");
  const { trend: t3 } = await trend({ year: "2026", month: "10", span: "3" });
  eq("previous zero: October online gross vs September (no online orders) has no percentage and says why", [t3.comparison.metrics.onlineGross.previousMinor, t3.comparison.metrics.onlineGross.percent, t3.comparison.metrics.onlineGross.percentReason], [0, null, "previous_zero"]);
  // current month on day 31 vs a shorter previous month: the equivalent range is capped at the previous month's length
  const night = await trend({ year: "2026", month: "12", span: "3" }, owner(), new Date("2026-12-31T10:00:00Z"));
  eq("on 31 December the base is the whole of 30 November (capped at the month's length) and is treated as a full month", [night.trend.comparison.previous.to, night.trend.comparison.previous.basis], ["2026-11-30", "same_days"]);
  const march = await trend({ year: "2026", month: "3", span: "3" }, owner(), new Date("2026-03-31T10:00:00Z"));
  eq("on 31 March the base is capped at 28 February", march.trend.comparison.previous.to, "2026-02-28");
}

// ------------------------------------------------------------------------ light builds: the unnecessary sections are really skipped
{
  const log = [];
  const o = owner(log);
  await H.overviewTrends(o, { year: "2026", month: "12", span: "6" }, { now: NOW });
  const tables = [...new Set(log.map((c) => c.table))].sort();
  eq("a 6-month trend reads ONLY entries and orders (no top-product items, no invoices, no business profile, no profile)", tables, ["bk_entries", "product_orders"]);
  eq("and calls no receivables or inventory RPC (snapshots are not part of a trend)", o.admin.calls, []);
  const ylog = [];
  const yo = owner(ylog);
  await H.overviewYtd(yo, { year: "2026", month: "12" }, { now: NOW });
  eq("the year to date reads ONLY entries and orders too", [...new Set(ylog.map((c) => c.table))].sort(), ["bk_entries", "product_orders"]);
  eq("no snapshot RPC for the year to date", yo.admin.calls, []);
  const calls = [];
  await B.buildMonthlyReport(owner(calls), P.periodFor(2026, 11, NOW).period, { now: NOW, sections: T.LIGHT_SECTIONS });
  eq("LIGHT_SECTIONS skips all five optional sections", T.LIGHT_SECTIONS, { topProducts: false, invoicing: false, business: false, receivables: false, inventory: false });
  const full = await B.buildMonthlyReport(owner(), P.periodFor(2026, 11, NOW).period, { now: NOW });
  const flags = await B.buildMonthlyReport(owner(), P.periodFor(2026, 11, NOW).period, { now: NOW, sections: { receivables: true, inventory: true } });
  eq("the default build is unchanged by the two new flags (omitted = on)", JSON.stringify(flags), JSON.stringify(full));
  const lightOnly = await B.buildMonthlyReport(owner(), P.periodFor(2026, 11, NOW).period, { now: NOW, sections: T.LIGHT_SECTIONS });
  check("a skipped receivables/inventory section is reported unavailable, never as a real-looking zero", lightOnly.receivables.available === false && lightOnly.inventory.available === false && lightOnly.receivables.currencies.length === 0);
  eq("the figures that ARE built are identical to the full build", [lightOnly.revenue, lightOnly.cash, lightOnly.online, lightOnly.expenses, lightOnly.exclusions], [full.revenue, full.cash, full.online, full.expenses, full.exclusions]);
  check("at most 3 builds run at a time (bounded concurrency)", /BUILD_CONCURRENCY = 3/.test(read("src/lib/overview/trends.ts")));
}

// ------------------------------------------------------------------------ year to date
{
  const { ytd: y } = await ytd({ year: "2026", month: "12" });
  eq("YTD covers January to the selected month; the current month stays partial", [y.from, y.to, y.partial, y.months, y.throughMonth], ["2026-01-01", "2026-12-10", true, 12, 12]);
  eq("hand-checked YTD flows: revenue 53 500, expenses 2 600, cash in 18 800, cash out 2 800, net 16 000", [y.totals.revenueMinor, y.totals.expensesMinor, y.totals.cashReceivedMinor, y.totals.cashPaidOutMinor, y.totals.netCashMinor], [53500, 2600, 18800, 2800, 16000]);
  eq("hand-checked YTD online: gross 35 000, commission 3 500, net 31 500 (4 500 paid out, 27 000 not yet), 3 orders", [y.totals.onlineGrossMinor, y.totals.commissionMinor, y.totals.onlineNetMinor, y.totals.onlineNetPaidOutMinor, y.totals.onlineNetNotPaidMinor, y.totals.paidOnlineOrders], [35000, 3500, 31500, 4500, 27000, 3]);
  check("net cash YTD is exactly cash received minus cash paid out (online earnings never in it)", y.totals.netCashMinor === y.totals.cashReceivedMinor - y.totals.cashPaidOutMinor);
  eq("YTD keeps the exclusions: one voided entry, one other-currency record, one refunded order", [y.totals.exclusions.voidedEntries, y.totals.exclusions.otherCurrency, y.totals.refunded.count], [1, 1, 1]);
  // the sum of the months equals ONE report built for January 1 to the same end date
  const whole = await B.buildMonthlyReport(owner(), { year: 2026, month: 12, from: "2026-01-01", to: "2026-12-10", kind: "month_to_date", timeZone: "Africa/Douala" }, { now: NOW, sections: T.LIGHT_SECTIONS });
  eq("the year to date equals a single report built for 1 January to 10 December (flows are additive)", [y.totals.revenueMinor, y.totals.expensesMinor, y.totals.cashReceivedMinor, y.totals.cashPaidOutMinor, y.totals.netCashMinor, y.totals.onlineGrossMinor, y.totals.commissionMinor, y.totals.onlineNetMinor], [whole.revenue.totalMinor, whole.expenses.totalMinor, whole.cash.receivedDirectMinor, whole.cash.paidOutMinor, whole.cash.netMovementMinor, whole.online.grossMinor, whole.online.commissionMinor, whole.online.netMinor]);
  const past = (await ytd({ year: "2026", month: "11" })).ytd;
  eq("a completed month: YTD is full months, not partial", [past.partial, past.to, past.months], [false, "2026-11-30", 11]);
  const jan = (await ytd({ year: "2026", month: "1" })).ytd;
  eq("January: one month", [jan.months, jan.totals.revenueMinor], [1, 0]);
  const keys = JSON.stringify(Object.keys(y.totals));
  check("YTD carries no snapshot field (no receivables, no inventory, no stock value) and no profit figure", !/receivable|inventory|stock|profit|outstanding|overdue/i.test(keys + JSON.stringify(Object.keys(y).filter((k) => k !== "profit"))) && JSON.stringify(y.profit) === JSON.stringify({ status: "not_reported" }), keys);
  eq("sumPoints adds only flows: an empty list is all zeros", T.sumPoints([]).revenueMinor, 0);
  const builds = [];
  const yo = owner(builds);
  await H.overviewYtd(yo, { year: "2026", month: "12" }, { now: NOW });
  const yy = (await H.overviewYtd(owner(), { year: "2026", month: "12" }, { now: NOW })).body.ytd;
  check("at most 12 monthly builds, and every read is an entries or orders read (bounded)", yy.months === 12 && builds.every((c) => ["bk_entries", "product_orders"].includes(c.table)) && builds.length <= 12 * 2 * 3, String(builds.length));
}

// ------------------------------------------------------------------------ validation and isolation
{
  for (const [q, code] of [[{ year: "2026", month: "13" }, "invalid_month"], [{ year: "26", month: "5" }, "invalid_year"], [{ year: "2027", month: "1" }, "period_in_future"], [{ year: "2019", month: "5" }, "period_too_old"], [{ year: "2026" }, "invalid_month"]]) {
    const r = await trend({ ...q, span: "3" });
    check(`trends: ${JSON.stringify(q)} -> 400 ${code}`, r.status === 400 && r.body.details[0] === code, JSON.stringify(r.body));
    const y = await ytd(q);
    check(`ytd: ${JSON.stringify(q)} -> 400 ${code}`, y.status === 400 && y.body.details[0] === code, JSON.stringify(y.body));
  }
  eq("no year/month = the previous completed month (like the Monthly report)", (await trend({ span: "3" })).trend.selected, { year: 2026, month: 11, kind: "month", from: "2026-11-01", to: "2026-11-30" });
  const log = [];
  await trend({ year: "2026", month: "12", span: "12", profile_id: OTHER, profileId: OTHER }, owner(log));
  check("every read is scoped to the caller's own profile; a profile id in the query is never read", log.every((c) => c.eq.some(([col, v]) => col === "profile_id" && v === PROFILE)) && !log.some((c) => c.eq.some(([, v]) => v === OTHER)));
  const t = (await trend({ year: "2026", month: "12", span: "12" })).trend;
  check("another business's sales (55 555 / 44 444) are in no month", JSON.stringify(t).indexOf("55555") < 0 && JSON.stringify(t).indexOf("44444") < 0);
  const usd = (await trend({ year: "2026", month: "12", span: "3" }, owner([], { currency: "USD" }))).trend;
  eq("a USD business counts USD records only; the XAF ones are excluded, never converted", [usd.currency, usd.minorDigits, pt(usd, 2026, 12).revenueMinor, pt(usd, 2026, 12).exclusions.otherCurrency > 0], ["USD", 2, 77700, true]);
  const failing = owner();
  failing.supabase = { from() { throw new Error("db down"); } };
  const r = await H.overviewTrends(failing, { year: "2026", month: "12", span: "3" }, { now: NOW });
  check("a failing build is a generic 500 with no internals", r.status === 500 && JSON.stringify(r.body) === JSON.stringify({ error: "internal_error" }));
  const ry = await H.overviewYtd(failing, { year: "2026", month: "12" }, { now: NOW });
  check("the same for the year to date", ry.status === 500 && JSON.stringify(ry.body) === JSON.stringify({ error: "internal_error" }));
}

// ------------------------------------------------------------------------ routes
{
  for (const [name, route, q] of [["trends", trendsRoute, "?year=2026&month=3&span=3"], ["ytd", ytdRoute, "?year=2026&month=3"]]) {
    globalThis.__owner = { ok: true, owner: owner() };
    globalThis.__admin = globalThis.__owner.owner.admin;
    const ok = await route.GET(new Request(`http://x/api/overview/${name}${q}`));
    const body = await ok.json();
    check(`${name}: the owner gets the figures`, ok.status === 200 && (body.trend || body.ytd));
    check(`${name}: private, no-store, noindex, no referrer`, /private/.test(ok.headers.get("cache-control")) && /no-store/.test(ok.headers.get("cache-control")) && /noindex/.test(ok.headers.get("x-robots-tag")) && ok.headers.get("referrer-policy") === "no-referrer");
    for (const reason of ["not_signed_in", "no_profile", "not_owner", "demo_profile", "category_not_enabled", "plan_not_enabled"]) {
      globalThis.__owner = { ok: false, reason };
      const r = await route.GET(new Request(`http://x/api/overview/${name}${q}`));
      const b = await r.json();
      check(`${name} denied (${reason}): ${r.status}, no data`, r.status >= 401 && r.status <= 403 && !b.trend && !b.ytd);
    }
    const rs = strip(read(`src/app/api/overview/${name}/route.ts`));
    check(`${name}: the route file exports only GET and always goes through withOwner`, (rs.match(/export async function (\w+)/g) || []).join() === "export async function GET" && /withOwner/.test(rs) && !/profile_?id|profileId/i.test(rs));
  }
}

// ------------------------------------------------------------------------ source scans, UI, navigation, EN/FR
{
  const lib = strip(read("src/lib/overview/trends.ts"));
  check("trends.ts reads no table itself, writes nothing, and has no customer table (everything comes from buildMonthlyReport)", !/\.from\("/.test(lib) && !/\.(insert|update|delete|upsert|rpc)\s*\(/.test(lib) && !/ringo_customers|customer_sessions|bk_customers/.test(lib));
  check("the only arithmetic is comparison (current - previous), the percentage, and the additive sum of flows (addMinor)", /changeMinor = current - previous/.test(lib) && /addMinor\(/.test(lib));
  check("profit appears only as the explicit not_reported marker", (lib.match(/\bprofit\b/gi) || []).length === (lib.match(/profit: \{ status: "not_reported" \}/g) || []).length);
  check("year to date sums only flow fields (no receivables/inventory/outstanding/overdue identifiers in the sum)", !/receivables\.|inventory\.|outstanding|overdue/.test(lib.slice(lib.indexOf("export function sumPoints"))));
  const ui = strip(read("src/components/overview/TrendsView.tsx")), chart = strip(read("src/components/overview/TrendChart.tsx"));
  check("the screen loads from the two trend routes only, writes nothing, and never imports the server module at runtime (type import only)", /\/api\/overview\/trends\?/.test(ui) && /\/api\/overview\/ytd\?/.test(ui) && /import type \{ TrendModel, YtdModel \} from "@\/lib\/overview\/trends"/.test(ui) && !/from "@\/lib\/overview\/trends"/.test(ui.replace(/import type[^\n]*\n/, "")) && !/method: "(POST|PUT|PATCH|DELETE)"/.test(ui));
  check("the screen adds no money values (the change is the server's changeMinor)", !/Minor\s*[+]\s*\w|[+]\s*\w+\.\w*Minor/.test(ui.replace(/`\$\{minor > 0 \? "\+" : ""\}/g, "")));
  check("one chart for one metric, using the installed recharts, with an accessible name, and a data table with caption, column and row headers", /from "recharts"/.test(chart) && /role="img"/.test(chart) && /aria-label/.test(chart) && /<caption/.test(ui) && /scope="col"/.test(ui) && /scope="row"/.test(ui) && (ui.match(/<TrendChart/g) || []).length === 1);
  check("loading, empty and error states exist for the trend and the year to date", /trendsLoading/.test(ui) && /trendsEmpty/.test(ui) && /trendsUnavailable/.test(ui) && /ytdLoading/.test(ui) && /ytdUnavailable/.test(ui) && /role="alert"/.test(ui));
  check("the currency is shown (shownIn, table caption, chart label)", /shownIn\(cur\)/.test(ui) && /\(\{cur\}\)/.test(ui) && /chartLabel\(metricName, cur\)/.test(ui));
  const tabs = strip(read("src/components/reports/ReportsTabs.tsx"));
  check("tabs in order: Overview, Monthly report, Trends (Bookkeeping entries moved out to their own dashboard entry)", tabs.indexOf('"/dashboard/reports",') < tabs.indexOf("/dashboard/reports/monthly") && tabs.indexOf("/dashboard/reports/monthly") < tabs.indexOf("/dashboard/reports/trends") && !tabs.includes("/dashboard/reports/entries"));
  check("the Trends page exists", /TrendsView/.test(read("src/app/dashboard/reports/trends/page.tsx")));

  const flat = (o, p = "") => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? flat(v, `${p}${k}.`) : [`${p}${k}`]));
  eq("EN and FR overview namespaces still have exactly the same keys", flat(translations.en.overview).sort(), flat(translations.fr.overview).sort());
  const METRICS = ["revenue", "expenses", "netCash", "cashReceived", "cashPaidOut", "onlineGross", "commission", "onlineNet"];
  for (const lang of ["en", "fr"]) {
    const U = translations[lang].overview.ui;
    check(`${lang}: every metric has a name and a note`, METRICS.every((m) => U.metricNames[m] && U.metricNotes[m]));
    check(`${lang}: function strings return text`, [U.trendsSpanOption(3), U.chartLabel("M", "XAF"), U.tableCaption("M"), U.cmpBasisFull("Nov"), U.cmpBasisSame("Nov", "1", "10"), U.ytdBasis("a", "b")].every((s) => typeof s === "string" && s.length > 3));
    check(`${lang}: the comparison says it is neither profit nor loss and why a percentage may be missing`, /profit|bénéfice/i.test(U.cmpNote) && U.cmpPercentPreviousZero && U.cmpPercentSignChange && /not|ni/i.test(U.cmpNote));
    check(`${lang}: the notes keep cash, earnings, revenue apart`, /not profit|pas un bénéfice/i.test(U.metricNotes.netCash) && /not cash|pas de la trésorerie/i.test(U.metricNotes.onlineNet) && /not cash|pas de l'argent/i.test(U.metricNotes.onlineGross) && /snapshot|instantan/i.test(U.ytdNote));
  }
  const used = new Set([...read("src/components/overview/TrendsView.tsx").matchAll(/\bu\.([A-Za-z]+)/g)].map((m) => m[1]));
  check("every translation key the Trends screen uses exists in both languages", [...used].every((k) => k in translations.en.overview.ui && k in translations.fr.overview.ui), [...used].filter((k) => !(k in translations.en.overview.ui)).join());
  const en = Object.entries(translations.en.overview.ui).filter(([, v]) => typeof v === "string"), fr = translations.fr.overview.ui;
  check("French strings are really translated (no long string identical to English)", en.every(([k, v]) => v.length <= 14 || v !== fr[k]), en.filter(([k, v]) => v.length > 14 && v === fr[k]).map(([k]) => k).join());
}

for (const f of tmp) try { fs.unlinkSync(f); } catch {}
console.log(`${c.pass} passed, ${c.fail} failed`);
process.exit(c.fail ? 1 : 0);
