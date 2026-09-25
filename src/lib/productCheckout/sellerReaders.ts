// Supabase implementations of SellerReader / FulfillStore (Increment 5A). Server only. The clients are
// passed in, so this file imports nothing from Supabase or Next.
//
//  - `rls`   : the request-scoped client of the signed-in seller. Every ownership read goes through it, so
//              Postgres row level security (owner-or-admin) decides what exists - and every query ALSO
//              filters on the seller's own profile id, so even an admin only ever sees their own shop here.
//  - `admin` : the service-role client. Used for exactly two things: reading the payment ledger
//              (customer_payments has no client grant) - only after ownership was proven - and the
//              conditional paid -> fulfilled write (sellers have no UPDATE grant).
// Database error text is never returned to callers: errors are re-thrown generically for the route to
// turn into a stable code.

import type { OrderItemRow, OrderStatus } from "./types";
import type { EarningListRow, EarningRecord, PaymentSummary, SellerOrderRecord, SellerReader } from "./sellerOrders";
import type { FulfillStore } from "./fulfillOrder";

type Client = any;

const EARNINGS_CHUNK = 1000; // PostgREST returns at most 1000 rows per request
const EARNINGS_MAX_CHUNKS = 50;

function split(row: any): { order: SellerOrderRecord; items: OrderItemRow[] } {
  const { product_order_items, ...order } = row;
  return { order: order as SellerOrderRecord, items: (product_order_items || []) as OrderItemRow[] };
}

export function createSellerReader(rls: Client, admin: Client): SellerReader {
  return {
    async listOrders({ profileId, statuses, offset, limit }) {
      const { data, error, count } = await rls
        .from("product_orders")
        .select("*, product_order_items(*)", { count: "exact" })
        .eq("profile_id", profileId)
        .in("status", statuses)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(offset, offset + limit - 1);
      if (error) throw new Error(`product_orders list failed (${error.code || "error"})`);
      return { rows: (data || []).map(split), total: count ?? 0 };
    },

    async getOrder({ profileId, orderId }) {
      const { data, error } = await rls
        .from("product_orders")
        .select("*, product_order_items(*)")
        .eq("id", orderId)
        .eq("profile_id", profileId)
        .maybeSingle();
      if (error) throw new Error(`product_orders read failed (${error.code || "error"})`);
      return data ? split(data) : null;
    },

    async getEarningForOrder({ profileId, orderId }) {
      const { data, error } = await rls.from("commerce_sale_earnings").select("*").eq("order_id", orderId).eq("profile_id", profileId).maybeSingle();
      if (error) throw new Error(`commerce_sale_earnings read failed (${error.code || "error"})`);
      return (data as EarningRecord) ?? null;
    },

    async listEarnings({ profileId, offset, limit }) {
      const { data, error, count } = await rls
        .from("commerce_sale_earnings")
        .select("*, product_orders(order_number)", { count: "exact" })
        .eq("profile_id", profileId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(offset, offset + limit - 1);
      if (error) throw new Error(`commerce_sale_earnings list failed (${error.code || "error"})`);
      const rows: EarningListRow[] = (data || []).map((r: any) => {
        const { product_orders, ...rest } = r;
        return { ...(rest as EarningRecord), order_number: product_orders?.order_number ?? null };
      });
      return { rows, total: count ?? 0 };
    },

    async listEarningAmounts(profileId) {
      const out: any[] = [];
      for (let i = 0; i < EARNINGS_MAX_CHUNKS; i++) {
        const { data, error } = await rls
          .from("commerce_sale_earnings")
          .select("gross_amount, platform_fee, net_amount, status, currency")
          .eq("profile_id", profileId)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(i * EARNINGS_CHUNK, (i + 1) * EARNINGS_CHUNK - 1);
        if (error) throw new Error(`commerce_sale_earnings totals failed (${error.code || "error"})`);
        out.push(...(data || []));
        if (!data || data.length < EARNINGS_CHUNK) break;
      }
      return out;
    },

    async getPaymentSummary(orderId): Promise<PaymentSummary | null> {
      const { data, error } = await admin
        .from("customer_payments")
        .select("status, payer_medium, confirmed_at, external_id, created_at")
        .eq("target_type", "product_order")
        .eq("target_id", orderId)
        .order("created_at", { ascending: true });
      if (error) throw new Error(`customer_payments read failed (${error.code || "error"})`);
      const rows = (data || []) as { status: string; payer_medium: PaymentSummary["method"]; confirmed_at: string | null; external_id: string }[];
      if (rows.length === 0) return null;
      const chosen = rows.find((p) => p.status === "succeeded") ?? rows[rows.length - 1];
      // Only what a seller needs: status, wallet, when it was confirmed and a short reference. Never the
      // provider's transaction id, provider status, failure text or any other ledger column.
      return {
        status: chosen.status,
        method: chosen.payer_medium ?? null,
        confirmed_at: chosen.confirmed_at,
        reference: `PAY-${String(chosen.external_id).replace(/^pp-/, "").replace(/-/g, "").slice(0, 8).toUpperCase()}`,
      };
    },

    async countByStatuses({ profileId, statuses }) {
      const { count, error } = await rls.from("product_orders").select("id", { count: "exact", head: true }).eq("profile_id", profileId).in("status", statuses);
      if (error) throw new Error(`product_orders count failed (${error.code || "error"})`);
      return count ?? 0;
    },
  };
}

export function createFulfillStore(rls: Client, admin: Client, profileId: string, log?: FulfillStore["log"]): FulfillStore {
  return {
    async getOwnedOrder(orderId: string) {
      const { data, error } = await rls.from("product_orders").select("id, status").eq("id", orderId).eq("profile_id", profileId).maybeSingle();
      if (error) throw new Error(`product_orders read failed (${error.code || "error"})`);
      return data ? { id: data.id as string, status: data.status as OrderStatus } : null;
    },

    async claimFulfilled(orderId: string) {
      // Conditional claim: only while the order is still `paid`, and only on the seller's own profile.
      const { data, error } = await admin
        .from("product_orders")
        .update({ status: "fulfilled" })
        .eq("id", orderId)
        .eq("profile_id", profileId)
        .eq("status", "paid")
        .select("id");
      if (error) throw new Error(`product_orders update failed: ${error.message || error.code || "error"}`); // server-side only
      return (data?.length ?? 0) > 0;
    },

    log,
  };
}
