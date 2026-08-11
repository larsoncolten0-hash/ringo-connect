export type DateRange = { from: Date; to: Date };

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export function getPresetRange(preset: string): DateRange {
  const now = new Date();
  const today = startOfDay(now);

  switch (preset) {
    case "today":
      return { from: today, to: endOfDay(now) };
    case "last7": {
      const from = new Date(today);
      from.setDate(from.getDate() - 6);
      return { from, to: endOfDay(now) };
    }
    case "last30": {
      const from = new Date(today);
      from.setDate(from.getDate() - 29);
      return { from, to: endOfDay(now) };
    }
    case "thisMonth": {
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from, to: endOfDay(now) };
    }
    case "lastMonth": {
      const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const to = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: startOfDay(from), to: endOfDay(to) };
    }
    case "allTime":
    default: {
      const from = new Date(2020, 0, 1);
      return { from, to: endOfDay(now) };
    }
  }
}

export function formatRangeLabel(range: DateRange, locale = "en"): string {
  const fmt = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", year: "numeric" });
  return `${fmt.format(range.from)} – ${fmt.format(range.to)}`;
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString();
}

export function dayKey(d: Date): string {
  // Deliberately NOT using d.toISOString() here — that converts to UTC,
  // while startOfDay/endOfDay (used to build the bucket range) work in
  // local time. For anyone in a timezone ahead of UTC, local midnight
  // "today" converts to a UTC timestamp still on yesterday's date, so
  // today's bucket would never get generated and today's events would
  // have nowhere to land. Using local date components on both sides
  // keeps everything in the same reference frame.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Builds a continuous, zero-filled time series for the chart — daily
 * buckets for ranges under ~90 days, monthly buckets beyond that, so an
 * "all time" range doesn't render thousands of sparse daily points. */
export function buildTrendData(
  events: { created_at: string }[],
  range: DateRange
): { day: string; count: number }[] {
  const spanDays = (range.to.getTime() - range.from.getTime()) / 86400000;
  const monthly = spanDays > 90;
  const counts: Record<string, number> = {};

  events.forEach((e) => {
    const d = new Date(e.created_at);
    const key = monthly
      ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`
      : dayKey(d);
    counts[key] = (counts[key] || 0) + 1;
  });

  const result: { day: string; count: number }[] = [];

  if (monthly) {
    const cur = new Date(range.from.getFullYear(), range.from.getMonth(), 1);
    const end = new Date(range.to.getFullYear(), range.to.getMonth(), 1);
    while (cur <= end) {
      const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-01`;
      result.push({ day: key, count: counts[key] || 0 });
      cur.setMonth(cur.getMonth() + 1);
    }
  } else {
    const cur = startOfDay(range.from);
    const end = startOfDay(range.to);
    while (cur <= end) {
      const key = dayKey(cur);
      result.push({ day: key, count: counts[key] || 0 });
      cur.setDate(cur.getDate() + 1);
    }
  }

  return result;
}