import { fapshiPayout } from "@/lib/fapshi";
import { createAdminClient } from "@/lib/supabase/server";
import type { ProtectionRefundDestination } from "./refundTypes";

// The ONE function in Phase 3 that can perform a real, live Fapshi call — and, as of this phase,
// nothing in the codebase invokes it. No route, no cron, no admin action wires this up yet. It
// exists to prove the refund workflow CAN reuse the existing, already-safety-guarded
// fapshiPayout() (src/lib/fapshi.ts) — the same function seller/artist/affiliate payouts already
// use — without pretending an unapproved use case is already live.
//
// Fapshi's audited API surface has no dedicated refund/reversal endpoint (confirmed by inspecting
// every exported function in fapshi.ts: direct-pay, payment-status, payout, balance — nothing
// else). This is therefore explicitly a PAYOUT to the customer, recorded in Ringo's own system as
// a Protection refund via protection_refunds — never silently indistinguishable from a seller
// payout in the ledger. See the Phase 3 report for the open business/compliance question this
// raises: fapshiPayout() was built and (as far as this repository shows) has only ever been used
// for outbound disbursement to sellers/artists/affiliates who are Ringo's own known counterparties
// with an on-file payout method — sending to an arbitrary CUSTOMER's number is technically
// identical at the API level, but whether Fapshi's terms/KYC posture for this service actually
// permit paying an unregistered third party is a real, unresolved question this code cannot
// answer and does not attempt to.
//
// externalId MUST be unique per attempt (mirrors every other Fapshi call site in this codebase —
// initiatePayment.ts's `pp-${paymentId}`, the Shop payout send route's `shop-payout-${payout.id}`)
// so a retried call is never mistaken by Fapshi for the same request twice.
export async function performProtectionRefundPayout(params: {
  refundId: string;
  amount: number; // whole XAF
  destination: ProtectionRefundDestination;
  message?: string;
}): Promise<{ transId: string }> {
  // Phase 7 addition: an explicit, fail-closed capability gate. Fapshi's permission for using
  // payout/disbursement as a CUSTOMER refund mechanism (as opposed to seller/artist/affiliate
  // payout, its only confirmed use) has not been confirmed — see the Phase 3 report. Until an admin
  // has explicitly and deliberately flipped this flag at the database level (there is no admin UI
  // control for it — see the Phase 7 report for why), this function refuses to run at all, so a
  // future caller can never reach fapshiPayout() by accident.
  const admin = createAdminClient();
  const { data: settings } = await admin.from("platform_settings").select("protection_refund_provider_enabled").limit(1).single();
  if (settings?.protection_refund_provider_enabled !== true) {
    throw new Error("Protection refund provider execution is disabled (protection_refund_provider_enabled is not true).");
  }

  const medium = params.destination.network === "orange" ? "orange money" : "mobile money";
  const result = await fapshiPayout({
    amount: Math.round(params.amount),
    phone: params.destination.phone,
    medium,
    externalId: `protection-refund-${params.refundId}`,
    message: params.message || "Ringo Protection — refund",
  });
  return { transId: result.transId };
}
