import { createAdminClient } from "@/lib/supabase/server";
import { notifyAdmins, notifyUser } from "@/lib/notifications";
import { emailShell } from "@/lib/email/emailShell";
import { sendEmail } from "@/lib/email/provider";
import { sendPushToAdmins } from "@/lib/push/send";
import { sendPushAndBellToAdmins } from "@/lib/push/withBell";
import { notifyAffiliateCommissionIfAny } from "@/lib/push/notifyAffiliateCommission";
import { applyCardBundleGrant } from "@/lib/cardBundle";

// Card + Subscription bundle transactions (src/app/api/ringo-cards/bundle/
// initiate/route.ts) use this exact sentinel shape for payment_transactions
// .plan_name instead of a real plans.name — "card_bundle:<planName>:<days>"
// — so the normal plan lookup below never matches one by accident, and so
// this file (the one place a payment becomes a real grant, for both Fapshi
// polling AND the Stripe webhook — bundles are Fapshi/mobile-money only,
// but detecting the sentinel here rather than duplicating this function's
// idempotency/transaction-lookup logic in a second place is what "reuse
// existing patterns" means for this feature).
const BUNDLE_PREFIX = "card_bundle:";

function parseBundlePlanName(planName: string): { grantPlanName: string; durationDays: number } | null {
  if (!planName.startsWith(BUNDLE_PREFIX)) return null;
  const [, grantPlanName, daysRaw] = planName.split(":");
  const durationDays = Number(daysRaw);
  if (!grantPlanName || !Number.isFinite(durationDays) || durationDays <= 0) return null;
  return { grantPlanName, durationDays };
}

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

  const bundle = parseBundlePlanName(tx.plan_name);
  if (bundle) {
    const result = await applyCardBundleGrant(tx.user_id, bundle.grantPlanName, bundle.durationDays);
    await admin.from("payment_transactions").update({ status: "success", updated_at: new Date().toISOString() }).eq("id", tx.id);
    await notifyCardBundlePurchased({ userId: tx.user_id, durationDays: bundle.durationDays, outcome: result.applied ? result.outcome : null, amount: tx.amount, currency: tx.currency });
    await notifyAffiliateCommissionIfAny(admin, tx.id);
    return { applied: true };
  }

  const { data: plan } = await admin.from("plans").select("id, display_name, name").eq("name", tx.plan_name).single();
  if (!plan) return { applied: false };

  // Read BEFORE the update below — this is what tells "first paid plan"
  // (notify admins) apart from "renewing/changing an already-paid plan"
  // (don't spam admins for every renewal, per the user's own "new
  // subscription/new member" ask, not every payment).
  const { data: currentUser } = await admin.from("users").select("plan_id, plans(name)").eq("id", tx.user_id).maybeSingle();
  const wasOnFreePlan = !currentUser?.plan_id || (currentUser.plans as any)?.name === "free";

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
  if (wasOnFreePlan) {
    const { data: buyerProfile } = await admin.from("profiles").select("name, username").eq("user_id", tx.user_id).maybeSingle();
    await sendPushAndBellToAdmins(admin, {
      category: "member_paid_new",
      title: "New paid member",
      body: `${buyerProfile?.name || buyerProfile?.username || "A new member"} joined on the ${tx.plan_name} plan.`,
      url: "/admin/requests",
    });
  }
  await notifyAffiliateCommissionIfAny(admin, tx.id);

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
          log: { emailType: "subscription_payment_admin", resourceType: "user", resourceId: userId },
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
          log: { emailType: "subscription_payment_confirmed", resourceType: "user", resourceId: userId },
        })
      : Promise.resolve(),
  ]);
}

/**
 * Best-effort notification for a Card + Subscription bundle purchase —
 * mirrors notifyPaymentSucceeded's shape/channels (push isn't sent here,
 * unlike a plain plan purchase, since a physical card also needs human
 * fulfillment — the admin push/email below says so explicitly) but with
 * wording that actually reflects what happened to the buyer's plan, which
 * varies by applyCardBundleGrant's outcome.
 */
async function notifyCardBundlePurchased({
  userId,
  durationDays,
  outcome,
  amount,
  currency,
}: {
  userId: string;
  durationDays: number;
  outcome: "granted_from_free" | "extended_existing_plan" | "stripe_subscriber_unchanged" | null;
  amount: number;
  currency: string;
}) {
  const admin = createAdminClient();
  const durationLabel = durationDays >= 300 ? "1 year" : "1 month";

  const buyerBody =
    outcome === "granted_from_free"
      ? `Your Basic-tier access (${durationLabel}) is live — your Ringo Card is on its way.`
      : outcome === "extended_existing_plan"
      ? `We've added ${durationLabel} to your current plan's access — your Ringo Card is on its way.`
      : `Payment received — your Ringo Card is on its way.`;

  const [{ data: user }, { data: admins }, { data: buyerProfile }] = await Promise.all([
    admin.from("users").select("email").eq("id", userId).single(),
    admin.from("users").select("email").eq("role", "admin"),
    admin.from("profiles").select("name, username").eq("user_id", userId).maybeSingle(),
  ]);
  const adminEmails = (admins || []).map((a) => a.email).filter(Boolean);
  const buyerName = buyerProfile?.name || buyerProfile?.username || user?.email || "A customer";

  await Promise.allSettled([
    notifyUser(userId, { type: "card_bundle_purchase", title: "Ringo Card bundle purchased", body: buyerBody, link: "/dashboard/ringo-card" }),
    // Admin-facing — this is the actual "go ship a physical card" signal;
    // there's no automated fulfillment for the card itself (see the
    // migration's own note — fulfillment has always been a manual/offline
    // step for the existing standalone addon too, unchanged here).
    notifyAdmins({
      type: "card_bundle_purchase",
      title: `Card bundle purchased — ${buyerName}`,
      body: `${durationLabel} bundle · ${amount} ${currency} · ship a Ringo Card.`,
      link: "/admin/settings",
    }),
    sendPushToAdmins(admin, {
      category: "card_bundle_purchase",
      title: "Card bundle purchased",
      body: `${buyerName} · ${durationLabel} bundle — ship a Ringo Card.`,
      url: "/admin/settings",
    }),
    user?.email
      ? sendEmail({
          to: user.email,
          subject: "Your Ringo Card bundle — Ringo Connect",
          html: emailShell(`<p style="font-size:14px; margin:0;">${buyerBody}</p>`),
          log: { emailType: "card_bundle_purchase_confirmed", resourceType: "user", resourceId: userId },
        })
      : Promise.resolve(),
    adminEmails.length > 0
      ? sendEmail({
          to: adminEmails,
          subject: `Card bundle purchased — ${buyerName}`,
          html: emailShell(`<p style="font-size:14px; margin:0;"><strong>${buyerName}</strong> just bought the ${durationLabel} Card bundle (${amount} ${currency}) — ship them a Ringo Card.</p>`),
          log: { emailType: "card_bundle_purchase_admin", resourceType: "user", resourceId: userId },
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
