// Pricing itself lives in the `plans` table (price_usd, price_xaf
// columns) so it's editable from the admin UI without a redeploy — this
// file just keeps the small pure helper that doesn't need the database.

// "business" was renamed to "business_pro" (plus the new "business_basic"
// row added alongside it) by the 2026-10-05 pricing restructure — see that
// migration's own header for the full context. Every literal plan-name
// comparison in the app needs to know both new names now.
export type PlanName = "free" | "basic" | "pro" | "business_basic" | "business_pro";

export function isPaidPlan(planName: string): planName is "basic" | "pro" | "business_basic" | "business_pro" {
  return planName === "basic" || planName === "pro" || planName === "business_basic" || planName === "business_pro";
}