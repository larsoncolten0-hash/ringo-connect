import Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/server";
import { getPlatformSettings } from "@/lib/platformSettings";
import { NextResponse } from "next/server";

// Configure this URL in the Stripe dashboard (Developers → Webhooks),
// subscribed to: checkout.session.completed, customer.subscription.updated,
// customer.subscription.deleted.
//
// Unlike Fapshi, Stripe does provide (and strongly expects you to use) a
// signature to verify a webhook genuinely came from them — that's what
// the webhook secret and constructEvent below are for. Never skip this
// check; without it, anyone could POST a fake "payment succeeded" event.
//
// Signature verification runs regardless of the admin's Stripe on/off
// toggle — if it was ever on when a subscription was created, a late
// cancellation/renewal event for that subscription should still be
// processed correctly even if the toggle was flipped off since.

export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get("stripe-signature");
  const settings = await getPlatformSettings();

  if (!settings.stripeSecretKey || !settings.stripeWebhookSecret) {
    console.error("Stripe webhook received but Stripe is not configured.");
    return NextResponse.json({ error: "Stripe not configured" }, { status: 503 });
  }

  // See src/lib/stripe.ts for why apiVersion is deliberately omitted
  // entirely rather than set to any specific value or even null.
  const stripe = new Stripe(settings.stripeSecretKey);

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature!, settings.stripeWebhookSecret);
  } catch (err: any) {
    console.error("Stripe webhook signature verification failed:", err.message);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Maps a Stripe Price ID back to which plan + interval it represents —
  // six possible IDs now that each of the three paid plans has a
  // monthly and yearly Price object.
  const priceToPlan: Record<string, { planName: string; interval: "monthly" | "yearly" }> = {
    ...(settings.stripePriceBasic
      ? { [settings.stripePriceBasic]: { planName: "basic", interval: "monthly" } }
      : {}),
    ...(settings.stripePriceBasicYearly
      ? { [settings.stripePriceBasicYearly]: { planName: "basic", interval: "yearly" } }
      : {}),
    ...(settings.stripePricePro ? { [settings.stripePricePro]: { planName: "pro", interval: "monthly" } } : {}),
    ...(settings.stripePriceProYearly
      ? { [settings.stripePriceProYearly]: { planName: "pro", interval: "yearly" } }
      : {}),
    ...(settings.stripePriceBusiness
      ? { [settings.stripePriceBusiness]: { planName: "business", interval: "monthly" } }
      : {}),
    ...(settings.stripePriceBusinessYearly
      ? { [settings.stripePriceBusinessYearly]: { planName: "business", interval: "yearly" } }
      : {}),
  };

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.userId || session.client_reference_id;
      const planName = session.metadata?.planName;
      const interval = session.metadata?.interval === "yearly" ? "yearly" : "monthly";
      if (!userId || !planName) break;

      const { data: plan } = await admin.from("plans").select("id").eq("name", planName).single();
      if (!plan) break;

      await admin
        .from("users")
        .update({
          plan_id: plan.id,
          payment_provider: "stripe",
          billing_interval: interval,
          stripe_customer_id: session.customer as string,
          stripe_subscription_id: session.subscription as string,
          plan_expires_at: null, // Stripe renews itself; no fixed expiry to track
        })
        .eq("id", userId);

      await admin.from("payment_transactions").insert({
        user_id: userId,
        provider: "stripe",
        provider_transaction_id: session.id,
        plan_name: planName,
        billing_interval: interval,
        amount: (session.amount_total || 0) / 100,
        currency: (session.currency || "usd").toUpperCase(),
        status: "success",
      });
      break;
    }

    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      const userId = subscription.metadata?.userId;
      if (!userId) break;

      if (subscription.status === "active" || subscription.status === "trialing") {
        const priceId = subscription.items.data[0]?.price.id;
        const mapped = priceId ? priceToPlan[priceId] : null;
        if (mapped) {
          const { data: plan } = await admin.from("plans").select("id").eq("name", mapped.planName).single();
          if (plan) {
            await admin
              .from("users")
              .update({ plan_id: plan.id, billing_interval: mapped.interval })
              .eq("id", userId);
          }
        }
      } else if (["canceled", "unpaid", "incomplete_expired"].includes(subscription.status)) {
        const { data: freePlan } = await admin.from("plans").select("id").eq("name", "free").single();
        if (freePlan) await admin.from("users").update({ plan_id: freePlan.id }).eq("id", userId);
      }
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const userId = subscription.metadata?.userId;
      if (!userId) break;

      const { data: freePlan } = await admin.from("plans").select("id").eq("name", "free").single();
      if (freePlan) {
        await admin
          .from("users")
          .update({ plan_id: freePlan.id, stripe_subscription_id: null })
          .eq("id", userId);
      }
      break;
    }
  }

  return NextResponse.json({ received: true });
}