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
    .select("payment_provider, stripe_subscription_id")
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

  return NextResponse.json({ ok: true });
}