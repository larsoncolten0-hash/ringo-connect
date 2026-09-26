import { createAdminClient } from "@/lib/supabase/server";

// Rank order for "never downgrade" comparisons — lowest to highest. Matches
// SubscriptionView.tsx's own ORDER array (kept as a separate literal here
// rather than importing a client component's constant into server code).
const PLAN_RANK = ["free", "basic", "pro", "business_basic", "business_pro"];

export type CardBundleGrantResult =
  | { applied: true; outcome: "granted_from_free" }
  | { applied: true; outcome: "extended_existing_plan" }
  | { applied: true; outcome: "stripe_subscriber_unchanged" }
  | { applied: false; reason: string };

/**
 * The plan-granting half of a Card + Subscription bundle purchase (card
 * fulfillment itself is unchanged — see the migration's own comment).
 * Confirmed rules:
 *   - Free            → granted `planName` for `durationDays` from now,
 *                        via the exact same fixed-duration mechanism
 *                        Fapshi/manual plan grants already use
 *                        (payment_provider + plan_expires_at).
 *   - Basic or higher, NOT on Stripe → never downgraded. Current plan's
 *     plan_expires_at is extended by `durationDays` (from the existing
 *     expiry if still in the future, otherwise from now).
 *   - Basic or higher, ON Stripe (auto-renewing, no plan_expires_at) →
 *     left completely untouched. Confirmed: there's nothing to safely
 *     "extend" on an indefinite subscription, and this is the one case
 *     that could otherwise risk corrupting a working Stripe subscription,
 *     so it's a deliberate no-op rather than a guess.
 * Never called for a plan LOWER than what the buyer already has — there's
 * no such thing here, `planName` is always 'basic', the bundle's floor.
 */
export async function applyCardBundleGrant(userId: string, planName: string, durationDays: number): Promise<CardBundleGrantResult> {
  const admin = createAdminClient();

  const [{ data: user }, { data: targetPlan }] = await Promise.all([
    admin.from("users").select("plan_id, payment_provider, plan_expires_at, plans(name)").eq("id", userId).maybeSingle(),
    admin.from("plans").select("id, name, bookings_feature_enabled").eq("name", planName).maybeSingle(),
  ]);

  if (!user) return { applied: false, reason: "user_not_found" };
  if (!targetPlan) return { applied: false, reason: "target_plan_not_found" };

  const currentPlanName = (user.plans as any)?.name || "free";

  if (user.payment_provider === "stripe") {
    // Confirmed resolution: fulfill the card, charge normally, leave
    // plan_id/plan_expires_at untouched — a Stripe subscriber already has
    // continuous access, so granting/extending doesn't apply.
    return { applied: true, outcome: "stripe_subscriber_unchanged" };
  }

  const isFree = currentPlanName === "free" || !user.plan_id;
  if (isFree) {
    const expires = new Date();
    expires.setDate(expires.getDate() + durationDays);
    await admin
      .from("users")
      .update({ plan_id: targetPlan.id, payment_provider: "fapshi", plan_expires_at: expires.toISOString() })
      .eq("id", userId);

    // Bookings default ON the same way a brand-new eligible signup already gets it (see
    // api/admin/requests/[id]/approve/route.ts) — this is the exact same "was ineligible (Free),
    // now becomes eligible" moment, just reached via a card bundle instead of initial signup. Only
    // applied here, in the FREE -> paid transition, never in the "extend an existing paid plan"
    // branch below — a creator who already had the chance to turn bookings off on their current
    // paid plan never has that choice silently overridden by buying another bundle.
    if (targetPlan.bookings_feature_enabled) {
      await admin.from("profiles").update({ bookings_enabled: true }).eq("user_id", userId);
    }

    return { applied: true, outcome: "granted_from_free" };
  }

  // Already Basic or higher (and not Stripe) — never downgrade, only
  // extend. Starts from the current expiry if it's still in the future
  // (stacking with time already paid for), otherwise from now.
  const currentExpiry = user.plan_expires_at ? new Date(user.plan_expires_at) : null;
  const base = currentExpiry && currentExpiry > new Date() ? currentExpiry : new Date();
  base.setDate(base.getDate() + durationDays);
  // plan_id and payment_provider deliberately untouched — this only ever
  // extends time on whatever plan they're already on, never changes which
  // plan that is (that would be a downgrade if they're above Basic).
  await admin.from("users").update({ plan_expires_at: base.toISOString() }).eq("id", userId);
  return { applied: true, outcome: "extended_existing_plan" };
}

/** True if `planName` is Basic-tier or above — used to decide "is this
 *  buyer already at/above what the bundle would grant." Not currently used
 *  outside applyCardBundleGrant itself, kept exported since the "never
 *  downgrade" rule is exactly the kind of check a future bundle (e.g. a
 *  Pro-tier bundle) would need to reuse rather than reimplement. */
export function planRank(planName: string): number {
  const i = PLAN_RANK.indexOf(planName);
  return i === -1 ? 0 : i;
}
