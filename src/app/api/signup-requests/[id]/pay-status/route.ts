import { createAdminClient } from "@/lib/supabase/server";
import { confirmSignupPayment } from "@/lib/signupPayment";
import { NextResponse } from "next/server";

// Forces this route to actually run on every request instead of being served from Next.js's
// static/edge cache. This handler reads no cookies and no request-derived input besides the URL
// param, so without this it qualifies as statically optimizable — the FIRST response (typically
// "PENDING", checked moments after direct-pay is initiated) gets cached and every later poll, for
// every customer, replays that same frozen snapshot forever instead of re-checking Fapshi. That's
// what was causing the client to spin on "waiting for payment" even after a payment had actually
// gone through.
export const dynamic = "force-dynamic";

// A status check may retry Fapshi a couple of times (see fapshiGetStatus); without an explicit
// limit the host's default (10 seconds on some plans) could cut that short and surface as an
// unexplained failure to the customer.
export const maxDuration = 30;

// Public — same customer-facing pattern as the pay route this checks on. Never trust a claimed
// status from the client, always re-verify with an authenticated GET straight to Fapshi. All of
// the actual work (asking Fapshi, recording the payment atomically, notifying exactly once) lives
// in src/lib/signupPayment.ts, shared with the webhook, the reconciliation sweep and the admin
// screens, so every path records a payment identically.
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const check = await confirmSignupPayment(createAdminClient(), params.id);
    if (!check.started) {
      return NextResponse.json({ error: "No payment has been started for this request.", code: "not_started" }, { status: 404 });
    }
    // Include `reason` — Fapshi sets it on FAILED/EXPIRED transactions (e.g. "insufficient
    // funds", "user cancelled") — so the client can show the customer why it failed.
    return NextResponse.json({ status: check.status, transId: check.transId, reason: check.reason });
  } catch (err: any) {
    // Fapshi could not be reached even after retries. Nothing was changed, and the customer's
    // payment (if any) is still picked up later by the webhook / sweep — say so, don't alarm.
    console.error("signup pay-status check failed:", err?.message);
    return NextResponse.json({ error: "Could not check the payment status right now.", code: "provider_unavailable" }, { status: 502 });
  }
}
