import { createClient } from "@/lib/supabase/server";
import { getStripeClient } from "@/lib/stripe";
import { getPlatformSettings } from "@/lib/platformSettings";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { planName, interval = "monthly" } = await request.json();
  // "business" was renamed to "business_pro" (plus the new "business_basic"
  // added alongside it) by the 2026-10-05 pricing restructure. Both are
  // real, known plans now — business_basic is rejected explicitly below,
  // not here, so it gets an honest "not available yet" instead of "Unknown
  // plan".
  if (!["basic", "pro", "business_basic", "business_pro"].includes(planName)) {
    return NextResponse.json({ error: "Unknown plan" }, { status: 400 });
  }
  if (interval !== "monthly" && interval !== "yearly") {
    return NextResponse.json({ error: "Invalid billing interval" }, { status: 400 });
  }

  // FOLLOW-UP (not done here): Business Basic has no Stripe price
  // configured at all — platform_settings has stripe_price_business_*
  // columns (now Business Pro's, post-rename) but nothing for Business
  // Basic, and Stripe isn't in active use today (Fapshi is the only
  // provider actually processing subscription payments right now). Wiring
  // this needs a new platform_settings column plus admin UI in
  // SettingsForm.tsx to set it — a separate task. Rejected explicitly here
  // rather than falling through to priceIdByPlan below (which has no
  // "business_basic" entry and would throw) or reusing Business Pro's
  // price, which would charge the wrong amount.
  if (planName === "business_basic") {
    return NextResponse.json({ error: "This plan isn't available for card payment yet." }, { status: 400 });
  }

  const settings = await getPlatformSettings();
  if (!settings.stripeEnabled) {
    return NextResponse.json({ error: "Card payments are currently unavailable." }, { status: 503 });
  }

  const priceIdByPlan: Record<string, { monthly: string | null; yearly: string | null }> = {
    basic: { monthly: settings.stripePriceBasic, yearly: settings.stripePriceBasicYearly },
    pro: { monthly: settings.stripePricePro, yearly: settings.stripePriceProYearly },
    business_pro: { monthly: settings.stripePriceBusiness, yearly: settings.stripePriceBusinessYearly },
  };
  const priceId = priceIdByPlan[planName][interval as "monthly" | "yearly"];

  if (!priceId) {
    return NextResponse.json(
      { error: `Stripe price ID not configured for the ${planName} plan (${interval})` },
      { status: 500 }
    );
  }

  let stripe;
  try {
    stripe = await getStripeClient();
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 503 });
  }

  const { data: userRow } = await supabase
    .from("users")
    .select("stripe_customer_id, email")
    .eq("id", user.id)
    .single();

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || request.headers.get("origin") || "";

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      customer: userRow?.stripe_customer_id || undefined,
      customer_email: userRow?.stripe_customer_id ? undefined : userRow?.email,
      client_reference_id: user.id,
      metadata: { userId: user.id, planName, interval },
      subscription_data: { metadata: { userId: user.id, planName, interval } },
      success_url: `${siteUrl}/dashboard/subscription?checkout=success`,
      cancel_url: `${siteUrl}/dashboard/subscription?checkout=cancelled`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Could not start checkout" }, { status: 502 });
  }
}