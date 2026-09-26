import { createAdminClient } from "@/lib/supabase/server";
import { formatProductOrderNumber } from "@/lib/productCheckout/format";

// Ringo Protection — Phase 8: read-only admin refund monitoring. No action routes here — resolving
// a dispute toward refund (which creates the ONE protection_refunds row per transaction) already
// happens exclusively through the existing Phase 7 disputeEngine.ts / resolve-dispute route. This
// file never calls the refund adapter and never writes to protection_refunds.

export type AdminProtectionRefundRow = {
  id: string;
  transactionId: string;
  orderId: string;
  orderReference: string;
  sellerName: string | null;
  amount: number;
  currency: string;
  status: string;
  destinationPhone: string | null;
  destinationNetwork: string | null;
  providerReference: string | null;
  providerStatus: string | null;
  failureReason: string | null;
  requestedAt: string;
  processingStartedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
};

export async function listAdminProtectionRefunds(): Promise<AdminProtectionRefundRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("protection_refunds")
    .select(
      `id, protection_transaction_id, order_id, refund_amount, currency, status,
       destination_phone, destination_network, provider_reference, provider_status, failure_reason,
       requested_at, processing_started_at, completed_at, failed_at,
       protection_transactions(profiles(name, username))`
    )
    .order("requested_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(`protection_refunds list failed (${error.code || "error"})`);

  // order_id has no real FK to product_orders (same deliberately unconstrained polymorphic
  // reference protection_transactions.target_id uses — see adminTransactions.ts's own comment), so
  // PostgREST's `product_orders!order_id(...)` embed can never resolve it (PGRST200). A separate
  // lookup + Map merge replaces it, same pattern as adminTransactions.ts.
  const orderIds = (data || []).map((r: any) => r.order_id);
  const { data: orders } = orderIds.length
    ? await admin.from("product_orders").select("id, order_number").in("id", orderIds)
    : { data: [] };
  const orderNumberById = new Map((orders || []).map((o: any) => [o.id, o.order_number]));

  return (data || []).map((r: any) => ({
    id: r.id,
    transactionId: r.protection_transaction_id,
    orderId: r.order_id,
    orderReference: orderNumberById.has(r.order_id) ? formatProductOrderNumber(orderNumberById.get(r.order_id)) : "—",
    sellerName: r.protection_transactions?.profiles?.name || r.protection_transactions?.profiles?.username || null,
    amount: Number(r.refund_amount),
    currency: r.currency,
    status: r.status,
    destinationPhone: r.destination_phone,
    destinationNetwork: r.destination_network,
    providerReference: r.provider_reference,
    providerStatus: r.provider_status,
    failureReason: r.failure_reason,
    requestedAt: r.requested_at,
    processingStartedAt: r.processing_started_at,
    completedAt: r.completed_at,
    failedAt: r.failed_at,
  }));
}
