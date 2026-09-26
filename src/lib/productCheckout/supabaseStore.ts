// Supabase implementation of CheckoutStore (service-role client; server only). Thin: every method is
// one query or one RPC. The business rules live in the pure modules and inside the database
// functions, not here. Database error text is never surfaced — it is mapped to stable codes.

import { codeFromDbMessage } from "./errors";
import type {
  CheckoutStore,
  CommerceSettings,
  CreateOrderArgs,
  EarningRow,
  OrderItemRow,
  OrderRow,
  PaymentRow,
  ProductRow,
  ProfileRow,
} from "./types";

type Admin = any; // ReturnType<typeof createAdminClient> — kept loose so tests/tools need no Supabase import

const UNIQUE_VIOLATION = "23505";

export function createSupabaseStore(admin: Admin): CheckoutStore {
  return {
    async getSettings(): Promise<CommerceSettings> {
      const { data } = await admin
        .from("platform_settings")
        .select("commerce_enabled, commerce_commission_rate, fapshi_enabled")
        .limit(1)
        .single();
      return {
        commerceEnabled: data?.commerce_enabled === true,
        commissionRate: data?.commerce_commission_rate != null ? Number(data.commerce_commission_rate) : null,
        fapshiEnabled: data?.fapshi_enabled === true,
      };
    },

    async getProduct(id: string): Promise<ProductRow | null> {
      const { data } = await admin
        .from("products")
        .select("id, profile_id, name, price, available, inventory_count, product_type, digital_file_path")
        .eq("id", id)
        .maybeSingle();
      return (data as ProductRow) ?? null;
    },

    async getProfile(id: string): Promise<ProfileRow | null> {
      const { data } = await admin
        .from("profiles")
        .select("id, user_id, username, currency, published, is_demo, category, categories")
        .eq("id", id)
        .maybeSingle();
      return (data as ProfileRow) ?? null;
    },

    async createOrder(args: CreateOrderArgs) {
      const { data, error } = await admin.rpc("create_product_order", {
        p_profile_id: args.profileId,
        p_product_id: args.productId,
        p_quantity: args.quantity,
        p_customer_id: args.customerId,
        p_customer_name: args.name,
        p_customer_phone: args.phone,
        p_customer_email: args.email,
        p_customer_note: args.note,
        p_reservation_minutes: args.reservationMinutes,
      });
      if (error || !data?.order || !data?.item) {
        return { ok: false as const, code: codeFromDbMessage(error?.message) };
      }
      return { ok: true as const, order: data.order as OrderRow, item: data.item as OrderItemRow };
    },

    async getOrder(id: string) {
      const { data } = await admin.from("product_orders").select("*, product_order_items(*)").eq("id", id).maybeSingle();
      if (!data) return null;
      const { product_order_items, ...order } = data as any;
      return { order: order as OrderRow, items: (product_order_items || []) as OrderItemRow[] };
    },

    async updateOrder(id, patch, expectStatus) {
      const { data, error } = await admin.from("product_orders").update(patch).eq("id", id).eq("status", expectStatus).select("id");
      if (error) throw new Error(`product_orders update failed (${error.code || "error"})`);
      return (data?.length ?? 0) > 0;
    },

    async releaseOrder(id, status) {
      const { data, error } = await admin.rpc("release_product_order_stock", { p_order_id: id, p_new_status: status });
      if (error) throw new Error(`release_product_order_stock failed (${error.code || "error"})`);
      return data === true;
    },

    async listPayments(orderId: string): Promise<PaymentRow[]> {
      const { data } = await admin
        .from("customer_payments")
        .select("*")
        .eq("target_type", "product_order")
        .eq("target_id", orderId)
        .order("created_at", { ascending: false });
      return (data || []) as PaymentRow[];
    },

    async getPayment(id: string): Promise<PaymentRow | null> {
      const { data } = await admin.from("customer_payments").select("*").eq("id", id).maybeSingle();
      return (data as PaymentRow) ?? null;
    },

    async insertPayment(row: PaymentRow) {
      const { error } = await admin.from("customer_payments").insert(row);
      if (!error) return { ok: true as const };
      if (error.code === UNIQUE_VIOLATION) return { ok: false as const, reason: "duplicate_live" as const };
      throw new Error(`customer_payments insert failed (${error.code || "error"})`);
    },

    async updatePayment(id, patch, expectStatuses) {
      const { data, error } = await admin.from("customer_payments").update(patch).eq("id", id).in("status", expectStatuses).select("id");
      if (error) throw new Error(`customer_payments update failed (${error.code || "error"})`);
      return (data?.length ?? 0) > 0;
    },

    async getEarningByOrder(orderId: string): Promise<EarningRow | null> {
      const { data } = await admin.from("commerce_sale_earnings").select("*").eq("order_id", orderId).maybeSingle();
      return (data as EarningRow) ?? null;
    },

    async listReconcilableOrderIds({ sinceIso, limit }: { sinceIso: string; limit: number }): Promise<string[]> {
      const base = () => admin.from("customer_payments").select("target_id, created_at").eq("target_type", "product_order").order("created_at", { ascending: false }).limit(limit * 4);
      const [succeeded, open, recent] = await Promise.all([
        base().eq("status", "succeeded").gte("created_at", sinceIso),
        base().in("status", ["initiated", "pending"]).not("provider_transaction_id", "is", null),
        base().in("status", ["expired", "cancelled"]).not("provider_transaction_id", "is", null).gte("created_at", sinceIso),
      ]);
      for (const r of [succeeded, open, recent]) if (r.error) throw new Error(`customer_payments reconcile query failed (${r.error.code || "error"})`);
      const groups: string[][] = [succeeded, open, recent].map((r) => [...new Set(((r.data || []) as { target_id: string }[]).map((p) => p.target_id))]);
      const all = [...new Set(groups.flat())];
      if (all.length === 0) return [];
      // Only orders that can still change: a paid/fulfilled/refunded/payment_review order needs no provider call.
      const { data: orders, error } = await admin.from("product_orders").select("id").in("id", all).in("status", ["awaiting_payment", "expired", "cancelled"]);
      if (error) throw new Error(`product_orders reconcile query failed (${error.code || "error"})`);
      const live = new Set(((orders || []) as { id: string }[]).map((o) => o.id));
      return groups.flat().filter((id, i, a) => live.has(id) && a.indexOf(id) === i).slice(0, limit);
    },

    async setOrderLanguage(orderId: string, lang: "en" | "fr") {
      // Nullable additive column (customer_language). Any error - including "column does not exist" before the
      // migration is applied - is swallowed: the language is a convenience, never a reason to fail an order.
      try {
        const { error } = await admin.from("product_orders").update({ customer_language: lang }).eq("id", orderId);
        return !error;
      } catch {
        return false;
      }
    },

    async insertEarning(row: EarningRow) {
      const { error } = await admin.from("commerce_sale_earnings").insert(row);
      if (!error) return "inserted" as const;
      if (error.code === UNIQUE_VIOLATION) return "exists" as const; // one per order and per payment — the DB is the final guard
      throw new Error(`commerce_sale_earnings insert failed (${error.code || "error"})`);
    },
  };
}
