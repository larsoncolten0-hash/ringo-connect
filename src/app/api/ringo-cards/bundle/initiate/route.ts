import { createClient, createAdminClient } from "@/lib/supabase/server";
import { fapshiDirectPay } from "@/lib/fapshi";
import { NextResponse } from "next/server";

// Mirrors /api/billing/fapshi/initiate exactly (same Mobile Money direct-pay
// pattern, same payment_transactions bookkeeping) — the one difference is
// `plan_name`, which uses the "card_bundle:<plan>:<days>" sentinel
// applySuccessfulPayment() (src/lib/applyPayment.ts) recognizes, instead of
// a real plans.name. Existing-user purchase path for the two Card +
// Subscription bundles (src/app/dashboard/ringo-card) — the get-started
// path for a brand-new signup goes through the addon/admin-approval flow
// instead (see /api/admin/requests/[id]/approve).
export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { addonId, phone, medium } = await request.json();
  if (!addonId) return NextResponse.json({ error: "Missing addonId" }, { status: 400 });
  if (!phone || !["mobile money", "orange money"].includes(medium)) {
    return NextResponse.json({ error: "Phone number and mobile money provider are required" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Only a real, active bundle addon can be bought this way — never a
  // plain addon (no grants_plan_name at all, e.g. the standalone Ringo
  // Card) and never an inactive one.
  const { data: addon } = await admin
    .from("addons")
    .select("id, name, price_xaf, grants_plan_name, grants_plan_duration_days")
    .eq("id", addonId)
    .eq("active", true)
    .not("grants_plan_name", "is", null)
    .maybeSingle();
  if (!addon) return NextResponse.json({ error: "This bundle isn't available." }, { status: 404 });

  try {
    const result = await fapshiDirectPay({
      amount: Number(addon.price_xaf),
      phone,
      medium,
      userId: user.id,
      externalId: `${user.id}_cardbundle_${addon.id}_${Date.now()}`,
      message: `Ringo Connect — ${addon.name}`,
    });

    await admin.from("payment_transactions").insert({
      user_id: user.id,
      provider: "fapshi",
      provider_transaction_id: result.transId,
      plan_name: `card_bundle:${addon.grants_plan_name}:${addon.grants_plan_duration_days}`,
      billing_interval: "monthly", // unused for bundles (duration comes from the plan_name sentinel), kept non-null to satisfy the column
      amount: Number(addon.price_xaf),
      currency: "XAF",
      status: "pending",
    });

    return NextResponse.json({ transId: result.transId });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Could not start payment" }, { status: 502 });
  }
}
