import { createClient, createAdminClient } from "@/lib/supabase/server";
import { fapshiDirectPay } from "@/lib/fapshi";
import { getPlatformSettings } from "@/lib/platformSettings";
import { NextResponse } from "next/server";

// A deliberately SEPARATE, isolated copy of /api/billing/fapshi/initiate's
// logic — not a reuse of it — because that route gates on isPaidPlan()
// (src/lib/pricing.ts), a hardcoded plan-name whitelist that also feeds
// real, unrelated billing logic elsewhere (the expiry-downgrade cron,
// commission-rate lookups, admin price controls). Widening that shared
// whitelist to include Association plan names would mean tracing every one
// of those consumers to confirm none of them mishandle an Association plan
// — explicitly decided against. This route instead validates the plan by
// checking `association_enabled` directly on the plans row, so it can never
// affect (or be affected by) any of that existing logic.
//
// Everything AFTER validation is identical in spirit to the existing route
// and safe to duplicate: price is read from the plans table (never
// hardcoded), and the resulting payment_transactions row is the same
// shape every other plan purchase already produces — which is exactly why
// the existing, fully generic status-polling route
// (/api/billing/fapshi/status/[transId]) and the Fapshi webhook both work
// for this unmodified: applySuccessfulPayment (src/lib/applyPayment.ts)
// grants a plan purely by looking up `plans.name`, with no whitelist of its
// own at all.
export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // Demo accounts get a real, working Association dashboard already
  // granted at creation time (see /api/demo/create) — there is no reason
  // for one to ever reach a real payment here, and per the same demo
  // safety posture as every other real-money flow (music/ticket checkout,
  // affiliate/music payouts), it must be blocked outright rather than
  // merely discouraged.
  const { data: callerProfile } = await supabase.from("profiles").select("is_demo").eq("user_id", user.id).maybeSingle();
  if (callerProfile?.is_demo) {
    return NextResponse.json({ code: "demo_checkout_disabled", error: "Checkout is disabled in demo mode." }, { status: 403 });
  }

  const { planName, phone, medium, interval = "monthly" } = await request.json().catch(() => ({}));

  if (!phone || !["mobile money", "orange money"].includes(medium)) {
    return NextResponse.json({ error: "Phone number and mobile money provider are required" }, { status: 400 });
  }
  if (interval !== "monthly" && interval !== "yearly") {
    return NextResponse.json({ error: "Invalid billing interval" }, { status: 400 });
  }

  const settings = await getPlatformSettings();
  if (!settings.fapshiEnabled) {
    return NextResponse.json({ error: "Mobile Money payments are currently unavailable." }, { status: 503 });
  }

  const admin = createAdminClient();

  const { data: plan } = await admin
    .from("plans")
    .select("price_xaf, price_xaf_yearly, association_enabled")
    .eq("name", planName)
    .maybeSingle();
  if (!plan || !plan.association_enabled) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  const amount = Number(interval === "yearly" ? plan.price_xaf_yearly : plan.price_xaf);

  try {
    const result = await fapshiDirectPay({
      amount,
      phone,
      medium,
      userId: user.id,
      externalId: `${user.id}_${planName}_${interval}`,
      message: `Ringo Connect — ${planName} plan (${interval})`,
    });

    await admin.from("payment_transactions").insert({
      user_id: user.id,
      provider: "fapshi",
      provider_transaction_id: result.transId,
      plan_name: planName,
      billing_interval: interval,
      amount,
      currency: "XAF",
      status: "pending",
    });

    return NextResponse.json({ transId: result.transId });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Payment could not be started" }, { status: 502 });
  }
}
