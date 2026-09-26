import { createAdminClient } from "@/lib/supabase/server";
import { formatProductOrderNumber } from "@/lib/productCheckout/format";

// Ringo Protection — Phase 8: shared read model for admin dispute monitoring, used by BOTH the
// existing Phase 7 API route (src/app/api/admin/protection/disputes/route.ts, now just a thin
// wrapper around this) and the new Phase 8 admin disputes page — a single source of truth for the
// list shape rather than two drifting copies. Read-only; every resolution action still goes through
// the EXISTING Phase 7 disputeEngine.ts (never duplicated here).

export type AdminProtectionDisputeRow = {
  id: string;
  status: string;
  reason: string;
  message: string | null;
  openedAt: string;
  resolvedAt: string | null;
  transactionId: string;
  transactionStatus: string | null;
  protectedAmount: number | null;
  feeAmount: number | null;
  currency: string | null;
  orderId: string;
  orderReference: string;
  sellerName: string | null;
};

export async function listAdminProtectionDisputes(): Promise<AdminProtectionDisputeRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("protection_disputes")
    .select(
      `id, status, reason, message, opened_at, resolved_at,
       protection_transaction_id, order_id, profile_id, customer_id,
       protection_transactions(status, product_amount, protection_fee_amount, currency),
       profiles(name, username)`
    )
    .order("opened_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(`protection_disputes list failed (${error.code || "error"})`);

  // order_id has no real FK to product_orders (same deliberately unconstrained polymorphic
  // reference protection_transactions.target_id uses — see adminTransactions.ts's own comment), so
  // PostgREST's `product_orders!order_id(...)` embed can never resolve it (PGRST200). A separate
  // lookup + Map merge replaces it, same pattern as adminTransactions.ts.
  const orderIds = (data || []).map((d: any) => d.order_id);
  const { data: orders } = orderIds.length
    ? await admin.from("product_orders").select("id, order_number").in("id", orderIds)
    : { data: [] };
  const orderNumberById = new Map((orders || []).map((o: any) => [o.id, o.order_number]));

  return (data || []).map((d: any) => ({
    id: d.id,
    status: d.status,
    reason: d.reason,
    message: d.message,
    openedAt: d.opened_at,
    resolvedAt: d.resolved_at,
    transactionId: d.protection_transaction_id,
    transactionStatus: d.protection_transactions?.status ?? null,
    protectedAmount: d.protection_transactions ? Number(d.protection_transactions.product_amount) : null,
    feeAmount: d.protection_transactions ? Number(d.protection_transactions.protection_fee_amount) : null,
    currency: d.protection_transactions?.currency ?? null,
    orderId: d.order_id,
    orderReference: orderNumberById.has(d.order_id) ? formatProductOrderNumber(orderNumberById.get(d.order_id)) : "—",
    sellerName: d.profiles?.name || d.profiles?.username || null,
  }));
}
