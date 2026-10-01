// Ringo AI x Business Toolkit, Phase A: the reporting periods the AI tools can ask for. ALL dates are Africa/Douala business dates (the same zone as every
// Business Toolkit figure; src/lib/reports/period.ts todayKeyOf), NEVER the UTC days of src/lib/ai/tools/period.ts. The result is a ReportPeriod for the
// existing report builder, which converts the dates to exact instants itself. Pure: no database, no network.
import { DEFAULT_TIME_ZONE, isDateKey, monthRange } from "@/lib/bookkeeping/summary";
import { REPORT_MIN_YEAR, todayKeyOf, type ReportPeriod } from "@/lib/reports/period";

export const BUSINESS_PERIODS = ["today", "yesterday", "this_week", "this_month", "previous_month", "custom"] as const;
export type BusinessPeriodKind = (typeof BUSINESS_PERIODS)[number];
/** A custom range is capped so one tool call stays well inside the tool time limit; longer questions use the trends tool. */
export const MAX_CUSTOM_DAYS = 93;

export type ResolvedPeriod = { ok: true; period: ReportPeriod; from: string; to: string; label: string } | { ok: false; error: "invalid_period" | "range_in_future" | "range_too_long" | "range_too_old" | "range_order" };

const shift = (key: string, days: number) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};
const daysInclusive = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

function make(from: string, to: string, today: string, label: string): ResolvedPeriod {
  const [year, month] = from.split("-").map(Number);
  const r = monthRange(from);
  const fullMonth = from === r.from && to === r.to;
  return { ok: true, from, to, label, period: { year, month, from, to, kind: fullMonth ? "month" : "month_to_date", timeZone: DEFAULT_TIME_ZONE } };
}

export function resolveBusinessPeriod(kind: BusinessPeriodKind, now: Date = new Date(), custom?: { from?: unknown; to?: unknown }): ResolvedPeriod {
  const today = todayKeyOf(now);
  switch (kind) {
    case "today":
      return make(today, today, today, "today");
    case "yesterday": {
      const y = shift(today, -1);
      return make(y, y, today, "yesterday");
    }
    case "this_week": {
      const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = Sunday
      return make(shift(today, -((dow + 6) % 7)), today, today, "this week (Monday to today)");
    }
    case "this_month":
      return make(`${today.slice(0, 7)}-01`, today, today, "this month so far");
    case "previous_month": {
      const last = shift(`${today.slice(0, 7)}-01`, -1);
      const r = monthRange(last);
      if (Number(r.from.slice(0, 4)) < REPORT_MIN_YEAR) return { ok: false, error: "range_too_old" };
      return make(r.from, r.to, today, "the previous month");
    }
    case "custom": {
      const from = custom?.from, to = custom?.to;
      if (!isDateKey(from) || !isDateKey(to)) return { ok: false, error: "invalid_period" };
      if (from > to) return { ok: false, error: "range_order" };
      if (to > today) return { ok: false, error: "range_in_future" };
      if (Number(from.slice(0, 4)) < REPORT_MIN_YEAR) return { ok: false, error: "range_too_old" };
      if (daysInclusive(from, to) > MAX_CUSTOM_DAYS) return { ok: false, error: "range_too_long" };
      return make(from, to, today, `${from} to ${to}`);
    }
    default:
      return { ok: false, error: "invalid_period" };
  }
}

export const isBusinessPeriodKind = (v: unknown): v is BusinessPeriodKind => typeof v === "string" && (BUSINESS_PERIODS as readonly string[]).includes(v);
