// Wiring for disputeEngine.ts: real Supabase store + the unmodified Phase 2 engine + the unmodified
// Phase 6 release function + the unmodified Phase 3 refund-request function + Phase 7 notifications.
// Server only. Mirrors releaseHttp.ts/fulfillmentHttp.ts's own shape.

import { createAdminClient } from "@/lib/supabase/server";
import { transitionProtectionTransaction } from "./engine";
import { releaseProtectionTransaction } from "./release";
import { requestProtectionRefund } from "./refundEngine";
import { notifyCustomerProtectionReleased, notifySellerProtectionReleased } from "./releaseNotifications";
import { notifyProtectionDisputeOpened, notifyProtectionDisputeResolvedRefund, notifyProtectionDisputeResolvedRelease } from "./disputeNotifications";
import type { ProtectionDisputeDeps, ProtectionDisputeStore, ProtectionDisputeTransactionRow } from "./disputeEngine";
import type { ProtectionDisputeRow } from "./disputeTypes";

const UNIQUE_VIOLATION = "23505";
const INELIGIBLE_MESSAGE = /cannot open a dispute while transaction is/;

export function buildProtectionDisputeDeps(): ProtectionDisputeDeps {
  const admin = createAdminClient();

  const store: ProtectionDisputeStore = {
    async getProtectionTransaction(id: string): Promise<ProtectionDisputeTransactionRow | null> {
      const { data } = await admin.from("protection_transactions").select("id, target_id, status, customer_id, profile_id").eq("id", id).maybeSingle();
      return (data as ProtectionDisputeTransactionRow) ?? null;
    },

    async getDisputeByProtectionTransaction(id: string): Promise<ProtectionDisputeRow | null> {
      const { data } = await admin.from("protection_disputes").select("*").eq("protection_transaction_id", id).maybeSingle();
      return (data as ProtectionDisputeRow) ?? null;
    },

    async insertDispute(row) {
      const { data, error } = await admin
        .from("protection_disputes")
        .insert({
          protection_transaction_id: row.protectionTransactionId,
          order_id: row.orderId,
          customer_id: row.customerId,
          profile_id: row.profileId,
          reason: row.reason,
          message: row.message,
        })
        .select("*")
        .maybeSingle();
      if (error) {
        if (error.code === UNIQUE_VIOLATION) return { ok: false as const, code: "exists" as const };
        if (INELIGIBLE_MESSAGE.test(error.message || "")) return { ok: false as const, code: "ineligible" as const };
        throw new Error(`protection_disputes insert failed (${error.code || "error"}): ${error.message || ""}`);
      }
      return { ok: true as const, row: data as ProtectionDisputeRow };
    },

    async updateDisputeStatus(id, status, resolvedByUserId) {
      const { data, error } = await admin
        .from("protection_disputes")
        .update({ status, resolved_by: resolvedByUserId, resolved_at: new Date().toISOString() })
        .eq("id", id)
        .eq("status", "open")
        .select("id");
      if (error) throw new Error(`protection_disputes update failed (${error.code || "error"})`);
      return (data?.length ?? 0) > 0;
    },
  };

  return {
    store,
    transition: (id, to, actor) => transitionProtectionTransaction(admin, id, to, actor),
    // Reused, unmodified — never a second release or refund-request implementation.
    release: (transactionId, actor) => releaseProtectionTransaction(buildReleaseDepsForDispute(admin), transactionId, actor),
    requestRefund: (transactionId, opts) => requestProtectionRefund(admin, transactionId, opts),
    onDisputeOpened: ({ orderId }) => notifyProtectionDisputeOpened(orderId),
    onDisputeResolvedRelease: ({ orderId }) => notifyProtectionDisputeResolvedRelease(orderId),
    onDisputeResolvedRefund: ({ orderId }) => notifyProtectionDisputeResolvedRefund(orderId),
    log: (event, data) => console.warn(`[protection-dispute] ${event}`, data ?? {}),
  };
}

// releaseProtectionTransaction() needs its OWN full deps (store + transition + onReleased) — built
// here identically to releaseHttp.ts's buildProtectionReleaseDeps() rather than importing that
// function directly, only because it constructs its own admin client internally; this keeps a SINGLE
// admin client (and therefore a single DB connection/transaction context) across the whole dispute
// resolution call. The store/transition/notification wiring below is otherwise identical.
function buildReleaseDepsForDispute(admin: ReturnType<typeof createAdminClient>) {
  return {
    store: {
      async getProtectionTransaction(id: string) {
        const { data } = await admin.from("protection_transactions").select("id, target_id, status, profile_id, creator_user_id, customer_id, currency, seller_protected_amount").eq("id", id).maybeSingle();
        return data as any;
      },
      async getEarningByProtectionTransaction(id: string) {
        const { data } = await admin.from("commerce_sale_earnings").select("id").eq("protection_transaction_id", id).maybeSingle();
        return data ? { id: data.id as string } : null;
      },
      async insertProtectionEarning(row: any) {
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
      async recordReleaseLedgerEntry({ protectionTransactionId, amount, currency, idempotencyKey }: any) {
        const { error } = await admin.from("protection_ledger_entries").insert({ protection_transaction_id: protectionTransactionId, event_type: "release", amount, currency, idempotency_key: idempotencyKey });
        if (error && error.code !== UNIQUE_VIOLATION) console.error("protection_ledger_entries insert failed:", error.message || error.code);
      },
      async listAutoReleaseEligibleTransactionIds() {
        return [];
      },
    },
    transition: (id: string, to: any, actor: any) => transitionProtectionTransaction(admin, id, to, actor),
    onReleased: async ({ orderId }: { orderId: string }) => {
      await Promise.allSettled([notifyCustomerProtectionReleased(orderId), notifySellerProtectionReleased(orderId)]);
    },
    log: (event: string, data?: Record<string, unknown>) => console.warn(`[protection-dispute-release] ${event}`, data ?? {}),
  };
}
