import { createAdminClient } from "@/lib/supabase/server";
import { fapshiDirectPay } from "@/lib/fapshi";
import { getPlatformSettings } from "@/lib/platformSettings";
import { computeSignupAmount, confirmSignupPayment } from "@/lib/signupPayment";
import { normalizeSignupPhone } from "@/lib/signupPaymentClient";
import { NextResponse } from "next/server";

// A payment request may wait on Fapshi (see fapshiDirectPay's own timeout); without an explicit
// limit the host's default could cut it short and surface as an unexplained failure.
export const maxDuration = 30;

// Public — this is the customer paying for their own just-submitted request, not an admin action.
// The amount is always recomputed server-side from the request's own stored plan/add-on
// selections, never trusted from the client, same defensive pattern used everywhere else money
// changes hands in this app.
//
// Guards, in order — each exists to stop a real way a customer could be charged twice, or told
// "failed" when the money actually moved:
//   1. already paid            -> answered, never charged again;
//   2. a payment already in flight for this request:
//        it succeeded  -> recorded and answered as paid (a late approval is not lost);
//        still waiting -> resumed, no second prompt is sent (unless the customer explicitly
//                         asks to send a fresh request — the old transaction id is kept in the
//                         admin notes so it can still be traced);
//        failed/expired -> a fresh attempt is allowed;
//        cannot be checked -> refused with a retryable answer (a new attempt would overwrite the
//                         only record of the old one);
//   3. every attempt gets its OWN Fapshi externalId, so a retry can never collide with — or be
//      mistaken for — an earlier attempt of the same request.
// The Fapshi transaction is also stamped with userId = this request's id, so the webhook and the
// reconciliation sweep can match a successful payment back to its request even if this route
// never got to store the transaction id.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => ({}));
  const medium = body?.medium;
  const phone = normalizeSignupPhone(typeof body?.phone === "string" ? body.phone : "");
  const forceNew = body?.forceNew === true;

  if (!["mobile money", "orange money"].includes(medium)) {
    return NextResponse.json({ error: "Phone and provider are required.", code: "invalid_medium" }, { status: 400 });
  }
  if (!phone) {
    return NextResponse.json({ error: "Enter a valid Cameroon mobile number.", code: "invalid_phone" }, { status: 400 });
  }

  // allowCustomerPaymentAtSignup no longer gates this endpoint — paying at signup is mandatory
  // whenever there's a balance due, on both the standard and affiliate variants (see
  // GetStartedFlow.tsx). Only the Fapshi on/off switch (fapshiEnabled) can still block a payment.
  const settings = await getPlatformSettings();
  if (!settings.fapshiEnabled) {
    return NextResponse.json({ error: "Mobile Money payments are currently unavailable.", code: "unavailable" }, { status: 503 });
  }

  const admin = createAdminClient();
  const { data: signupRequest } = await admin
    .from("signup_requests")
    .select("id, status, full_name, requested_plan_id, requested_interval, requested_addon_ids, source, customer_paid, pending_fapshi_trans_id, admin_notes")
    .eq("id", params.id)
    .single();

  if (!signupRequest || signupRequest.status !== "pending") {
    return NextResponse.json({ error: "Request not found or already processed.", code: "not_found" }, { status: 404 });
  }

  // 1. Already paid.
  if (signupRequest.customer_paid) return NextResponse.json({ alreadyPaid: true });

  // 2. A payment already in flight for this request.
  let breadcrumb: string | null = null;
  if (signupRequest.pending_fapshi_trans_id) {
    let existing;
    try {
      existing = await confirmSignupPayment(admin, params.id);
    } catch (err: any) {
      console.error("signup pay: could not check the earlier payment:", err?.message);
      return NextResponse.json({ error: "We couldn't check your earlier payment right now. Please try again in a moment.", code: "provider_unavailable" }, { status: 503 });
    }
    if (existing.paid) return NextResponse.json({ alreadyPaid: true });
    if (existing.status === "CREATED" && !forceNew) {
      return NextResponse.json({ resumed: true, transId: signupRequest.pending_fapshi_trans_id });
    }
    if (existing.status === "CREATED") breadcrumb = signupRequest.pending_fapshi_trans_id; // sent-again while the old one was still open
  }

  const owed = await computeSignupAmount(admin, signupRequest);
  if (!owed.ok) {
    return owed.code === "plan_not_found"
      ? NextResponse.json({ error: "Plan not found.", code: "plan_not_found" }, { status: 404 })
      : NextResponse.json({ error: "Nothing to pay for this selection.", code: "nothing_to_pay" }, { status: 400 });
  }

  try {
    const result = await fapshiDirectPay({
      amount: owed.amount,
      phone,
      medium,
      userId: signupRequest.id,
      externalId: `signup-${signupRequest.id}-${Date.now().toString(36)}`,
      message: `Ringo Connect — ${owed.planName ? `${owed.planName} plan` : "signup"} (${signupRequest.full_name})`,
    });

    // Keep a trace of an earlier attempt that was still open when this one replaced it.
    const notes = breadcrumb && !String(signupRequest.admin_notes || "").includes(breadcrumb) ? `${signupRequest.admin_notes ? signupRequest.admin_notes + "\n" : ""}Earlier online payment attempt still open when re-sent: ${breadcrumb}` : undefined;
    // The transaction exists at Fapshi from here on. If recording its id fails once, try again;
    // if it still fails the webhook/sweep will find it by userId, so the customer is not left
    // without a record — just log it.
    let stored = false;
    for (let attempt = 0; attempt < 2 && !stored; attempt++) {
      const { error } = await admin
        .from("signup_requests")
        .update({ pending_fapshi_trans_id: result.transId, ...(notes ? { admin_notes: notes } : {}) })
        .eq("id", params.id);
      stored = !error;
      if (error) console.error(`signup pay: could not store transaction ${result.transId} (attempt ${attempt + 1}):`, error.message);
    }

    return NextResponse.json({ transId: result.transId });
  } catch (err: any) {
    // Fapshi answered with a clear refusal (bad number, wrong operator, insufficient balance…)
    // versus we don't know what happened (timeout, dropped connection, 5xx): the second case may
    // still have sent a prompt, so it must NOT be reported as a plain failure.
    if (err?.uncertain) {
      console.error("signup pay: outcome uncertain:", err?.message);
      return NextResponse.json({ error: "We couldn't confirm the payment request.", code: "uncertain" }, { status: 503 });
    }
    console.error("signup pay: Fapshi refused:", err?.message);
    return NextResponse.json({ error: err?.message || "Could not start the payment.", code: "rejected" }, { status: 400 });
  }
}
