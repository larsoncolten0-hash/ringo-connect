// Shared period/trend helpers for Ringo AI's read-only business intelligence
// tools (Phase 4 increment 4). Pure functions — no DB access, no
// server-only imports — so they're directly unit-testable.
//
// No per-profile timezone exists anywhere in this codebase (confirmed by
// audit). UTC calendar-day boundaries are the deliberate, documented
// convention here — the one already used elsewhere in Ringo AI
// (snapshot.ts, eventsSummary.ts use UTC date strings), just extended from
// date-only columns to timestamp columns for the first time.

export const BI_PERIODS = ["today", "yesterday", "7d", "30d", "this_month", "previous_month"] as const;
export type BiPeriod = (typeof BI_PERIODS)[number];

export interface PeriodRange {
  period: BiPeriod;
  /** UTC, inclusive. */
  start: Date;
  /** UTC, exclusive. */
  end: Date;
  label: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY_MS);

export function resolvePeriod(period: BiPeriod, now: Date = new Date()): PeriodRange {
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  switch (period) {
    case "today":
      return { period, start: todayStart, end: addDays(todayStart, 1), label: "today" };
    case "yesterday":
      return { period, start: addDays(todayStart, -1), end: todayStart, label: "yesterday" };
    case "7d":
      return { period, start: addDays(todayStart, -6), end: addDays(todayStart, 1), label: "the last 7 days" };
    case "30d":
      return { period, start: addDays(todayStart, -29), end: addDays(todayStart, 1), label: "the last 30 days" };
    case "this_month":
      return { period, start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), end: addDays(todayStart, 1), label: "this month" };
    case "previous_month":
      return {
        period,
        start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)),
        end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
        label: "the previous month",
      };
    default:
      throw new Error(`resolvePeriod: unknown period "${period}"`);
  }
}

export function isBiPeriod(value: unknown): value is BiPeriod {
  return typeof value === "string" && (BI_PERIODS as readonly string[]).includes(value);
}

/** Server-controlled clamp — never trusts a model-supplied limit as-is. */
export function clampLimit(raw: unknown, def = 5, max = 10): number {
  const n = typeof raw === "number" && Number.isFinite(raw) ? Math.floor(raw) : def;
  return Math.min(max, Math.max(1, n));
}

/** The UTC calendar-day key for a Postgres timestamptz string (already UTC on the wire). */
export function utcDateKey(iso: string): string {
  return iso.slice(0, 10);
}

export interface DailyBucket {
  date: string;
  [key: string]: string | number;
}

/**
 * Groups rows into daily buckets (UTC), summing the numeric fields `values`
 * extracts from each row. Returns buckets sorted oldest → newest. A
 * single-day period naturally produces a single bucket — callers decide
 * whether that's worth showing as a "trend."
 */
export function bucketByUtcDay<T>(rows: T[], dateOf: (row: T) => string, values: (row: T) => Record<string, number>): DailyBucket[] {
  const buckets = new Map<string, Record<string, number>>();
  for (const row of rows) {
    const key = utcDateKey(dateOf(row));
    const existing = buckets.get(key) ?? {};
    for (const [k, v] of Object.entries(values(row))) existing[k] = (existing[k] ?? 0) + v;
    buckets.set(key, existing);
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, vals]) => ({ date, ...vals }));
}
