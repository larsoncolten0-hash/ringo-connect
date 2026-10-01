import { profileHasCategory, type CategoryId } from "@/lib/categories";

// Pure (no I/O) access decision for the Business Toolkit's bookkeeping — see ./access.ts for how the
// facts are gathered. Kept separate so it can be unit-tested without a server runtime.

/** Categories the toolkit is enabled for. Adding a category later is a one-line change here — the same
 *  modules serve every category; nothing is duplicated. */
export const BOOKKEEPING_CATEGORIES: readonly CategoryId[] = ["business_ecommerce"];

export type BookkeepingDenial = "not_signed_in" | "no_profile" | "not_owner" | "demo_profile" | "category_not_enabled" | "plan_not_enabled";

export type AccessFacts = {
  userId: string | null;
  profile: { id: string; user_id: string | null; category?: string | null; categories?: string[] | null; is_demo?: boolean | null } | null;
  /** plans.business_toolkit_enabled of the profile OWNER's plan; null/undefined when unreadable. */
  planEnabled: boolean | null | undefined;
};

/** Pure decision (unit-tested). */
export function decideBookkeepingAccess(f: AccessFacts): { ok: true } | { ok: false; reason: BookkeepingDenial } {
  if (!f.userId) return { ok: false, reason: "not_signed_in" };
  if (!f.profile) return { ok: false, reason: "no_profile" };
  if (f.profile.user_id !== f.userId) return { ok: false, reason: "not_owner" };
  if (f.profile.is_demo === true) return { ok: false, reason: "demo_profile" };
  if (!BOOKKEEPING_CATEGORIES.some((c) => profileHasCategory(f.profile as any, c))) return { ok: false, reason: "category_not_enabled" };
  if (f.planEnabled !== true) return { ok: false, reason: "plan_not_enabled" };
  return { ok: true };
}

export const DENIAL_STATUS: Record<BookkeepingDenial, number> = {
  not_signed_in: 401,
  no_profile: 403,
  not_owner: 403,
  demo_profile: 403,
  category_not_enabled: 403,
  plan_not_enabled: 403,
};
