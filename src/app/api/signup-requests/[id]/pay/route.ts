import { createAdminClient } from "@/lib/supabase/server";
import { fapshiDirectPay } from "@/lib/fapshi";
import { getPlatformSettings } from "@/lib/platformSettings";
import { NextResponse } from "next/server";

// Public — this is the customer paying for their own just-submitted
// request, not an admin action. The amount is always recomputed
// server-side from the request's own stored plan/add-on selections,
// never trusted from the client, same defensive pattern used
// everywhere else money changes hands in this app.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const { phone, medium } = await request.json().catch(() => ({}));
  if (!phone || !["mobile money", "orange money"].includes(medium)) {
    return NextResponse.json({ error: "Phone and provider are required." }, { status: 400 });
  }

  // The admin toggle and the Fapshi on/off switch both need to be
  // checked here, server-side — otherwise the toggle only controls
  // whether the "Pay now" button is shown, not whether this endpoint
  // actually accepts a payment. A hidden button isn't a real off switch.
  const settings = await getPlatformSettings();
  if (!settings.allowCustomerPaymentAtSignup) {
    return NextResponse.json({ error: "Paying during signup isn't available right now." }, { status: 403 });
  }
  if (!settings.fapshiEnabled) {
    return NextResponse.json({ error: "Mobile Money payments are currently unavailable." }, { status: 503 });
  }

  const admin = createAdminClient();

  const { data: signupRequest } = await admin
    .from("signup_requests")
    .select("id, status, full_name, requested_plan_id, requested_interval, requested_addon_ids")
    .eq("id", params.id)
    .single();

  if (!signupRequest || signupRequest.status !== "pending") {
    return NextResponse.json({ error: "Request not found or already processed." }, { status: 404 });
  }
  if (!signupRequest.requested_plan_id) {
    return NextResponse.json({ error: "No plan was selected." }, { status: 400 });
  }

  const { data: plan } = await admin
    .from("plans")
    .select("price_xaf, price_xaf_yearly, name")
    .eq("id", signupRequest.requested_plan_id)
    .single();
  if (!plan) return NextResponse.json({ error: "Plan not found." }, { status: 404 });

  let amount =
    signupRequest.requested_interval === "yearly" ? Number(plan.price_xaf_yearly) : Number(plan.price_xaf);

  const addonIds: string[] = signupRequest.requested_addon_ids || [];
  if (addonIds.length > 0) {
    const { data: selectedAddons } = await admin.from("addons").select("price_xaf").in("id", addonIds);
    amount += (selectedAddons || []).reduce((sum, a) => sum + Number(a.price_xaf), 0);
  }

  if (amount <= 0) {
    return NextResponse.json({ error: "Nothing to pay for this selection." }, { status: 400 });
  }

  try {
    const result = await fapshiDirectPay({
      amount,
      phone,
      medium,
      userId: signupRequest.id,
      externalId: `signup-${signupRequest.id}`,
      message: `Ringo Connect — ${plan.name} plan (${signupRequest.full_name})`,
    });

    await admin.from("signup_requests").update({ pending_fapshi_trans_id: result.transId }).eq("id", params.id);

    return NextResponse.json({ transId: result.transId });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Could not start the payment." }, { status: 502 });
  }
}