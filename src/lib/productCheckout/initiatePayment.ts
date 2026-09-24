// Start a Fapshi payment for an existing product order. The browser supplies only the payer's phone
// and mobile-money medium. The amount and currency come from the order row itself, never the client.
// One live attempt per order (also enforced by a partial unique index), a bounded number of attempts
// per order, and the provider is only called after our own payment row exists.

import { MAX_PAYMENT_ATTEMPTS, PAYMENT_WINDOW_MINUTES, PROVIDER, SUPPORTED_CURRENCY, TARGET_TYPE } from "./constants";
import { toOrderView, type OrderView } from "./createOrder";
import { checkPaymentEligibility } from "./eligibility";
import { fail, ok, type Result } from "./errors";
import type { CheckoutDeps, PaymentRow } from "./types";
import { isUuid, parsePayInput } from "./validation";

export interface PayStartView {
  status: "pending";
  expires_at: string; // when this attempt stops being live
  order: OrderView;
}

const isLive = (p: PaymentRow) => p.status === "initiated" || p.status === "pending";

export async function initiateProductPayment(deps: CheckoutDeps, orderId: string, raw: unknown): Promise<Result<PayStartView>> {
  if (!isUuid(orderId)) return fail("order_not_found");
  const parsed = parsePayInput(raw);
  if (!parsed.ok) return fail(parsed.code);
  const { phone, medium } = parsed.value;

  const found = await deps.store.getOrder(orderId);
  if (!found) return fail("order_not_found");
  const { order, items } = found;
  const now = deps.now();

  // The order must be consistent with the products it was made from (same profile).
  for (const item of items) {
    if (!item.product_id) continue;
    const product = await deps.store.getProduct(item.product_id);
    if (product && product.profile_id !== order.profile_id) {
      deps.log("product_order_profile_mismatch", { orderId: order.id });
      return fail("order_not_payable");
    }
  }

  switch (order.status) {
    case "awaiting_payment":
      break;
    case "payment_review":
      return fail("payment_review");
    case "expired":
      return fail("order_expired");
    default: // paid, fulfilled, cancelled, refunded
      return fail("order_not_payable");
  }

  const payments = await deps.store.listPayments(order.id);
  if (payments.some((p) => p.status === "succeeded")) return fail("order_not_payable"); // settlement is catching up

  const live = payments.find(isLive);
  if (live && new Date(live.expires_at).getTime() > now.getTime()) return fail("payment_already_pending");

  // Past its reservation clock with nothing live: release the stock and refuse (lazy expiry).
  if (new Date(order.expires_at).getTime() <= now.getTime()) {
    if (live) await deps.store.updatePayment(live.id, { status: "expired" }, ["initiated", "pending"]);
    await deps.store.releaseOrder(order.id, "expired");
    return fail("order_expired");
  }

  const [settings, profile] = await Promise.all([deps.store.getSettings(), deps.store.getProfile(order.profile_id)]);
  const blocked = checkPaymentEligibility({ settings, profile, order });
  if (blocked) return fail(blocked);

  if (payments.length >= MAX_PAYMENT_ATTEMPTS) return fail("too_many_payment_attempts");

  // A stale live attempt (its window has passed) makes way for the new one. The provider may still
  // confirm it later; the status check keeps honouring recently expired attempts.
  if (live) await deps.store.updatePayment(live.id, { status: "expired" }, ["initiated", "pending"]);

  const paymentId = deps.newId();
  const expiresAt = new Date(now.getTime() + PAYMENT_WINDOW_MINUTES * 60_000);
  const row: PaymentRow = {
    id: paymentId,
    provider: PROVIDER,
    provider_transaction_id: null,
    external_id: `pp-${paymentId}`, // unique per attempt; the reference sent to Fapshi
    target_type: TARGET_TYPE,
    target_id: order.id,
    profile_id: order.profile_id,
    customer_id: order.customer_id,
    amount: Number(order.total), // from the order, never the client
    currency: SUPPORTED_CURRENCY,
    payer_medium: medium,
    status: "initiated",
    provider_status: null,
    failure_reason: null,
    expires_at: expiresAt.toISOString(),
    confirmed_at: null,
    created_at: now.toISOString(),
  };
  const inserted = await deps.store.insertPayment(row);
  if (!inserted.ok) return fail("payment_already_pending"); // lost the one-live-attempt race

  let transId: string;
  try {
    const res = await deps.provider.directPay({
      amount: Number(order.total),
      phone,
      medium,
      userId: order.id,
      externalId: row.external_id,
      message: profile?.username ? `Ringo Connect — ${profile.username}` : "Ringo Connect",
    });
    if (!res?.transId) throw new Error("no transaction id returned");
    transId = res.transId;
  } catch (err) {
    // Provider text stays in the server log only.
    deps.log("product_provider_direct_pay_failed", { orderId: order.id, paymentId, error: String((err as Error)?.message || err).slice(0, 160) });
    await deps.store.updatePayment(paymentId, { status: "failed", failure_reason: "provider_error" }, ["initiated"]);
    return fail("payment_failed");
  }

  await deps.store.updatePayment(paymentId, { status: "pending", provider_transaction_id: transId, provider_status: "CREATED" }, ["initiated"]);

  // Keep the reservation at least as long as the attempt can still succeed (allowed while awaiting_payment).
  let orderExpiry = order.expires_at;
  if (expiresAt.getTime() > new Date(order.expires_at).getTime()) {
    orderExpiry = expiresAt.toISOString();
    await deps.store.updateOrder(order.id, { expires_at: orderExpiry }, "awaiting_payment");
  }

  return ok({ status: "pending", expires_at: expiresAt.toISOString(), order: toOrderView({ ...order, expires_at: orderExpiry }, items) });
}
