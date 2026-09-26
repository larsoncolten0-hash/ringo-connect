// Supabase implementation of ProtectionCheckoutStore (service-role client; server only). Thin: every
// method is one query or one insert/update. Business rules live in the pure modules and inside the
// database's own guard triggers, not here. Mirrors productCheckout/supabaseStore.ts's own shape.

import type {
  ProtectionCheckoutStore,
  ProtectionOrderRow,
  ProtectionPaymentRow,
  ProtectionProfileRow,
  ProtectionSettingsView,
  ProtectionTransactionRow,
} from "./checkoutTypes";

type Admin = any;

const UNIQUE_VIOLATION = "23505";

export function createProtectionCheckoutStore(admin: Admin): ProtectionCheckoutStore {
  return {
    async getProtectionSettings(): Promise<ProtectionSettingsView> {
      const { data } = await admin.from("platform_settings").select("protection_enabled, protection_fee_rate, protection_auto_release_hours").limit(1).single();
      return {
        protectionEnabled: data?.protection_enabled === true,
        protectionFeeRate: data?.protection_fee_rate != null ? Number(data.protection_fee_rate) : null,
        protectionAutoReleaseHours: typeof data?.protection_auto_release_hours === "number" ? data.protection_auto_release_hours : 48,
      };
    },

    async getCommerceSettings() {
      const { data } = await admin.from("platform_settings").select("commerce_enabled, fapshi_enabled").limit(1).single();
      return { commerceEnabled: data?.commerce_enabled === true, fapshiEnabled: data?.fapshi_enabled === true };
    },

    async getOrder(orderId: string): Promise<ProtectionOrderRow | null> {
      const { data } = await admin.from("product_orders").select("id, profile_id, customer_id, currency, total, status, expires_at, paid_at").eq("id", orderId).maybeSingle();
      return (data as ProtectionOrderRow) ?? null;
    },

    async getProfile(profileId: string): Promise<ProtectionProfileRow | null> {
      const { data } = await admin.from("profiles").select("id, user_id, username, currency, published, is_demo, category, categories").eq("id", profileId).maybeSingle();
      return (data as ProtectionProfileRow) ?? null;
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

    async getProtectionTransactionByOrder(orderId: string): Promise<ProtectionTransactionRow | null> {
      const { data } = await admin
        .from("protection_transactions")
        .select("id, target_id, status, profile_id, creator_user_id, customer_id, currency, product_amount, protection_fee_rate, protection_fee_amount, customer_total, seller_protected_amount")
        .eq("target_type", "product_order")
        .eq("target_id", orderId)
        .maybeSingle();
      return (data as ProtectionTransactionRow) ?? null;
    },

    async getProtectionTransaction(id: string): Promise<ProtectionTransactionRow | null> {
      const { data } = await admin
        .from("protection_transactions")
        .select("id, target_id, status, profile_id, creator_user_id, customer_id, currency, product_amount, protection_fee_rate, protection_fee_amount, customer_total, seller_protected_amount")
        .eq("id", id)
        .maybeSingle();
      return (data as ProtectionTransactionRow) ?? null;
    },

    async insertProtectionTransaction(row) {
      const { data, error } = await admin
        .from("protection_transactions")
        .insert({
          target_type: "product_order",
          target_id: row.targetId,
          profile_id: row.profileId,
          creator_user_id: row.creatorUserId,
          customer_id: row.customerId,
          currency: row.currency,
          product_amount: row.productAmount,
          protection_fee_rate: row.protectionFeeRate,
          protection_fee_amount: row.protectionFeeAmount,
          customer_total: row.customerTotal,
          seller_protected_amount: row.productAmount,
        })
        .select("id, target_id, status, profile_id, creator_user_id, customer_id, currency, product_amount, protection_fee_rate, protection_fee_amount, customer_total, seller_protected_amount")
        .maybeSingle();
      if (error) {
        if (error.code === UNIQUE_VIOLATION) return { ok: false as const, code: "exists" as const };
        throw new Error(`protection_transactions insert failed (${error.code || "error"})`);
      }
      return { ok: true as const, row: data as ProtectionTransactionRow };
    },

    async listProtectionPayments(protectionTransactionId: string): Promise<ProtectionPaymentRow[]> {
      const { data } = await admin.from("protection_payments").select("*").eq("protection_transaction_id", protectionTransactionId).order("created_at", { ascending: false });
      return (data || []) as ProtectionPaymentRow[];
    },

    async getProtectionPayment(id: string): Promise<ProtectionPaymentRow | null> {
      const { data } = await admin.from("protection_payments").select("*").eq("id", id).maybeSingle();
      return (data as ProtectionPaymentRow) ?? null;
    },

    async insertProtectionPayment(row: ProtectionPaymentRow) {
      const { error } = await admin.from("protection_payments").insert(row);
      if (!error) return { ok: true as const };
      if (error.code === UNIQUE_VIOLATION) return { ok: false as const, reason: "duplicate_live" as const };
      throw new Error(`protection_payments insert failed (${error.code || "error"})`);
    },

    async updateProtectionPayment(id, patch, expectStatuses) {
      const { data, error } = await admin.from("protection_payments").update(patch).eq("id", id).in("status", expectStatuses).select("id");
      if (error) throw new Error(`protection_payments update failed (${error.code || "error"})`);
      return (data?.length ?? 0) > 0;
    },

    async listReconcilableProtectionTransactionIds({ sinceIso, limit }: { sinceIso: string; limit: number }): Promise<string[]> {
      const base = () => admin.from("protection_payments").select("protection_transaction_id, created_at").order("created_at", { ascending: false }).limit(limit * 4);
      const [succeeded, open, recent] = await Promise.all([
        base().eq("status", "succeeded").gte("created_at", sinceIso),
        base().in("status", ["initiated", "pending"]).not("provider_transaction_id", "is", null),
        base().in("status", ["expired", "cancelled"]).not("provider_transaction_id", "is", null).gte("created_at", sinceIso),
      ]);
      for (const r of [succeeded, open, recent]) if (r.error) throw new Error(`protection_payments reconcile query failed (${r.error.code || "error"})`);
      const groups: string[][] = [succeeded, open, recent].map((r) => [...new Set(((r.data || []) as { protection_transaction_id: string }[]).map((p) => p.protection_transaction_id))]);
      const all = [...new Set(groups.flat())];
      if (all.length === 0) return [];
      const { data: txns, error } = await admin.from("protection_transactions").select("id").in("id", all).eq("status", "awaiting_payment");
      if (error) throw new Error(`protection_transactions reconcile query failed (${error.code || "error"})`);
      const live = new Set(((txns || []) as { id: string }[]).map((t) => t.id));
      return groups.flat().filter((id, i, a) => live.has(id) && a.indexOf(id) === i).slice(0, limit);
    },
  };
}
