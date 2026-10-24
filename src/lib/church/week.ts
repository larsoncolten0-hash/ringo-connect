// The church's calendar rules, in ONE place (pure: no I/O, no React). All dates are Cameroon time (Africa/Douala, UTC+1, no daylight saving), like every other church date.
//
//   * An announcement's "This week" ends at the END of the coming Sunday: it is shown through Sunday and gone at midnight. Posted ON a Sunday, it lasts until the next Sunday (a full week).
//   * "1 month" and "1 year" end the same calendar day a month or a year later; a day that does not exist there (31 January + 1 month, 29 February + 1 year) ends on the last day of that month.
//   * Testimonies are shown for the church week they were published in, Monday to Sunday: every Monday at 00:00 they leave the public page by themselves.
//
// `expires_on` (announcements) is the LAST day shown, inclusive: the database stops returning an announcement the day after it.

export type AnnouncementDuration = "week" | "month" | "year";
export const ANNOUNCEMENT_DURATIONS: readonly AnnouncementDuration[] = ["week", "month", "year"];

const HOUR = 3600_000;
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Today's date in Cameroon, as YYYY-MM-DD. */
export const doualaToday = (now: number = Date.now()): string => new Date(now + HOUR).toISOString().slice(0, 10);

function parts(iso: string): [number, number, number] | null {
  const m = ISO_DAY.exec(iso);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? [y, mo, d] : null;
}
const fmt = (t: Date): string => t.toISOString().slice(0, 10);

/** 0 = Sunday … 6 = Saturday, for a YYYY-MM-DD date; null when it is not a real date. */
export function weekday(iso: string): number | null {
  const p = parts(iso);
  return p ? new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay() : null;
}

export function addDays(iso: string, n: number): string | null {
  const p = parts(iso);
  return p ? fmt(new Date(Date.UTC(p[0], p[1] - 1, p[2] + n))) : null;
}

/** The same day `n` months later, or the last day of that month when the day does not exist there. */
export function addMonths(iso: string, n: number): string | null {
  const p = parts(iso);
  if (!p) return null;
  const first = new Date(Date.UTC(p[0], p[1] - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return fmt(new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(p[2], last))));
}

export const addYears = (iso: string, n: number): string | null => addMonths(iso, 12 * n);

/** The last day of "this week": the coming Sunday, or a week from today when today is Sunday. */
export function endOfChurchWeek(today: string): string | null {
  const dow = weekday(today);
  return dow === null ? null : addDays(today, dow === 0 ? 7 : 7 - dow);
}

/** The last day an announcement is shown for a chosen duration, counted from `today`. */
export function announcementEnd(duration: AnnouncementDuration, today: string): string | null {
  return duration === "week" ? endOfChurchWeek(today) : duration === "month" ? addMonths(today, 1) : addYears(today, 1);
}

/** The instant (ms since the epoch) the current church week began: the most recent Monday at 00:00 Cameroon time. */
export function churchWeekStartMs(now: number = Date.now()): number {
  const local = new Date(now + HOUR); // Cameroon wall-clock time, read with the UTC getters
  const sinceMonday = (local.getUTCDay() + 6) % 7;
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - sinceMonday) - HOUR;
}
