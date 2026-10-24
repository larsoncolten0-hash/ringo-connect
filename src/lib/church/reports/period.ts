import type { Checked } from "../validation";

// Churches & Ministries Reports (Phase 10): the date range of a report, in the Africa/Douala calendar (UTC+1, no daylight saving). Pure: no I/O.
// A range is whole days, both ends included. The database stores some dates as plain days (events, Daily Words) and some as instants (when a person joined the roster); `fromUtc` / `toUtcExclusive`
// are the instants that bound those whole Douala days.

export const REPORT_MIN_DAY = "2020-01-01";
/** Longest range a report covers (days, both ends included) and how far ahead of today its end may be (to look at upcoming events). */
export const REPORT_MAX_DAYS = 366;
export const REPORT_MAX_AHEAD_DAYS = 366;
export const REPORT_DEFAULT_DAYS = 30;

export interface ReportPeriod {
  from: string;
  to: string;
  days: number;
  fromUtc: string;
  toUtcExclusive: string;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
const toMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** A real calendar day, YYYY-MM-DD (2026-02-30 is refused). */
export const isRealDay = (v: unknown): v is string => typeof v === "string" && ISO_DAY.test(v) && Number.isFinite(toMs(v)) && fromMs(toMs(v)) === v;
export const addDays = (day: string, n: number): string => fromMs(toMs(day) + n * DAY_MS);

/** The instant a Douala day starts (00:00 at UTC+1 is 23:00 UTC the day before). */
export const doualaDayStartUtc = (day: string): string => new Date(toMs(day) - 3_600_000).toISOString();

export function parseReportPeriod(fromRaw: string | null, toRaw: string | null, today: string): Checked<ReportPeriod> {
  const to = toRaw === null ? today : toRaw;
  const from = fromRaw === null ? addDays(to, -(REPORT_DEFAULT_DAYS - 1)) : fromRaw;
  if (!isRealDay(from)) return { ok: false, code: "invalid_report_date", field: "from" };
  if (!isRealDay(to)) return { ok: false, code: "invalid_report_date", field: "to" };
  if (from < REPORT_MIN_DAY) return { ok: false, code: "invalid_report_date", field: "from" };
  if (to < from) return { ok: false, code: "invalid_range", field: "to" };
  if (to > addDays(today, REPORT_MAX_AHEAD_DAYS)) return { ok: false, code: "invalid_report_date", field: "to" };
  const days = Math.round((toMs(to) - toMs(from)) / DAY_MS) + 1;
  if (days > REPORT_MAX_DAYS) return { ok: false, code: "range_too_long", field: "to" };
  return { ok: true, value: { from, to, days, fromUtc: doualaDayStartUtc(from), toUtcExclusive: doualaDayStartUtc(addDays(to, 1)) } };
}
