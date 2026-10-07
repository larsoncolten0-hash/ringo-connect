import { NextResponse } from "next/server";

// DISABLED (security). This endpoint used to be a demo of the upgrade flow: it "simulated" a payment and then, with the
// service-role key, set users.plan_id for ANY signed-in caller (planName "pro" / "business") without any payment having
// happened. That is a free-upgrade path to every paid feature (Ringo AI, the Business Toolkit, Team Management...), so it
// no longer changes anything.
//
// Plans are only ever granted by a payment that was confirmed server-side: Stripe's signed webhook
// (/api/billing/stripe/webhook) and Fapshi's verified status (/api/billing/fapshi/*, applySuccessfulPayment). Nothing in the
// application calls this route any more (the only reference is the unused FlutterwaveSimulateModal component).
//
// It is kept as a stub, not deleted, so an old client or a stale bookmark gets a clear, harmless answer instead of a 404.
export async function POST() {
  return NextResponse.json({ error: "Plan changes are made through checkout.", code: "upgrade_endpoint_disabled" }, { status: 410 });
}
