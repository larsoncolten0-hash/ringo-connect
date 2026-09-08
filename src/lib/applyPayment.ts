import { createAdminClient } from "@/lib/supabase/server";
import { notifyAdmins, notifyUser } from "@/lib/notifications";
import { emailShell, sendEmail } from "@/lib/email";

/**
 * Applies a successful payment: grants the plan and marks the transaction
 * as complete. Idempotent — safe to call multiple times for the same
 * transaction (e.g. once from a client poll AND once from the webhook,
 * whichever arrives first), since it checks the transaction's current
 * status before doing anything — that same check is what keeps the
 * notify/email fan-out below from firing more than once per transaction.
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

  const { data: plan } = await admin.from("plans").select("id, display_name, name").eq("name", tx.plan_name).single();
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

  await notifyPaymentSucceeded({ userId: tx.user_id, planDisplayName: plan.display_name || plan.name, amount: tx.amount, currency: tx.currency });

  return { applied: true };
}

/**
 * Best-effort admin + creator notification for a subscription payment
 * (upgrade or renewal) that just succeeded — shared by applySuccessfulPayment
 * (Fapshi) and the Stripe webhook's checkout.session.completed handler,
 * since those are the app's two real "someone just paid" call sites (the
 * Flutterwave route under src/app/api/billing/upgrade is a labeled
 * simulation, not live). Failures are logged, never thrown — a payment
 * already succeeded and was recorded by the time this runs; nothing here
 * should turn that into an error for the caller.
 */
export async function notifyPaymentSucceeded({
  userId,
  planDisplayName,
  amount,
  currency,
}: {
  userId: string;
  planDisplayName: string;
  amount: number;
  currency: string;
}) {
  const admin = createAdminClient();
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://ringoconnectltd.com").replace(/\/$/, "");

  const [{ data: user }, { data: admins }] = await Promise.all([
    admin.from("users").select("email").eq("id", userId).single(),
    admin.from("users").select("email").eq("role", "admin"),
  ]);
  const adminEmails = (admins || []).map((a) => a.email).filter(Boolean);

  await Promise.allSettled([
    notifyAdmins({
      type: "subscription_payment",
      title: `Subscription payment — ${planDisplayName}`,
      body: user?.email ? `${user.email} · ${amount} ${currency}` : `${amount} ${currency}`,
      link: "/admin",
    }),
    notifyUser(userId, {
      type: "subscription_payment",
      title: `You're now on the ${planDisplayName} plan`,
      body: "Your payment was received.",
      link: "/dashboard/subscription",
    }),
    adminEmails.length > 0
      ? sendEmail({
          to: adminEmails,
          subject: `Subscription payment — ${planDisplayName}`,
          html: emailShell(`
            <p style="font-size:14px; margin:0;">${user?.email || "A creator"} just paid for the <strong>${planDisplayName}</strong> plan (${amount} ${currency}).</p>
          `),
        })
      : Promise.resolve(),
    user?.email
      ? sendEmail({
          to: user.email,
          subject: `You're now on the ${planDisplayName} plan — Ringo Connect`,
          html: emailShell(`
            <p style="font-size:14px; margin:0 0 12px;">Your payment for the <strong>${planDisplayName}</strong> plan was received — it's live on your account now.</p>
            <a href="${siteUrl}/dashboard/subscription" style="display:inline-block; background:#4F46E5; color:#fff; text-decoration:none; padding:10px 18px; border-radius:8px; font-size:14px; font-weight:500;">View your subscription</a>
          `),
        })
      : Promise.resolve(),
  ]);
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