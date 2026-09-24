// Payment status for a product order. Asks Fapshi (never trusts the client), normalises the answer,
// settles a success exactly once via settleProductPayment, records failed/expired attempts, and
// applies lazy expiry (an unpaid order past its window with no live attempt releases its stock).
// Safe to call repeatedly: polling, refreshes and retries all converge.

import { LATE_CONFIRMATION_LOOKBACK_HOURS } from "./constants";
import { toOrderView, type OrderView } from "./createOrder";
import { fail, ok, type CheckoutErrorCode, type Result } from "./errors";
import { formatProductReceiptNumber } from "./format";
import { settleProductPayment, type SettleOutcome } from "./settlement";
import type { CheckoutDeps, OrderRow, PaymentRow, ProviderStatus } from "./types";
import { isUuid } from "./validation";

export type PaymentState = "not_started" | "pending" | "succeeded" | "failed" | "expired" | "review";

export interface PaymentStatusView {
  status: PaymentState;
  order: OrderView & { paid_at: string | null };
  /** present once paid — the data the receipt / confirmation screen needs */
  receipt_number?: string;
  seller_username?: string | null;
  code?: CheckoutErrorCode;
  /** while pending: when the current attempt stops being live */
  expires_at?: string;
}

/** Provider status -> our four states. Anything unrecognised is treated as still pending. */
export function normalizeProviderStatus(status: ProviderStatus | string | null | undefined): "pending" | "succeeded" | "failed" | "expired" {
  switch (status) {
    case "SUCCESSFUL":
      return "succeeded";
    case "FAILED":
      return "failed";
    case "EXPIRED":
      return "expired";
    default:
      return "pending";
  }
}

// eslint-disable-next-line no-control-regex
const safeReason = (r: string | null | undefined) => (r ? r.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 200) || null : null);
const isLive = (p: PaymentRow, nowMs: number) => (p.status === "initiated" || p.status === "pending") && new Date(p.expires_at).getTime() > nowMs;

export async function checkProductPayment(deps: CheckoutDeps, orderId: string): Promise<Result<PaymentStatusView>> {
  if (!isUuid(orderId)) return fail("order_not_found");
  let found = await deps.store.getOrder(orderId);
  if (!found) return fail("order_not_found");
  const nowMs = deps.now().getTime();

  const build = async (state: PaymentState, extra: Partial<PaymentStatusView> = {}): Promise<Result<PaymentStatusView>> => {
    const latest = (await deps.store.getOrder(orderId)) ?? found!;
    const view: PaymentStatusView = {
      status: state,
      order: { ...toOrderView(latest.order, latest.items), paid_at: latest.order.paid_at },
      ...extra,
    };
    if (state === "succeeded") {
      view.receipt_number = formatProductReceiptNumber(latest.order.order_number);
      view.seller_username = (await deps.store.getProfile(latest.order.profile_id))?.username ?? null;
    }
    return ok(view);
  };
  const fromOutcome = (out: SettleOutcome) =>
    out.status === "succeeded" ? build("succeeded") : build("review", { code: "payment_review" });

  let payments = await deps.store.listPayments(orderId); // newest first

  // 1. A payment we already recorded as succeeded: re-run settlement (idempotent) so a crash between
  //    steps heals on the next poll. Use the earliest success if the customer somehow paid twice.
  const earliestSuccess = [...payments].reverse().find((p) => p.status === "succeeded");
  if (earliestSuccess) return fromOutcome(await settleProductPayment(deps, earliestSuccess.id, { amount: null }));

  if (found.order.status === "payment_review") return build("review", { code: "payment_review" });

  // 2. Ask the provider about open attempts and recently expired/cancelled ones (a late confirmation
  //    is still real money).
  const cutoff = nowMs - LATE_CONFIRMATION_LOOKBACK_HOURS * 3_600_000;
  const candidates = payments
    .filter(
      (p) =>
        !!p.provider_transaction_id &&
        (p.status === "initiated" || p.status === "pending" || ((p.status === "expired" || p.status === "cancelled") && new Date(p.created_at).getTime() > cutoff))
    )
    .slice(0, 3);

  for (const p of candidates) {
    let tx: { status: ProviderStatus; amount: number | null; reason?: string | null };
    try {
      tx = await deps.provider.getStatus(p.provider_transaction_id as string);
    } catch (err) {
      deps.log("product_provider_status_error", { paymentId: p.id, error: String((err as Error)?.message || err).slice(0, 160) });
      continue; // unknown right now — stay pending, try again next poll
    }
    const state = normalizeProviderStatus(tx.status);
    if (state === "succeeded") return fromOutcome(await settleProductPayment(deps, p.id, { amount: tx.amount }));
    if (state === "failed") {
      await deps.store.updatePayment(p.id, { status: "failed", provider_status: "FAILED", failure_reason: safeReason(tx.reason) }, ["initiated", "pending"]);
    } else if (state === "expired") {
      await deps.store.updatePayment(p.id, { status: "expired", provider_status: "EXPIRED" }, ["initiated", "pending"]);
    } else if ((p.status === "initiated" || p.status === "pending") && new Date(p.expires_at).getTime() <= nowMs) {
      await deps.store.updatePayment(p.id, { status: "expired", provider_status: String(tx.status) }, ["initiated", "pending"]);
    }
  }

  payments = await deps.store.listPayments(orderId);
  found = (await deps.store.getOrder(orderId)) ?? found;
  let order: OrderRow = found.order;

  // 3. Lazy expiry: unpaid, past its window, nothing live -> release the stock exactly once.
  const live = payments.find((p) => isLive(p, nowMs));
  if (order.status === "awaiting_payment" && new Date(order.expires_at).getTime() <= nowMs && !live) {
    await deps.store.releaseOrder(order.id, "expired");
    found = (await deps.store.getOrder(orderId)) ?? found;
    order = found.order;
  }

  if (order.status === "payment_review") return build("review", { code: "payment_review" });
  if (order.status === "paid" || order.status === "fulfilled") {
    // Paid without a succeeded payment row in view (race with another caller): show as succeeded.
    return build("succeeded");
  }
  if (order.status === "expired" || order.status === "cancelled") return build("expired", { code: "order_expired" });
  if (live) return build("pending", { expires_at: live.expires_at });

  const latest = payments[0];
  if (!latest) return build("not_started");
  if (latest.status === "failed") return build("failed", { code: "payment_failed" });
  return build("expired", { code: "payment_expired" });
}
