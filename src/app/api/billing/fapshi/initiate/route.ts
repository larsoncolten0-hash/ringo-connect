import { createClient, createAdminClient } from "@/lib/supabase/server";
import { fapshiDirectPay } from "@/lib/fapshi";
import { getPlatformSettings } from "@/lib/platformSettings";
import { isPaidPlan } from "@/lib/pricing";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { planName, phone, medium, interval = "monthly" } = await request.json();

  if (!isPaidPlan(planName)) {
    return NextResponse.json({ error: "Unknown plan" }, { status: 400 });
  }
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

  // Price is read from the plans table (admin-editable), not a hardcoded
  // file — this is what makes "manage plans" from the admin UI actually
  // affect what people are charged. Column depends on the chosen interval.
  const { data: plan } = await admin
    .from("plans")
    .select("price_xaf, price_xaf_yearly")
    .eq("name", planName)
    .single();
  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  const amount = Number(interval === "yearly" ? plan.price_xaf_yearly : plan.price_xaf);

  try {
    const result = await fapshiDirectPay({
      amount,
      phone,
      medium,
      userId: user.id,
      // Fapshi requires externalId to match ^[a-zA-Z0-9\-_]{1,100}$ — no
      // colons. Underscore separators keep it splittable/readable.
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