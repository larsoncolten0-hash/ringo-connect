// Business Toolkit Phase 5 (reports): the reporting period. Pure (no database, no network). V1 reports ONE calendar month in business-local time
// (Africa/Douala, the same zone as every other Business Toolkit figure): a completed month, or the current month up to today. There is no
// custom date range in V1.
import { DEFAULT_TIME_ZONE, isDateKey, monthRange, toLocalDateKey } from "@/lib/bookkeeping/summary";

export const REPORT_MIN_YEAR = 2020;
export const REPORT_LANGS = ["en", "fr"] as const;
export type ReportLang = (typeof REPORT_LANGS)[number];

export type ReportPeriod = {
  year: number;
  month: number; // 1-12
  from: string; // YYYY-MM-DD, first day of the month
  to: string; // YYYY-MM-DD, last day of the month, or today for the current month
  kind: "month" | "month_to_date";
  timeZone: string;
};

export type PeriodError = "invalid_year" | "invalid_month" | "period_in_future" | "period_too_old";

const pad = (n: number) => String(n).padStart(2, "0");

/** The business-local calendar date of an instant. */
export const todayKeyOf = (now: Date = new Date()) => toLocalDateKey(now, DEFAULT_TIME_ZONE);

/** The period for a given year and month (1-12), judged against `now`. The current month ends today; a later month is refused. */
export function periodFor(year: number, month: number, now: Date = new Date()): { ok: true; period: ReportPeriod } | { ok: false; error: PeriodError } {
  if (!Number.isInteger(year) || year < 1000 || year > 9999) return { ok: false, error: "invalid_year" };
  if (!Number.isInteger(month) || month < 1 || month > 12) return { ok: false, error: "invalid_month" };
  if (year < REPORT_MIN_YEAR) return { ok: false, error: "period_too_old" };
  const today = todayKeyOf(now);
  const first = `${year}-${pad(month)}-01`;
  if (first > today) return { ok: false, error: "period_in_future" };
  const range = monthRange(first);
  const current = range.from <= today && today <= range.to;
  return { ok: true, period: { year, month, from: range.from, to: current ? today : range.to, kind: current ? "month_to_date" : "month", timeZone: DEFAULT_TIME_ZONE } };
}

/** The month before the one `now` falls in (the default report: the last COMPLETED month). */
export function previousCompletedMonth(now: Date = new Date()): { year: number; month: number } {
  const [y, m] = todayKeyOf(now).split("-").map(Number);
  return m === 1 ? { year: y - 1, month: 12 } : { year: y, month: m - 1 };
}

/** Parses the query string values. Neither given = the previous completed month; only one given is an error. */
export function parsePeriodQuery(input: { year?: string | null; month?: string | null }, now: Date = new Date()): { ok: true; period: ReportPeriod } | { ok: false; error: PeriodError } {
  const y = input.year ?? null;
  const m = input.month ?? null;
  if (y === null && m === null) {
    const prev = previousCompletedMonth(now);
    // the previous month can be before the minimum only in the first month of REPORT_MIN_YEAR; refuse it like any other too-old period
    return periodFor(prev.year, prev.month, now);
  }
  if (y === null || !/^\d{4}$/.test(y)) return { ok: false, error: "invalid_year" };
  if (m === null || !/^\d{1,2}$/.test(m)) return { ok: false, error: "invalid_month" };
  return periodFor(Number(y), Number(m), now);
}

/** The months offered by the selector: the current month (to date) first, then earlier months, newest first. */
export function periodOptions(now: Date = new Date(), count = 24): { year: number; month: number; kind: ReportPeriod["kind"] }[] {
  const [y0, m0] = todayKeyOf(now).split("-").map(Number);
  const out: { year: number; month: number; kind: ReportPeriod["kind"] }[] = [];
  let y = y0, m = m0;
  for (let i = 0; i < count && y >= REPORT_MIN_YEAR; i++) {
    out.push({ year: y, month: m, kind: i === 0 ? "month_to_date" : "month" });
    if (m === 1) { y -= 1; m = 12; } else m -= 1;
  }
  return out;
}

export const isReportLang = (v: unknown): v is ReportLang => typeof v === "string" && (REPORT_LANGS as readonly string[]).includes(v);

export { isDateKey };
