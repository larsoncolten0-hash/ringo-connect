import { sendPushToUser } from "./send";
import { formatPrice } from "@/lib/currency";

// The affiliate commission itself is created entirely inside Postgres —
// the handle_payment_transaction_commission() trigger
// (supabase/migrations/2026-09-06_affiliate_system.sql), fired AFTER
// INSERT OR UPDATE OF status ON payment_transactions — not by any
// application code, so there's no single app-level write site to hook a
// push call directly after like every other notification in this app.
// Instead, this is called from each of the few places that insert/update
// a payment_transactions row (src/app/api/admin/requests/[id]/approve,
// src/app/api/billing/stripe/webhook, src/lib/applyPayment.ts) right
// after that write — since the trigger runs synchronously as part of the
// same statement, the commission row (if the payer was referred by an
// affiliate) already exists by the time this query runs.
export async function notifyAffiliateCommissionIfAny(admin: any, paymentTransactionId: string | null | undefined): Promise<void> {
  if (!paymentTransactionId) return;

  try {
    const { data: commission } = await admin
      .from("affiliate_commissions")
      .select("affiliate_user_id, amount, currency")
      .eq("payment_transaction_id", paymentTransactionId)
      .maybeSingle();

    if (!commission) return;

    await sendPushToUser(admin, commission.affiliate_user_id, {
      category: "affiliate_commission_earned",
      title: "New affiliate commission",
      body: `You earned ${formatPrice(commission.amount, commission.currency)} from someone who signed up with your code.`,
      url: "/dashboard/affiliate",
    });
  } catch (err) {
    console.error(`notifyAffiliateCommissionIfAny failed for transaction ${paymentTransactionId}:`, err);
  }
}
