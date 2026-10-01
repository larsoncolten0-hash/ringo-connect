// Business Toolkit Phase 7B (trends, month comparison, year to date): READ-ONLY views over the ONE report builder. Nothing here defines a financial
// figure: every number is a field of buildMonthlyReport (Phase 5), built per month with the lightest `sections`, and the only operations are
//   * a per-month copy of those fields (a trend point),
//   * comparison: current minus previous, and the percentage only where it is meaningful,
//   * year to date: the plain SUM of the ADDITIVE flow fields of the months January..selected (snapshots such as receivables and inventory are never summed).
// There is no profit, online seller earnings never enter cash, receivables never enter revenue or cash, and each business has ONE currency (records in other
// currencies are excluded by the builder and counted in the exclusions, never converted).
import { addMinor, currencyMinorDigits } from "@/lib/bookkeeping/money";
import { monthRange } from "@/lib/bookkeeping/summary";
import { buildMonthlyReport, type ReportModel, type ReportOwner } from "@/lib/reports/build";
import { REPORT_MIN_YEAR, periodFor, type ReportPeriod } from "@/lib/reports/period";

export const TRENDS_VERSION = 1;
export const TREND_SPANS = [3, 6, 12] as const;
export const DEFAULT_SPAN = 6;
const BUILD_CONCURRENCY = 3;

/** The lightest build: only the sections the flow figures come from (entries and orders). Receivables and inventory are snapshots and are not needed. */
export const LIGHT_SECTIONS = { topProducts: false, invoicing: false, business: false, receivables: false, inventory: false } as const;

export type TrendPoint = {
  year: number; month: number; from: string; to: string; kind: ReportPeriod["kind"];
  revenueMinor: number; expensesMinor: number;
  cashReceivedMinor: number; cashPaidOutMinor: number; netCashMinor: number;
  onlineGrossMinor: number; commissionMinor: number; onlineNetMinor: number; onlineNetPaidOutMinor: number; onlineNetNotPaidMinor: number;
  paidOnlineOrders: number; ordersWithoutEarnings: number;
  exclusions: { voidedEntries: number; otherCurrency: number; doubleCountPrevented: number; unreadable: number };
  refunded: { count: number; grossMinor: number };
};

/** The money metrics that can be compared and charted. Counts and disclosures are carried on the point but are not charted. */
export const TREND_METRICS = ["revenue", "expenses", "netCash", "cashReceived", "cashPaidOut", "onlineGross", "commission", "onlineNet"] as const;
export type TrendMetric = (typeof TREND_METRICS)[number];
const METRIC_FIELD: Record<TrendMetric, keyof TrendPoint> = {
  revenue: "revenueMinor", expenses: "expensesMinor", netCash: "netCashMinor", cashReceived: "cashReceivedMinor", cashPaidOut: "cashPaidOutMinor",
  onlineGross: "onlineGrossMinor", commission: "commissionMinor", onlineNet: "onlineNetMinor",
};

export type Comparison = { currentMinor: number; previousMinor: number; changeMinor: number; percent: number | null; percentReason: null | "previous_zero" | "sign_change" };

/** Copies the fields of one report into a trend point. No arithmetic. */
export function pointOf(r: ReportModel): TrendPoint {
  return {
    year: r.period.year, month: r.period.month, from: r.period.from, to: r.period.to, kind: r.period.kind,
    revenueMinor: r.revenue.totalMinor, expensesMinor: r.expenses.totalMinor,
    cashReceivedMinor: r.cash.receivedDirectMinor, cashPaidOutMinor: r.cash.paidOutMinor, netCashMinor: r.cash.netMovementMinor,
    onlineGrossMinor: r.online.grossMinor, commissionMinor: r.online.commissionMinor, onlineNetMinor: r.online.netMinor,
    onlineNetPaidOutMinor: r.online.netPaidOutMinor, onlineNetNotPaidMinor: r.online.netNotYetPaidOutMinor,
    paidOnlineOrders: r.counts.paidOnlineOrders, ordersWithoutEarnings: r.online.ordersWithoutEarnings,
    exclusions: { ...r.exclusions }, refunded: { count: r.refundedOrders.count, grossMinor: r.refundedOrders.grossMinor },
  };
}

/** current - previous. The percentage is only given when it means something: never with a zero base (no divide by zero, no fake 0%), and never when the
 * sign changed (e.g. net cash from negative to positive), where a percentage of the old magnitude would mislead. */
export function compareValues(current: number, previous: number): Comparison {
  const changeMinor = current - previous;
  if (previous === 0) return { currentMinor: current, previousMinor: previous, changeMinor, percent: null, percentReason: "previous_zero" };
  if (current !== 0 && Math.sign(current) !== Math.sign(previous)) return { currentMinor: current, previousMinor: previous, changeMinor, percent: null, percentReason: "sign_change" };
  return { currentMinor: current, previousMinor: previous, changeMinor, percent: Math.round((changeMinor / Math.abs(previous)) * 1000) / 10, percentReason: null };
}

const pad = (n: number) => String(n).padStart(2, "0");
const prevMonthOf = (year: number, month: number) => (month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 });

/** The `span` months ending at (year, month), oldest first; months before the first reportable year are dropped. */
export function monthsEndingAt(year: number, month: number, span: number): { year: number; month: number }[] {
  const out: { year: number; month: number }[] = [];
  let cur = { year, month };
  for (let i = 0; i < span && cur.year >= REPORT_MIN_YEAR; i++) {
    out.unshift(cur);
    cur = prevMonthOf(cur.year, cur.month);
  }
  return out;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

const buildPoint = async (owner: ReportOwner, period: ReportPeriod, now: Date) => pointOf(await buildMonthlyReport(owner, period, { now, sections: LIGHT_SECTIONS }));

export type TrendModel = {
  version: number;
  generatedAt: string;
  currency: string;
  minorDigits: number;
  span: number;
  selected: { year: number; month: number; kind: ReportPeriod["kind"]; from: string; to: string };
  points: TrendPoint[];
  /** Records left out of the figures across the whole span (counts only): the same exclusions the Monthly report discloses. */
  disclosures: { exclusions: YtdTotals["exclusions"]; refunded: YtdTotals["refunded"]; ordersWithoutEarnings: number };
  comparison: {
    previous: { year: number; month: number; from: string; to: string; basis: "full_month" | "same_days" } | null;
    metrics: Record<TrendMetric, Comparison> | null;
  };
  profit: { status: "not_reported" };
};

export async function buildTrends(owner: ReportOwner, selected: ReportPeriod, span: number, opts: { now?: Date } = {}): Promise<TrendModel> {
  const now = opts.now ?? new Date();
  const periods = monthsEndingAt(selected.year, selected.month, span).map((m) => {
    const p = periodFor(m.year, m.month, now);
    if (!p.ok) throw new Error(`trend period: ${p.error}`);
    return p.period;
  });
  const points = await mapLimit(periods, BUILD_CONCURRENCY, (p) => buildPoint(owner, p, now));
  const current = points[points.length - 1];

  // previous equivalent period: a completed month compares with the whole previous month; the current (partial) month compares with the SAME days of the
  // previous month, so a partial month is never set against a full one
  let previous: TrendModel["comparison"]["previous"] = null;
  let previousPoint: TrendPoint | null = null;
  const pm = prevMonthOf(selected.year, selected.month);
  if (pm.year >= REPORT_MIN_YEAR) {
    const range = monthRange(`${pm.year}-${pad(pm.month)}-01`);
    if (selected.kind === "month_to_date") {
      const lastDay = Number(range.to.slice(8));
      const day = Math.min(Number(selected.to.slice(8)), lastDay);
      const period: ReportPeriod = { year: pm.year, month: pm.month, from: range.from, to: `${pm.year}-${pad(pm.month)}-${pad(day)}`, kind: day === lastDay ? "month" : "month_to_date", timeZone: selected.timeZone };
      previousPoint = await buildPoint(owner, period, now);
      previous = { year: pm.year, month: pm.month, from: period.from, to: period.to, basis: "same_days" };
    } else {
      previousPoint = points.length >= 2 ? points[points.length - 2] : await buildPoint(owner, { year: pm.year, month: pm.month, from: range.from, to: range.to, kind: "month", timeZone: selected.timeZone }, now);
      previous = { year: pm.year, month: pm.month, from: range.from, to: range.to, basis: "full_month" };
    }
  }
  const metrics = previousPoint
    ? (Object.fromEntries(TREND_METRICS.map((m) => [m, compareValues(current[METRIC_FIELD[m]] as number, previousPoint![METRIC_FIELD[m]] as number)])) as Record<TrendMetric, Comparison>)
    : null;

  const spanTotals = sumPoints(points);
  const currency = (owner.profile.currency || "XAF").toUpperCase();
  return {
    version: TRENDS_VERSION, generatedAt: now.toISOString(), currency, minorDigits: currencyMinorDigits(currency), span,
    selected: { year: selected.year, month: selected.month, kind: selected.kind, from: selected.from, to: selected.to },
    points, disclosures: { exclusions: spanTotals.exclusions, refunded: spanTotals.refunded, ordersWithoutEarnings: spanTotals.ordersWithoutEarnings }, comparison: { previous, metrics }, profit: { status: "not_reported" },
  };
}

// ------------------------------------------------------------------------------------------------------------------------------ year to date
export type YtdTotals = Omit<TrendPoint, "year" | "month" | "from" | "to" | "kind">;
export type YtdModel = {
  version: number;
  generatedAt: string;
  currency: string;
  minorDigits: number;
  year: number;
  throughMonth: number;
  from: string;
  to: string;
  partial: boolean;
  months: number;
  totals: YtdTotals;
  profit: { status: "not_reported" };
};

/** Sums the ADDITIVE flow fields of trend points. Only flows (money moved or recorded in a period) and record counts are summed. */
export function sumPoints(points: TrendPoint[]): YtdTotals {
  const z: YtdTotals = {
    revenueMinor: 0, expensesMinor: 0, cashReceivedMinor: 0, cashPaidOutMinor: 0, netCashMinor: 0,
    onlineGrossMinor: 0, commissionMinor: 0, onlineNetMinor: 0, onlineNetPaidOutMinor: 0, onlineNetNotPaidMinor: 0,
    paidOnlineOrders: 0, ordersWithoutEarnings: 0,
    exclusions: { voidedEntries: 0, otherCurrency: 0, doubleCountPrevented: 0, unreadable: 0 }, refunded: { count: 0, grossMinor: 0 },
  };
  for (const p of points) {
    z.revenueMinor = addMinor(z.revenueMinor, p.revenueMinor);
    z.expensesMinor = addMinor(z.expensesMinor, p.expensesMinor);
    z.cashReceivedMinor = addMinor(z.cashReceivedMinor, p.cashReceivedMinor);
    z.cashPaidOutMinor = addMinor(z.cashPaidOutMinor, p.cashPaidOutMinor);
    z.netCashMinor = addMinor(z.netCashMinor, p.netCashMinor);
    z.onlineGrossMinor = addMinor(z.onlineGrossMinor, p.onlineGrossMinor);
    z.commissionMinor = addMinor(z.commissionMinor, p.commissionMinor);
    z.onlineNetMinor = addMinor(z.onlineNetMinor, p.onlineNetMinor);
    z.onlineNetPaidOutMinor = addMinor(z.onlineNetPaidOutMinor, p.onlineNetPaidOutMinor);
    z.onlineNetNotPaidMinor = addMinor(z.onlineNetNotPaidMinor, p.onlineNetNotPaidMinor);
    z.paidOnlineOrders += p.paidOnlineOrders;
    z.ordersWithoutEarnings += p.ordersWithoutEarnings;
    z.exclusions.voidedEntries += p.exclusions.voidedEntries;
    z.exclusions.otherCurrency += p.exclusions.otherCurrency;
    z.exclusions.doubleCountPrevented += p.exclusions.doubleCountPrevented;
    z.exclusions.unreadable += p.exclusions.unreadable;
    z.refunded.count += p.refunded.count;
    z.refunded.grossMinor = addMinor(z.refunded.grossMinor, p.refunded.grossMinor);
  }
  return z;
}

export async function buildYtd(owner: ReportOwner, selected: ReportPeriod, opts: { now?: Date } = {}): Promise<YtdModel> {
  const now = opts.now ?? new Date();
  const periods: ReportPeriod[] = [];
  for (let m = 1; m <= selected.month; m++) {
    const p = periodFor(selected.year, m, now);
    if (!p.ok) throw new Error(`ytd period: ${p.error}`);
    periods.push(p.period);
  }
  const reports = await mapLimit(periods, BUILD_CONCURRENCY, (p) => buildMonthlyReport(owner, p, { now, sections: LIGHT_SECTIONS }));
  return {
    version: TRENDS_VERSION, generatedAt: now.toISOString(), currency: reports[0].currency, minorDigits: reports[0].minorDigits,
    year: selected.year, throughMonth: selected.month, from: `${selected.year}-01-01`, to: selected.to, partial: selected.kind === "month_to_date",
    months: reports.length, totals: sumPoints(reports.map(pointOf)), profit: { status: "not_reported" },
  };
}
