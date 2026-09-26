// Ringo Connect — centralized subscription entitlement helpers. Subscription controls ACCESS, never
// DATA RETENTION: downgrading a plan (by expiry, self-service downgrade, or an admin change) must
// never delete, reorder, or mutate a creator's links/products/theme — it only changes what's
// CURRENTLY visible/usable. These are pure functions (no DB access) that every enforcement point
// (public profile rendering, dashboard "hidden content" summaries) should share, rather than each
// reimplementing its own slicing/limit logic.
//
// The actual limits/flags themselves already live on the `plans` table (max_links, max_products,
// custom_theme_enabled, etc.) — there is no separate "entitlements" table or config to maintain here,
// only the logic that applies those existing columns consistently.

export type PlanLimits = {
  maxLinks: number | null;
  maxProducts: number | null;
};

/**
 * Splits an already-plan-agnostic list of items (links, products — anything with a stable
 * `sort_order`) into what the CURRENT plan allows to show publicly vs. what stays hidden. Always
 * sorts by `sort_order` first, so "visible" is always the creator's own first N items in their own
 * chosen order (never re-ordered, never dropped) — hidden items are simply excluded from what's
 * returned to a caller, never deleted or mutated in the database. `maxCount === null` means
 * unlimited (current plan allows everything).
 */
export function splitByPlanLimit<T extends { sort_order?: number | null }>(
  items: T[],
  maxCount: number | null
): { visible: T[]; hidden: T[] } {
  const sorted = [...items].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  if (maxCount == null) return { visible: sorted, hidden: [] };
  return { visible: sorted.slice(0, maxCount), hidden: sorted.slice(maxCount) };
}

/** How many of `totalCount` existing items exceed the current plan's limit — never negative. */
export function countHidden(totalCount: number, maxCount: number | null): number {
  if (maxCount == null) return 0;
  return Math.max(0, totalCount - maxCount);
}

/**
 * Whether the current plan allows the creator's custom theme (colors/background/button style) to
 * actually apply on the public profile. The saved values themselves (profiles.theme_color etc.)
 * are never touched by this — a caller that gets `false` back should render the profile's FIXED
 * DEFAULT theme instead, while what's stored in the database stays exactly as the creator left it,
 * ready to reapply automatically the moment they're back on a plan with custom_theme_enabled.
 */
export function isCustomThemeAllowed(plan: { custom_theme_enabled?: boolean | null } | null | undefined): boolean {
  return plan?.custom_theme_enabled === true;
}
