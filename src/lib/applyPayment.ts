import { createAdminClient } from "@/lib/supabase/server";

/**
 * Applies a successful payment: grants the plan and marks the transaction
 * as complete. Idempotent — safe to call multiple times for the same
 * transaction (e.g. once from a client poll AND once from the webhook,
 * whichever arrives first), since it checks the transaction's current
 * status before doing anything.
 */
export async function applySuccessfulPayment({
  provider,
  providerTransactionId,
}: {
  provider: "fapshi" | "stripe";
  providerTransactionId: string;
}): Promise<{ applied: boolean }> {
  const admin = createAdminClient();

  const { data: tx } = await admin
    .from("payment_transactions")
    .select("*")
    .eq("provider", provider)
    .eq("provider_transaction_id", providerTransactionId)
    .single();

  if (!tx || tx.status === "success") {
    return { applied: false };
  }

  const { data: plan } = await admin.from("plans").select("id").eq("name", tx.plan_name).single();
  if (!plan) return { applied: false };

  const interval: "monthly" | "yearly" = tx.billing_interval === "yearly" ? "yearly" : "monthly";

  const updates: Record<string, any> = {
    plan_id: plan.id,
    payment_provider: provider,
    billing_interval: interval,
  };
  if (provider === "fapshi") {
    // Mobile Money has no stored payment method to auto-renew — the plan
    // is granted for one billing period from now, and the creator
    // renews manually. 365 days for yearly rather than "add a year" to
    // sidestep leap-year/month-length edge cases entirely.
    const expires = new Date();
    expires.setDate(expires.getDate() + (interval === "yearly" ? 365 : 30));
    updates.plan_expires_at = expires.toISOString();
  } else {
    // Stripe subscriptions renew themselves via webhook — no fixed expiry.
    updates.plan_expires_at = null;
  }

  await admin.from("users").update(updates).eq("id", tx.user_id);
  await admin.from("payment_transactions").update({ status: "success", updated_at: new Date().toISOString() }).eq("id", tx.id);

  return { applied: true };
}

export async function markFailedPayment(provider: "fapshi" | "stripe", providerTransactionId: string) {
  const admin = createAdminClient();
  await admin
    .from("payment_transactions")
    .update({ status: "failed", updated_at: new Date().toISOString() })
    .eq("provider", provider)
    .eq("provider_transaction_id", providerTransactionId)
    .neq("status", "success"); // never downgrade a transaction that already succeeded
}