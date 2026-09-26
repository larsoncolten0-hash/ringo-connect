// Digital Products V1 — the pure authorization decision for a customer's download. No Supabase/Next
// import, so it is unit-testable with plain objects, same discipline as productCheckout/eligibility.ts
// and protection/checkoutEligibility.ts.
//
// The authoritative chain is ALWAYS: order -> order item -> digital file snapshot -> authorization.
// A product id is used only to select which of an order's items is being asked about — it is never,
// on its own, sufficient to return a path (an order id and a session are also required, per the
// rules below). The file path returned here comes ONLY from the item's own snapshot, never from
// anything the caller supplied — this is what makes "the file belongs to that product/order" true
// by construction rather than by a separate check.

export type DownloadDenyReason =
  | "invalid_request"
  | "order_not_found"
  | "order_not_paid"
  | "item_not_found"
  | "not_digital"
  | "not_authorized";

export interface DownloadOrderFacts {
  id: string;
  status: "awaiting_payment" | "paid" | "fulfilled" | "cancelled" | "expired" | "refunded" | "payment_review";
  /** null = a guest checkout (no Ringo Customer account). Never assumed — read straight off the row. */
  customerId: string | null;
}

export interface DownloadItemFacts {
  digitalFilePath: string | null;
  digitalFileName: string | null;
}

export interface DownloadSessionFacts {
  /** The signed-in Ringo customer id resolved from the request's OWN cookie by the caller (never
   *  from the request body/query) — see getCustomerFromCookie(). null if there is no session. */
  sessionCustomerId: string | null;
}

export type DownloadDecision = { ok: true; path: string; fileName: string | null } | { ok: false; reason: DownloadDenyReason };

// Cancelled/expired/refunded/payment_review/awaiting_payment orders are never eligible — a refund
// or a released reservation must not leave a downloadable file behind, matching the existing
// commerce rule that only a genuinely paid order is worth anything.
const ELIGIBLE_STATUSES = new Set(["paid", "fulfilled"]);

export function decideDigitalDownload(order: DownloadOrderFacts | null, item: DownloadItemFacts | null, session: DownloadSessionFacts): DownloadDecision {
  if (!order) return { ok: false, reason: "order_not_found" };
  if (!ELIGIBLE_STATUSES.has(order.status)) return { ok: false, reason: "order_not_paid" };
  if (!item) return { ok: false, reason: "item_not_found" };
  if (!item.digitalFilePath) return { ok: false, reason: "not_digital" };

  if (order.customerId !== null) {
    // A signed-in purchase: the CURRENT session must be the exact same customer who bought it.
    // Knowing the order id is never enough on its own once an owning customer exists.
    if (session.sessionCustomerId !== order.customerId) return { ok: false, reason: "not_authorized" };
  }
  // A guest order (customerId === null): there is no account to sign back into, so the order's own
  // unguessable UUID is the entitlement — the same posture the rest of the Shop receipt
  // architecture (getShopOrderReceiptData) already uses for guest purchases. This preserves guest
  // checkout as first-class, per Decision B.

  return { ok: true, path: item.digitalFilePath, fileName: item.digitalFileName };
}
