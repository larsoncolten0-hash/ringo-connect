import { assertAdmin } from "@/lib/assertAdmin";
import { createAdminClient } from "@/lib/supabase/server";
import { fapshiPayout } from "@/lib/fapshi";
import { markPayoutProcessing } from "@/lib/affiliate";
import { NextResponse } from "next/server";

// Initiates a real Fapshi Mobile Money disbursement for one payout
// request. Only applies to XAF payouts with payout_method "mobile_money"
// — PayPal and bank payouts have no automated disbursement here and stay
// on the manual mark-paid/reject flow in ../[id]/route.ts.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const admin = await assertAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const adminClient = createAdminClient();

  const { data: payout } = await adminClient
    .from("affiliate_payouts")
    .select("id, status, amount, currency, payout_method, payout_details, affiliate_user_id")
    .eq("id", params.id)
    .single();

  if (!payout) return NextResponse.json({ error: "Payout not found." }, { status: 404 });
  if (payout.status !== "requested") {
    return NextResponse.json({ error: "This payout isn't in a requestable state." }, { status: 400 });
  }
  if (payout.currency !== "XAF") {
    return NextResponse.json({ error: "Fapshi only disburses XAF — use manual settlement for this currency." }, { status: 400 });
  }
  if (payout.payout_method !== "mobile_money") {
    return NextResponse.json({ error: "This payout isn't set up for Mobile Money." }, { status: 400 });
  }

  const details = payout.payout_details as { provider?: string; phone?: string } | null;
  if (!details?.phone || !["mtn", "orange"].includes(details.provider || "")) {
    return NextResponse.json({ error: "This payout is missing a valid phone number/provider." }, { status: 400 });
  }

  const medium = details.provider === "orange" ? "orange money" : "mobile money";

  try {
    const result = await fapshiPayout({
      amount: Math.round(Number(payout.amount)),
      phone: details.phone,
      medium,
      userId: payout.affiliate_user_id,
      externalId: `affiliate-payout-${payout.id}`,
      message: "Ringo Connect — affiliate commission payout",
    });

    await markPayoutProcessing(payout.id, result.transId);

    await adminClient.from("admin_audit_log").insert({
      admin_id: admin.id,
      action: "send_affiliate_payout_fapshi",
      details: { payoutId: payout.id, transId: result.transId, amount: payout.amount },
    });

    return NextResponse.json({ ok: true, transId: result.transId });
  } catch (err: any) {
    // Nothing was written — the payout stays 'requested' and can be
    // retried (or sent manually) once whatever's wrong is fixed (bad
    // phone number, insufficient service balance, IP not whitelisted…).
    return NextResponse.json({ error: err.message || "Could not start the Fapshi disbursement." }, { status: 502 });
  }
}
