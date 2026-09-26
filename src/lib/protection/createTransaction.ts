// Create (or idempotently resume) a Ringo Protection transaction for an EXISTING product order.
// The order itself is created through the UNMODIFIED, existing createProductOrder/create_product_order
// (Normal Payment's own code) — this file only ever reads that order, never creates one. The fee is
// always computed server-side from the current admin-configured rate; the browser supplies only an
// order id.

import { computeProtectionFee } from "./fee";
import { checkProtectionEligibility } from "./checkoutEligibility";
import { fail, ok, type Result } from "./checkoutErrors";
import { withinProtectionLimit } from "./checkoutRateLimit";
import { PAYMENT_WINDOW_MINUTES } from "./checkoutConstants";
import { toProtectionTransactionView, type ProtectionCheckoutDeps, type ProtectionTransactionRow, type ProtectionTransactionView } from "./checkoutTypes";

export type { ProtectionTransactionView };

function toView(row: ProtectionTransactionRow, expiresAt: string | null): ProtectionTransactionView {
  return toProtectionTransactionView(row, expiresAt);
}

const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export async function createProtectionTransaction(
  deps: ProtectionCheckoutDeps,
  orderId: string,
  ctx: { clientKey?: string | null } = {}
): Promise<Result<ProtectionTransactionView>> {
  if (!isUuid(orderId)) return fail("order_not_found");

  const order = await deps.store.getOrder(orderId);
  if (!order) return fail("order_not_found");

  // Idempotent resume: a protection transaction already exists for this order (a retried submit,
  // a page refresh, a duplicate tab) — always return the SAME row, never a second one.
  const existing = await deps.store.getProtectionTransactionByOrder(orderId);
  if (existing) return ok(toView(existing, order.status === "awaiting_payment" ? order.expires_at : null));

  if (order.status !== "awaiting_payment") {
    return fail(order.status === "expired" || order.status === "cancelled" ? "order_expired" : "order_not_payable");
  }

  if (!(await withinProtectionLimit(deps.limiter, deps.log, "protection_checkout_ip", ctx.clientKey))) return fail("rate_limited");

  const [protection, commerce, profile] = await Promise.all([
    deps.store.getProtectionSettings(),
    deps.store.getCommerceSettings(),
    deps.store.getProfile(order.profile_id),
  ]);
  const blocked = checkProtectionEligibility({ protection, commerce, profile, order });
  if (blocked) return fail(blocked);

  const fee = computeProtectionFee(order.total, protection.protectionFeeRate);
  if (!fee) return fail("protection_not_configured");

  const inserted = await deps.store.insertProtectionTransaction({
    targetId: order.id,
    profileId: order.profile_id,
    creatorUserId: profile!.user_id,
    customerId: order.customer_id,
    currency: order.currency,
    productAmount: fee.productAmount,
    protectionFeeRate: fee.feeRate,
    protectionFeeAmount: fee.feeAmount,
    customerTotal: fee.customerTotal,
  });

  let row: ProtectionTransactionRow;
  if (!inserted.ok) {
    // Lost a race to a concurrent identical request (unique (target_type,target_id) violation).
    const again = await deps.store.getProtectionTransactionByOrder(orderId);
    if (!again) return fail("internal_error");
    row = again;
  } else {
    row = inserted.row;
  }

  // Extend the order's reservation to cover the full Protection payment window UP FRONT (before any
  // payment attempt starts), proactively rather than reactively — see the Phase 4 audit's own note on
  // release_product_order_stock()'s guard only recognising customer_payments, not protection_payments.
  const now = deps.now();
  const minExpiry = new Date(now.getTime() + PAYMENT_WINDOW_MINUTES * 60_000);
  let expiresAt = order.expires_at;
  if (minExpiry.getTime() > new Date(order.expires_at).getTime()) {
    expiresAt = minExpiry.toISOString();
    await deps.store.updateOrder(order.id, { expires_at: expiresAt }, "awaiting_payment");
  }

  return ok(toView(row, expiresAt));
}
