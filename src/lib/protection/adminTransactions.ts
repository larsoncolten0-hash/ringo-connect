import { createAdminClient } from "@/lib/supabase/server";
import { formatProductOrderNumber } from "@/lib/productCheckout/format";
import type { ProtectionTransactionStatus } from "./adminOverview";

// Ringo Protection — Phase 8: read-only admin transaction list + detail. Service-role reads only
// (mirrors getAdminShopPayoutOverview()'s own posture); nothing here writes anything. Dispute
// resolution and every other mutation continue to go through the EXISTING Phase 6/7 engines and
// routes — this file is monitoring/read-model only.

export type AdminProtectionTransactionRow = {
  id: string;
  orderId: string;
  orderReference: string;
  status: ProtectionTransactionStatus;
  sellerUsername: string | null;
  sellerName: string | null;
  customerId: string | null;
  productAmount: number;
  feeAmount: number;
  customerTotal: number;
  currency: string;
  createdAt: string;
  updatedAt: string;
  autoReleaseAt: string | null;
  hasDispute: boolean;
  hasRefund: boolean;
  isReleased: boolean;
};

export type AdminProtectionListFilters = {
  status?: ProtectionTransactionStatus | "all" | "disputed_only" | "refund_only";
  /** Matches seller username/name (case-insensitive, partial). */
  sellerQuery?: string;
  /** Matches a transaction id, order id, or order reference (e.g. "PO-000123"), exact or partial. */
  search?: string;
  dateFrom?: string; // ISO date, inclusive
  dateTo?: string; // ISO date, inclusive
};

const LIST_LIMIT = 500;

export async function listAdminProtectionTransactions(filters: AdminProtectionListFilters = {}): Promise<AdminProtectionTransactionRow[]> {
  const admin = createAdminClient();

  let query = admin
    .from("protection_transactions")
    .select(
      `id, target_id, status, currency, product_amount, protection_fee_amount, customer_total, customer_id,
       created_at, updated_at, auto_release_at,
       profiles(username, name)`
    )
    .eq("target_type", "product_order")
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT);

  if (filters.status && filters.status !== "all" && filters.status !== "disputed_only" && filters.status !== "refund_only") {
    query = query.eq("status", filters.status);
  }
  if (filters.dateFrom) query = query.gte("created_at", filters.dateFrom);
  if (filters.dateTo) query = query.lte("created_at", filters.dateTo);

  const { data, error } = await query;
  if (error) throw new Error(`protection_transactions list failed (${error.code || "error"})`);

  const ids = (data || []).map((r: any) => r.id);
  // target_id has no real FK to product_orders (protection_transactions.target_type/target_id is a
  // deliberately unconstrained polymorphic reference — see 2026-11-06_ringo_protection_foundation.sql's
  // own comment), so PostgREST's `product_orders!target_id(...)` embed shorthand can never resolve it
  // (PGRST200). A separate lookup + Map merge, same as the existing dispute/refund existence checks
  // below, is the correct way to join this in application code instead.
  const orderIds = (data || []).map((r: any) => r.target_id);
  const [{ data: disputes }, { data: refunds }, { data: orders }] = await Promise.all([
    ids.length ? admin.from("protection_disputes").select("protection_transaction_id").in("protection_transaction_id", ids) : Promise.resolve({ data: [] }),
    ids.length ? admin.from("protection_refunds").select("protection_transaction_id").in("protection_transaction_id", ids) : Promise.resolve({ data: [] }),
    orderIds.length ? admin.from("product_orders").select("id, order_number").in("id", orderIds) : Promise.resolve({ data: [] }),
  ]);
  const disputedIds = new Set((disputes || []).map((d: any) => d.protection_transaction_id));
  const refundedIds = new Set((refunds || []).map((r: any) => r.protection_transaction_id));
  const orderNumberById = new Map((orders || []).map((o: any) => [o.id, o.order_number]));

  let rows: AdminProtectionTransactionRow[] = (data || []).map((row: any) => ({
    id: row.id,
    orderId: row.target_id,
    orderReference: orderNumberById.has(row.target_id) ? formatProductOrderNumber(orderNumberById.get(row.target_id)) : "—",
    status: row.status,
    sellerUsername: row.profiles?.username ?? null,
    sellerName: row.profiles?.name ?? null,
    customerId: row.customer_id,
    productAmount: Number(row.product_amount),
    feeAmount: Number(row.protection_fee_amount),
    customerTotal: Number(row.customer_total),
    currency: row.currency,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    autoReleaseAt: row.auto_release_at,
    hasDispute: disputedIds.has(row.id),
    hasRefund: refundedIds.has(row.id),
    isReleased: row.status === "released",
  }));

  if (filters.status === "disputed_only") rows = rows.filter((r) => r.hasDispute);
  if (filters.status === "refund_only") rows = rows.filter((r) => r.hasRefund);

  if (filters.sellerQuery) {
    const q = filters.sellerQuery.trim().toLowerCase();
    rows = rows.filter((r) => (r.sellerUsername || "").toLowerCase().includes(q) || (r.sellerName || "").toLowerCase().includes(q));
  }
  if (filters.search) {
    const q = filters.search.trim().toLowerCase();
    rows = rows.filter((r) => r.id.toLowerCase().includes(q) || r.orderId.toLowerCase().includes(q) || r.orderReference.toLowerCase().includes(q));
  }

  return rows;
}

export type AdminProtectionEvent = {
  id: string;
  fromStatus: string;
  toStatus: string;
  actorType: string;
  actorUserId: string | null;
  actorCustomerId: string | null;
  reason: string | null;
  createdAt: string;
};

export type AdminProtectionTransactionDetail = {
  id: string;
  orderId: string;
  orderReference: string;
  status: ProtectionTransactionStatus;
  currency: string;
  productAmount: number;
  feeRate: number;
  feeAmount: number;
  customerTotal: number;
  sellerProtectedAmount: number;
  sellerUsername: string | null;
  sellerName: string | null;
  customerId: string | null;
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
  releasedAt: string | null;
  refundedAt: string | null;
  autoReleaseAt: string | null;
  payment: { status: string; medium: string | null; confirmedAt: string | null; providerStatus: string | null } | null;
  release: { earningId: string; netAmount: number; currency: string; status: string; availableAt: string; payoutId: string | null; payoutStatus: string | null } | null;
  refund: { id: string; amount: number; currency: string; status: string; destinationPhone: string | null; destinationNetwork: string | null; providerReference: string | null; providerStatus: string | null; failureReason: string | null; requestedAt: string; processingStartedAt: string | null; completedAt: string | null; failedAt: string | null } | null;
  dispute: { id: string; status: string; reason: string; message: string | null; openedAt: string; resolvedAt: string | null; resolvedBy: string | null } | null;
  events: AdminProtectionEvent[];
};

export async function getAdminProtectionTransactionDetail(id: string): Promise<AdminProtectionTransactionDetail | null> {
  const admin = createAdminClient();

  const { data: txn } = await admin
    .from("protection_transactions")
    .select(
      `id, target_id, status, currency, product_amount, protection_fee_rate, protection_fee_amount, customer_total, seller_protected_amount,
       customer_id, created_at, updated_at, paid_at, released_at, refunded_at, auto_release_at,
       profiles(username, name)`
    )
    .eq("id", id)
    .maybeSingle();
  if (!txn) return null;

  // Same reasoning as listAdminProtectionTransactions above: target_id has no real FK to
  // product_orders, so a separate lookup replaces the unresolvable `product_orders!target_id(...)` embed.
  const [{ data: paymentRows }, { data: earningRow }, { data: refundRow }, { data: disputeRow }, { data: eventRows }, { data: orderRow }] = await Promise.all([
    admin.from("protection_payments").select("status, payer_medium, confirmed_at, provider_status, created_at").eq("protection_transaction_id", id).order("created_at", { ascending: false }).limit(1),
    admin.from("commerce_sale_earnings").select("id, net_amount, currency, status, available_at, payout_id").eq("protection_transaction_id", id).maybeSingle(),
    admin
      .from("protection_refunds")
      .select("id, refund_amount, currency, status, destination_phone, destination_network, provider_reference, provider_status, failure_reason, requested_at, processing_started_at, completed_at, failed_at")
      .eq("protection_transaction_id", id)
      .maybeSingle(),
    admin.from("protection_disputes").select("id, status, reason, message, opened_at, resolved_at, resolved_by").eq("protection_transaction_id", id).maybeSingle(),
    admin.from("protection_transaction_events").select("id, from_status, to_status, actor_type, actor_user_id, actor_customer_id, reason, created_at").eq("protection_transaction_id", id).order("created_at", { ascending: true }),
    admin.from("product_orders").select("order_number").eq("id", txn.target_id).maybeSingle(),
  ]);

  let payoutStatus: string | null = null;
  if (earningRow?.payout_id) {
    const { data: payout } = await admin.from("commerce_payouts").select("status").eq("id", earningRow.payout_id).maybeSingle();
    payoutStatus = payout?.status ?? null;
  }

  const payment = paymentRows?.[0];
  const profile = (txn as any).profiles;

  return {
    id: txn.id,
    orderId: txn.target_id,
    orderReference: orderRow?.order_number != null ? formatProductOrderNumber(orderRow.order_number) : "—",
    status: txn.status,
    currency: txn.currency,
    productAmount: Number(txn.product_amount),
    feeRate: Number(txn.protection_fee_rate),
    feeAmount: Number(txn.protection_fee_amount),
    customerTotal: Number(txn.customer_total),
    sellerProtectedAmount: Number(txn.seller_protected_amount),
    sellerUsername: profile?.username ?? null,
    sellerName: profile?.name ?? null,
    customerId: txn.customer_id,
    createdAt: txn.created_at,
    updatedAt: txn.updated_at,
    paidAt: txn.paid_at,
    releasedAt: txn.released_at,
    refundedAt: txn.refunded_at,
    autoReleaseAt: txn.auto_release_at,
    payment: payment ? { status: payment.status, medium: payment.payer_medium, confirmedAt: payment.confirmed_at, providerStatus: payment.provider_status } : null,
    release: earningRow ? { earningId: earningRow.id, netAmount: Number(earningRow.net_amount), currency: earningRow.currency, status: earningRow.status, availableAt: earningRow.available_at, payoutId: earningRow.payout_id, payoutStatus } : null,
    refund: refundRow
      ? {
          id: refundRow.id,
          amount: Number(refundRow.refund_amount),
          currency: refundRow.currency,
          status: refundRow.status,
          destinationPhone: refundRow.destination_phone,
          destinationNetwork: refundRow.destination_network,
          providerReference: refundRow.provider_reference,
          providerStatus: refundRow.provider_status,
          failureReason: refundRow.failure_reason,
          requestedAt: refundRow.requested_at,
          processingStartedAt: refundRow.processing_started_at,
          completedAt: refundRow.completed_at,
          failedAt: refundRow.failed_at,
        }
      : null,
    dispute: disputeRow ? { id: disputeRow.id, status: disputeRow.status, reason: disputeRow.reason, message: disputeRow.message, openedAt: disputeRow.opened_at, resolvedAt: disputeRow.resolved_at, resolvedBy: disputeRow.resolved_by } : null,
    events: (eventRows || []).map((e: any) => ({ id: e.id, fromStatus: e.from_status, toStatus: e.to_status, actorType: e.actor_type, actorUserId: e.actor_user_id, actorCustomerId: e.actor_customer_id, reason: e.reason, createdAt: e.created_at })),
  };
}
