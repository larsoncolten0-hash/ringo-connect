import { createAdminClient } from "@/lib/supabase/server";
import { legalFromStatusesFor } from "@/lib/protection/transitions";
import { formatProductOrderNumber, formatProductReceiptNumber } from "./format";
import type { OrderStatus } from "./types";

const DISPUTE_ELIGIBLE_STATUSES = new Set(legalFromStatusesFor("disputed"));

// The one place a product_orders row is turned into "everything a receipt needs to render" —
// shared by the customer receipt page (src/app/shop/orders/[id]/page.tsx), the customer-facing
// API route (src/app/api/products/orders/[id]/route.ts) and the receipt email
// (sendShopOrderReceiptEmail.ts), so the three stay in sync by construction rather than as three
// drifting copies of the same query — the same reasoning musicReceipt.ts already documents for
// music orders.
//
// Every line item's name/price/image comes from product_order_items' own *_snapshot columns,
// never from a live join to `products`, so a receipt for an order placed before a price or name
// change stays historically accurate automatically (product_order_items_guard enforces this at
// the database level too).
//
// Hand-picks fields only — never customer_phone, customer_email, profile_id, or any provider/
// payout column — matching the existing seller-facing getPaymentSummary() convention in
// sellerReaders.ts. Public/unauthenticated by design: the order id is a random UUID handed to
// the customer at checkout, never listable, so knowing it is itself the access control (same
// posture as getMusicReceiptData and the restaurant order route).
export type ShopReceiptItem = {
  name: string;
  image: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};

export type ShopReceiptPayment = {
  status: string;
  method: string | null;
  confirmedAt: string | null;
};

/** Ringo Protection — Phase 5: read-only, additive status for the customer receipt. `null` for
 *  every Normal Payment order (no protection_transactions row exists for it). */
export type ShopReceiptProtection = {
  transactionId: string;
  status: "awaiting_payment" | "protected" | "fulfillment_started" | "awaiting_confirmation" | "released" | "disputed" | "resolved_release" | "resolved_refund" | "refunded" | "cancelled" | "expired" | "payment_failed";
  protectedAmount: number;
  feeAmount: number;
  customerTotal: number;
  awaitingConfirmation: boolean;
  /** Phase 7: true while the transaction is in a status the customer may open a dispute from. */
  disputeEligible: boolean;
  /** Phase 9: when the transaction is scheduled to auto-release if the customer takes no action. */
  autoReleaseAt: string | null;
  /** Phase 9: the refund record's OWN granular status, when one exists — distinct from the
   *  transaction's own status so the customer is never told more than the backend has actually
   *  confirmed (e.g. `resolved_refund` on the transaction only ever means "requested", never
   *  "completed" — see refund.status for the truth). Never includes destination/provider details. */
  refund: { status: "requested" | "processing" | "completed" | "failed" } | null;
};

export type ShopReceiptData = {
  orderId: string;
  orderNumber: string; // "PO-000123"
  receiptNumber: string; // "RCP-000123"
  status: OrderStatus;
  createdAt: string;
  paidAt: string | null;
  currency: string;
  subtotal: number;
  total: number;
  sellerName: string;
  sellerUsername: string;
  payment: ShopReceiptPayment | null;
  items: ShopReceiptItem[];
  protection: ShopReceiptProtection | null;
};

export async function getShopOrderReceiptData(orderId: string): Promise<ShopReceiptData | null> {
  const admin = createAdminClient();

  const { data: order } = await admin
    .from("product_orders")
    .select(
      `id, order_number, status, currency, subtotal, total, created_at, paid_at,
       product_order_items(name_snapshot, image_snapshot, unit_price_snapshot, quantity, line_total),
       profiles(name, username)`
    )
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return null;

  const profile = order.profiles as any;
  if (!profile?.username) return null;

  // customer_payments has no client grant at all (see the foundation migration) — this is the
  // service-role admin client, same as every other reader of this table.
  const { data: payments } = await admin
    .from("customer_payments")
    .select("status, payer_medium, confirmed_at")
    .eq("target_type", "product_order")
    .eq("target_id", orderId)
    .order("created_at", { ascending: true });
  const rows = (payments || []) as { status: string; payer_medium: string | null; confirmed_at: string | null }[];
  const chosen = rows.find((p) => p.status === "succeeded") ?? rows[rows.length - 1] ?? null;

  const items = (order.product_order_items || []) as any[];

  // Ringo Protection (Phase 5): additive, best-effort read — a Normal Payment order simply has no
  // row here (unique (target_type,target_id), so at most one). Same "unguessable order id" access
  // posture as the rest of this function; nothing here is any more exposed than the payment/status
  // fields already returned above.
  let protection: ShopReceiptData["protection"] = null;
  try {
    const { data: txn } = await admin
      .from("protection_transactions")
      .select("id, status, product_amount, protection_fee_amount, customer_total, auto_release_at")
      .eq("target_type", "product_order")
      .eq("target_id", orderId)
      .maybeSingle();
    if (txn) {
      const { data: refundRow } = await admin.from("protection_refunds").select("status").eq("protection_transaction_id", txn.id).maybeSingle();
      const refund = refundRow ? { status: refundRow.status as "requested" | "processing" | "completed" | "failed" } : null;

      protection = {
        transactionId: txn.id,
        status: txn.status,
        protectedAmount: Number(txn.product_amount),
        feeAmount: Number(txn.protection_fee_amount),
        customerTotal: Number(txn.customer_total),
        awaitingConfirmation: txn.status === "awaiting_confirmation",
        disputeEligible: DISPUTE_ELIGIBLE_STATUSES.has(txn.status),
        autoReleaseAt: txn.auto_release_at ?? null,
        refund,
      };
    }
  } catch {
    protection = null; // never let a Protection read failure break an existing Normal Payment receipt
  }

  return {
    orderId: order.id,
    orderNumber: formatProductOrderNumber(order.order_number),
    receiptNumber: formatProductReceiptNumber(order.order_number),
    status: order.status as OrderStatus,
    createdAt: order.created_at,
    paidAt: order.paid_at,
    currency: order.currency,
    subtotal: Number(order.subtotal),
    total: Number(order.total),
    sellerName: profile.name || profile.username,
    sellerUsername: profile.username,
    payment: chosen ? { status: chosen.status, method: chosen.payer_medium, confirmedAt: chosen.confirmed_at } : null,
    items: items.map((i) => ({
      name: i.name_snapshot,
      image: i.image_snapshot ?? null,
      quantity: i.quantity,
      unitPrice: Number(i.unit_price_snapshot),
      lineTotal: Number(i.line_total),
    })),
    protection,
  };
}
