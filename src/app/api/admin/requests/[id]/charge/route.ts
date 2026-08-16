import { assertAdmin } from "@/lib/assertAdmin";
import { createAdminClient } from "@/lib/supabase/server";
import { fapshiDirectPay } from "@/lib/fapshi";
import { NextResponse } from "next/server";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const admin = await assertAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { phone, medium, planId, billingInterval } = await request.json().catch(() => ({}));
  if (!phone || !["mobile money", "orange money"].includes(medium) || !planId) {
    return NextResponse.json({ error: "Phone, medium, and plan are required." }, { status: 400 });
  }

  const adminClient = createAdminClient();

  const { data: signupRequest } = await adminClient
    .from("signup_requests")
    .select("id, status, full_name")
    .eq("id", params.id)
    .single();

  if (!signupRequest || signupRequest.status !== "pending") {
    return NextResponse.json({ error: "Request not found or already processed." }, { status: 404 });
  }

  const { data: plan } = await adminClient.from("plans").select("price_xaf, price_xaf_yearly, name").eq("id", planId).single();
  if (!plan) return NextResponse.json({ error: "Plan not found." }, { status: 404 });

  const amount = billingInterval === "yearly" ? Number(plan.price_xaf_yearly) : Number(plan.price_xaf);

  try {
    // No real user exists yet — the customer's requestId stands in for
    // Fapshi's userId field (just their own tracking, not ours), and
    // externalId only needs to be unique and match Fapshi's allowed
    // character set (letters/digits/hyphens/underscores — a UUID with
    // hyphens is fine).
    const result = await fapshiDirectPay({
      amount,
      phone,
      medium,
      userId: signupRequest.id,
      externalId: `admin-request-${signupRequest.id}`,
      message: `Ringo Connect — ${plan.name} plan (for ${signupRequest.full_name})`,
    });

    await adminClient
      .from("signup_requests")
      .update({ pending_fapshi_trans_id: result.transId })
      .eq("id", params.id);

    return NextResponse.json({ transId: result.transId });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Could not start the charge." }, { status: 502 });
  }
}