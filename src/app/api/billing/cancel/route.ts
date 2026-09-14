import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getStripeClient } from "@/lib/stripe";
import { NextResponse } from "next/server";

// Downgrading to Free doesn't need a payment method choice, but for a
// Stripe subscriber it DOES need to actually cancel the subscription at
// Stripe — otherwise they'd keep being billed even though our own
// database says they're on Free. Fapshi has no recurring subscription
// object to cancel (each renewal is a one-off manual payment), so for
// those users this is just a local plan change.
export async function POST() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const admin = createAdminClient();

  const { data: userRow } = await admin
    .from("users")
    .select("plan_id, payment_provider, stripe_subscription_id, plans(name)")
    .eq("id", user.id)
    .single();

  if (userRow?.payment_provider === "stripe" && userRow.stripe_subscription_id) {
    try {
      const stripe = await getStripeClient();
      await stripe.subscriptions.cancel(userRow.stripe_subscription_id);
    } catch (err: any) {
      // If it's already cancelled on Stripe's side, or Stripe is
      // currently disabled/unconfigured, proceed with the local
      // downgrade anyway rather than blocking the user from leaving a
      // paid plan just because the provider side had an issue.
      console.error("Stripe cancellation error:", err.message);
    }
  }

  const { data: freePlan } = await admin.from("plans").select("id").eq("name", "free").single();
  if (!freePlan) return NextResponse.json({ error: "Free plan not found" }, { status: 500 });

  await admin
    .from("users")
    .update({
      plan_id: freePlan.id,
      payment_provider: null,
      stripe_subscription_id: null,
      plan_expires_at: null,
    })
    .eq("id", user.id);

  // Organic (self-serve) downgrade signal for the admin Users analytics
  // view's churn metric — this endpoint previously wrote no audit trail at
  // all, which made a self-serve downgrade indistinguishable from "nothing
  // happened" after the fact, unlike the expiry cron's own
  // plan_expired_downgrade logging. admin_id is NOT NULL and there's no
  // human admin behind a self-serve action, so the user is recorded as
  // their own actor, same convention as plan_expired_downgrade. Skipped
  // when already on Free — this endpoint being called from that state
  // isn't a downgrade, it's a no-op, and shouldn't inflate the count.
  if (userRow && userRow.plan_id !== freePlan.id) {
    const { error: auditError } = await admin.from("admin_audit_log").insert({
      admin_id: user.id,
      action: "self_downgrade",
      target_user_id: user.id,
      details: {
        automated: false,
        reason: "self_serve_cancel",
        fromPlanId: userRow.plan_id,
        fromPlanName: (userRow.plans as any)?.name ?? null,
        toPlanId: freePlan.id,
        toPlanName: "free",
      },
    });
    if (auditError) console.error("billing/cancel: failed to write self_downgrade audit row:", auditError.message);
  }

  return NextResponse.json({ ok: true });
}