// Pricing itself now lives in the `plans` table (price_usd, price_xaf
// columns) so it's editable from the admin UI without a redeploy — this
// file just keeps the small pure helper that doesn't need the database.

export type PlanName = "free" | "pro" | "business";

export function isPaidPlan(planName: string): planName is "pro" | "business" {
  return planName === "pro" || planName === "business";
}