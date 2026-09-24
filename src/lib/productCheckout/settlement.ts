// Settlement: a Fapshi-confirmed payment -> customer_payment succeeded -> product_order paid ->
// one commerce_sale_earnings row. Written to be RE-ENTRANT and idempotent: every step is a
// conditional claim or a unique-constrained insert, so running it twice (overlapping polls, a
// retry after a crash between steps) converges on the same end state and never double-counts.
// The database constraints (one earning per order and per payment, guarded status transitions) are
// the final safety layer.
//
// Nothing is trusted from the provider alone: the payment must match the order (profile, amount,
// currency), and any mismatch sends the order to payment_review instead of marking it paid.
//
// Stock: an order that is still awaiting_payment still holds its reservation (release_product_order_
// stock refuses while a payment is live), so it can be marked paid even if its clock has run out. An
// order already released (expired/cancelled) cannot be re-reserved here (there is deliberately no
// generic stock-add function), so a late success goes to payment_review with the payment preserved.

import { PROVIDER, SUPPORTED_CURRENCY, TARGET_TYPE, VERIFY_PROVIDER_AMOUNT } from "./constants";
import { computeEarnings, sameAmount, toCents } from "./money";
import type { CheckoutDeps, OrderRow, OrderStatus, PaymentRow } from "./types";

export type ReviewReason =
  | "invalid_payment"
  | "order_missing"
  | "payment_status_conflict"
  | "payment_profile_mismatch"
  | "payment_amount_mismatch"
  | "payment_currency_mismatch"
  | "provider_amount_mismatch"
  | "order_released"
  | "order_refunded"
  | "order_in_review";

export interface SettleOutcome {
  status: "succeeded" | "review";
  orderStatus: OrderStatus | null;
  /** true only for the caller that actually flipped the order to paid */
  settledNow: boolean;
  earningRecorded: boolean;
  /** this payment succeeded but the order was already paid by a different payment (customer paid twice) */
  duplicatePayment?: boolean;
  reason?: ReviewReason;
}

export interface SettleFacts {
  /** amount reported by the provider, if any */
  amount: number | null;
}

async function flagReview(deps: CheckoutDeps, order: OrderRow, payment: PaymentRow, reason: ReviewReason): Promise<SettleOutcome> {
  const from = order.status;
  if (from === "awaiting_payment" || from === "expired" || from === "cancelled" || from === "paid") {
    await deps.store.updateOrder(order.id, { status: "payment_review" }, from);
  }
  // Ids and a reason only — no phone, email or provider payload.
  deps.log("product_payment_review", { orderId: order.id, paymentId: payment.id, reason, orderStatusWas: from });
  const now = await deps.store.getOrder(order.id);
  return { status: "review", orderStatus: now?.order.status ?? "payment_review", settledNow: false, earningRecorded: false, reason };
}

/** Consistency between the payment record and the order it claims to pay. Returns a reason on mismatch. */
export function paymentMismatch(payment: PaymentRow, order: OrderRow, facts: SettleFacts): ReviewReason | null {
  if (payment.provider !== PROVIDER || payment.target_type !== TARGET_TYPE || payment.target_id !== order.id) return "invalid_payment";
  if (payment.profile_id !== order.profile_id) return "payment_profile_mismatch";
  if (payment.currency !== order.currency || order.currency !== SUPPORTED_CURRENCY) return "payment_currency_mismatch";
  if (!sameAmount(payment.amount, order.total)) return "payment_amount_mismatch";
  if (VERIFY_PROVIDER_AMOUNT && facts.amount !== null && facts.amount !== undefined) {
    const provided = toCents(facts.amount);
    if (provided === null || provided !== toCents(payment.amount)) return "provider_amount_mismatch";
  }
  return null;
}

async function ensureEarning(
  deps: CheckoutDeps,
  order: OrderRow,
  payment: PaymentRow
): Promise<{ recorded: boolean; duplicate: boolean }> {
  const existing = await deps.store.getEarningByOrder(order.id);
  if (existing) {
    // One earning per order. A different payment id means the customer paid twice: nothing is
    // double-counted, but the extra payment is logged for a refund review.
    const duplicate = existing.payment_id !== payment.id;
    if (duplicate) deps.log("product_duplicate_payment", { orderId: order.id, paymentId: payment.id, earningPaymentId: existing.payment_id });
    return { recorded: true, duplicate };
  }

  const [settings, profile] = await Promise.all([deps.store.getSettings(), deps.store.getProfile(order.profile_id)]);
  if (!profile) {
    deps.log("product_earning_skipped", { orderId: order.id, reason: "profile_missing" });
    return { recorded: false, duplicate: false };
  }
  // Read at settlement time and snapshotted onto the row. Never a hard-coded percentage.
  const earnings = computeEarnings(payment.amount, settings.commissionRate);
  if (!earnings) {
    // Commission not configured (admin unset it after this order was created). The order stays paid;
    // this function is safe to call again once the rate is set.
    deps.log("product_earning_skipped", { orderId: order.id, reason: "commission_unavailable" });
    return { recorded: false, duplicate: false };
  }
  const inserted = await deps.store.insertEarning({
    order_id: order.id,
    payment_id: payment.id,
    profile_id: order.profile_id,
    creator_user_id: profile.user_id, // the profile owner — same identity music earnings use
    gross_amount: earnings.gross,
    commission_rate: earnings.rate,
    platform_fee: earnings.platformFee,
    net_amount: earnings.net,
    currency: order.currency,
  });
  if (inserted === "exists") {
    // Lost a race to another caller (or a payment already has an earning): re-check who owns it.
    const winner = await deps.store.getEarningByOrder(order.id);
    return { recorded: true, duplicate: !!winner && winner.payment_id !== payment.id };
  }
  return { recorded: true, duplicate: false };
}

export async function settleProductPayment(deps: CheckoutDeps, paymentId: string, facts: SettleFacts): Promise<SettleOutcome> {
  let payment = await deps.store.getPayment(paymentId);
  if (!payment) return { status: "review", orderStatus: null, settledNow: false, earningRecorded: false, reason: "invalid_payment" };
  if (payment.provider !== PROVIDER || payment.target_type !== TARGET_TYPE) {
    deps.log("product_payment_review", { paymentId, reason: "invalid_payment" });
    return { status: "review", orderStatus: null, settledNow: false, earningRecorded: false, reason: "invalid_payment" };
  }

  const found = await deps.store.getOrder(payment.target_id);
  if (!found) {
    // The money is real: still record the payment as succeeded so it is never lost.
    await deps.store.updatePayment(
      payment.id,
      { status: "succeeded", confirmed_at: deps.now().toISOString(), provider_status: "SUCCESSFUL" },
      ["initiated", "pending", "expired", "cancelled"]
    );
    deps.log("product_payment_review", { paymentId, reason: "order_missing" });
    return { status: "review", orderStatus: null, settledNow: false, earningRecorded: false, reason: "order_missing" };
  }
  const order = found.order;

  // 1. Claim the payment as succeeded (exactly one caller wins; the rest continue in converge mode).
  if (payment.status !== "succeeded") {
    const claimed = await deps.store.updatePayment(
      payment.id,
      { status: "succeeded", confirmed_at: deps.now().toISOString(), provider_status: "SUCCESSFUL" },
      ["initiated", "pending", "expired", "cancelled"]
    );
    if (!claimed) {
      const again = await deps.store.getPayment(payment.id);
      if (!again || again.status !== "succeeded") {
        // e.g. locally 'failed' but the provider now reports success — record and hand to a human.
        return flagReview(deps, order, payment, "payment_status_conflict");
      }
      payment = again;
    } else {
      payment = { ...payment, status: "succeeded" };
    }
  }

  // 2. The payment must match the order. Anything else -> payment_review, never paid.
  const mismatch = paymentMismatch(payment, order, facts);
  if (mismatch) return flagReview(deps, order, payment, mismatch);

  // 3. Order state machine.
  let current = order;
  let settledNow = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (current.status === "paid" || current.status === "fulfilled") break;

    if (current.status === "awaiting_payment") {
      const paidAt = deps.now().toISOString();
      const flipped = await deps.store.updateOrder(current.id, { status: "paid", paid_at: paidAt }, "awaiting_payment");
      if (flipped) {
        settledNow = true;
        current = { ...current, status: "paid", paid_at: paidAt };
        break;
      }
      const reread = await deps.store.getOrder(current.id); // someone else changed it; look again once
      if (!reread) return flagReview(deps, current, payment, "order_missing");
      current = reread.order;
      continue;
    }

    if (current.status === "expired" || current.status === "cancelled") return flagReview(deps, current, payment, "order_released");
    if (current.status === "refunded") return flagReview(deps, current, payment, "order_refunded");
    // payment_review: already with a human.
    deps.log("product_payment_review", { orderId: current.id, paymentId: payment.id, reason: "order_in_review" });
    return { status: "review", orderStatus: current.status, settledNow: false, earningRecorded: false, reason: "order_in_review" };
  }

  if (current.status !== "paid" && current.status !== "fulfilled") {
    return flagReview(deps, current, payment, "payment_status_conflict");
  }

  // 4. Earning — exactly once (unique per order and per payment). Safe to re-run.
  const earning = await ensureEarning(deps, current, payment);

  // 5. Side effects run only for the caller that actually settled the order.
  if (settledNow && deps.onOrderPaid) {
    try {
      const profile = await deps.store.getProfile(current.profile_id);
      await deps.onOrderPaid({ order: current, profile, gross: Number(payment.amount) });
    } catch (err) {
      deps.log("product_order_paid_hook_failed", { orderId: current.id, error: String((err as Error)?.message || err).slice(0, 120) });
    }
  }

  return {
    status: "succeeded",
    orderStatus: current.status,
    settledNow,
    earningRecorded: earning.recorded,
    ...(earning.duplicate ? { duplicatePayment: true } : {}),
  };
}
