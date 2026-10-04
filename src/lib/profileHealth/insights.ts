import type { HealthActivity } from "./types";

// Turns two real numbers into one plain statement (the sentence itself lives in translations.ts).
// A comparison is only produced when both windows were actually measured.

export type TrendDirection = "up" | "down" | "flat" | "new" | "none";

export interface Trend {
  direction: TrendDirection;
  /** Rounded % change vs the previous window; null when there is no meaningful baseline. */
  changePct: number | null;
}

/** Changes smaller than this (in %) read as "steady" rather than up/down. */
export const FLAT_THRESHOLD_PCT = 5;

export function compareTrend(current: number, previous: number): Trend {
  if (current <= 0 && previous <= 0) return { direction: "none", changePct: null };
  if (previous <= 0) return { direction: "new", changePct: null };
  const changePct = Math.round(((current - previous) / previous) * 100);
  if (Math.abs(changePct) < FLAT_THRESHOLD_PCT) return { direction: "flat", changePct };
  return { direction: changePct > 0 ? "up" : "down", changePct };
}

/** Visits in the last 7 days vs the 7 days before. Null if either window is unknown. */
export function visitsTrend(activity: HealthActivity | null | undefined): Trend | null {
  if (!activity || typeof activity.pageViews7d !== "number" || typeof activity.pageViewsPrev7d !== "number") return null;
  return compareTrend(activity.pageViews7d, activity.pageViewsPrev7d);
}
