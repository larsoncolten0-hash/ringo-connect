import { fapshiGetStatus } from "@/lib/fapshi";
import { applySuccessfulPayment, markFailedPayment } from "@/lib/applyPayment";
import { NextResponse } from "next/server";

// Fapshi calls this URL when a transaction resolves to SUCCESSFUL, FAILED,
// or EXPIRED (configure the URL in your Fapshi dashboard under your
// service's settings).
//
// Fapshi's docs don't document a webhook signature to verify the request
// actually came from them, so — rather than trusting the POSTed body
// directly — this re-fetches the transaction status from Fapshi's own API
// using our own API credentials before crediting anything. That means an
// attacker who discovers this URL and POSTs a fake "SUCCESSFUL" payload
// can't grant themselves a plan; the only thing that matters is what
// Fapshi's own /payment-status endpoint says when we ask it ourselves.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const transId = body?.transId;
  if (!transId) return NextResponse.json({ error: "Missing transId" }, { status: 400 });

  try {
    const tx = await fapshiGetStatus(transId);

    if (tx.status === "SUCCESSFUL") {
      await applySuccessfulPayment({ provider: "fapshi", providerTransactionId: transId });
    } else if (tx.status === "FAILED" || tx.status === "EXPIRED") {
      await markFailedPayment("fapshi", transId);
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    // Still return 200 so Fapshi doesn't endlessly retry a transaction
    // that genuinely doesn't exist on our side; log for investigation.
    console.error("Fapshi webhook error:", err.message);
    return NextResponse.json({ ok: true });
  }
}