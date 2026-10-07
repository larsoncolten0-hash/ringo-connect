// De-duplication for Stripe's checkout.session.completed webhook.
//
// Stripe delivers an event "at least once": it retries on any non-2xx / timeout and an operator can re-send one from the
// dashboard. Each delivery used to INSERT a new payment_transactions row, so the same paid checkout could be recorded twice, and
// the AFTER INSERT commission trigger (unique only on payment_transaction_id) then credited a second affiliate commission and the
// admins got a second "New paid member" notification.
//
// Two layers, both needed:
//   1. recorded check  - before any side effect, a session that already has a row is skipped (this is the normal duplicate).
//   2. unique violation - two deliveries racing past the check: the database refuses the second insert
//      (supabase/migrations/2026-10-06d_payment_transactions_idempotency.sql adds the unique index; until it is applied, layer 1 still
//      stops sequential duplicates). A 23505 on insert is therefore "someone else already recorded it", not an error.
// The plan grant that happens before the insert is idempotent, so a crash between the grant and the insert is repaired by Stripe's
// retry (no row yet -> the retry proceeds); a crash after the insert needs no repair.
//
// Pure functions over an injected client so they can be tested without Stripe or a database.

type Admin = { from: (table: string) => any };

export type StripePaymentRow = {
  user_id: string;
  provider: "stripe";
  provider_transaction_id: string;
  plan_name: string;
  billing_interval: string;
  amount: number;
  currency: string;
  status: "success";
};

/** True when a payment row for this Stripe Checkout session already exists. A read error counts as "not recorded" (never blocks a real payment). */
export async function stripePaymentAlreadyRecorded(admin: Admin, sessionId: string): Promise<boolean> {
  const { data, error } = await admin
    .from("payment_transactions")
    .select("id")
    .eq("provider", "stripe")
    .eq("provider_transaction_id", sessionId)
    .limit(1);
  if (error) return false;
  return Array.isArray(data) && data.length > 0;
}

export type RecordResult = { duplicate: true } | { duplicate: false; id: string | null };

/** Inserts the payment row. A unique violation means another delivery already recorded this session. */
export async function recordStripePayment(admin: Admin, row: StripePaymentRow): Promise<RecordResult> {
  const { data, error } = await admin.from("payment_transactions").insert(row).select("id").single();
  if (error) {
    if ((error as { code?: string }).code === "23505") return { duplicate: true };
    // Any other failure keeps the previous behaviour: the grant has been applied, the row is missing, nothing is thrown.
    console.error("stripe webhook: could not record payment:", (error as { message?: string }).message);
    return { duplicate: false, id: null };
  }
  return { duplicate: false, id: data?.id ?? null };
}
