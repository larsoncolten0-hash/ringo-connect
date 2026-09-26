// Wiring for releaseProtectionTransaction()/autoReleaseEligibleProtectionTransactions(): real
// Supabase store + the unmodified Phase 2 engine + the Phase 6 notifications. Server only. Mirrors
// checkoutHttp.ts/fulfillmentHttp.ts's own shape.

import { createAdminClient } from "@/lib/supabase/server";
import { transitionProtectionTransaction } from "./engine";
import { notifyCustomerProtectionReleased, notifySellerProtectionReleased } from "./releaseNotifications";
import type { ProtectionReleaseDeps, ProtectionReleaseStore, ProtectionReleaseTransactionRow } from "./release";

const UNIQUE_VIOLATION = "23505";

export function buildProtectionReleaseDeps(): ProtectionReleaseDeps {
  const admin = createAdminClient();

  const store: ProtectionReleaseStore = {
    async getProtectionTransaction(id: string): Promise<ProtectionReleaseTransactionRow | null> {
      const { data } = await admin
        .from("protection_transactions")
        .select("id, target_id, status, profile_id, creator_user_id, customer_id, currency, seller_protected_amount")
        .eq("id", id)
        .maybeSingle();
      return (data as ProtectionReleaseTransactionRow) ?? null;
    },

    async getEarningByProtectionTransaction(id: string) {
      const { data } = await admin.from("commerce_sale_earnings").select("id").eq("protection_transaction_id", id).maybeSingle();
      return data ? { id: data.id as string } : null;
    },

    async insertProtectionEarning(row) {
      const { error } = await admin.from("commerce_sale_earnings").insert({
        order_id: row.orderId,
        protection_transaction_id: row.protectionTransactionId,
        payment_id: null,
        profile_id: row.profileId,
        creator_user_id: row.creatorUserId,
        gross_amount: row.grossAmount,
        commission_rate: 0,
        platform_fee: 0,
        net_amount: row.grossAmount,
        currency: row.currency,
      });
      if (!error) return { ok: true as const };
      if (error.code === UNIQUE_VIOLATION) return { ok: false as const, reason: "exists" as const };
      throw new Error(`commerce_sale_earnings insert failed (${error.code || "error"})`);
    },

    async recordReleaseLedgerEntry({ protectionTransactionId, amount, currency, idempotencyKey }) {
      const { error } = await admin.from("protection_ledger_entries").insert({
        protection_transaction_id: protectionTransactionId,
        event_type: "release",
        amount,
        currency,
        idempotency_key: idempotencyKey,
      });
      if (error && error.code !== UNIQUE_VIOLATION) {
        console.error("protection_ledger_entries insert failed:", error.message || error.code);
      }
    },

    async listAutoReleaseEligibleTransactionIds({ nowIso, limit }) {
      const { data, error } = await admin
        .from("protection_transactions")
        .select("id")
        .eq("status", "awaiting_confirmation")
        .not("auto_release_at", "is", null)
        .lte("auto_release_at", nowIso)
        .order("auto_release_at", { ascending: true })
        .limit(limit);
      if (error) throw new Error(`protection_transactions auto-release query failed (${error.code || "error"})`);
      return ((data || []) as { id: string }[]).map((r) => r.id);
    },
  };

  return {
    store,
    // Same unmodified Phase 2 engine every other Protection phase uses.
    transition: (id, to, actor) => transitionProtectionTransaction(admin, id, to, actor),
    onReleased: async ({ orderId }) => {
      await Promise.allSettled([notifyCustomerProtectionReleased(orderId), notifySellerProtectionReleased(orderId)]);
    },
    log: (event, data) => console.warn(`[protection-release] ${event}`, data ?? {}),
  };
}
