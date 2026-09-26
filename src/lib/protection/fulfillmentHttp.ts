// Wiring for advanceProtectionOnSellerFulfillment(): real Supabase store + the unmodified Phase 2
// engine + the Phase 5 customer notifications. Server only. Mirrors checkoutHttp.ts's own shape.

import { createAdminClient } from "@/lib/supabase/server";
import { transitionProtectionTransaction } from "./engine";
import { notifyCustomerProtectionAwaitingConfirmation, notifyCustomerProtectionFulfillmentStarted } from "./fulfillmentNotifications";
import type { ProtectionFulfillmentDeps, ProtectionFulfillmentTransactionRow } from "./fulfillment";

export function buildProtectionFulfillmentDeps(): ProtectionFulfillmentDeps {
  const admin = createAdminClient();
  return {
    store: {
      async getProtectionTransactionByOrder(orderId: string): Promise<ProtectionFulfillmentTransactionRow | null> {
        const { data } = await admin.from("protection_transactions").select("id, status").eq("target_type", "product_order").eq("target_id", orderId).maybeSingle();
        return (data as ProtectionFulfillmentTransactionRow) ?? null;
      },
    },
    transition: async (id, to, actor) => {
      // Ringo Protection (Phase 6): entering awaiting_confirmation is the moment the auto-release
      // deadline is set (engine.ts already supports this — it was simply never given a value until
      // now, since nothing consumed auto_release_at before Phase 6's auto-release job existed).
      // Read fresh each time rather than cached, so an admin's current setting always applies to a
      // NEW deadline; an already-set auto_release_at on an existing transaction is never recomputed
      // (transitionProtectionTransaction only ever sets it when actually entering the status).
      let autoReleaseHours: number | undefined;
      if (to === "awaiting_confirmation") {
        const { data } = await admin.from("platform_settings").select("protection_auto_release_hours").limit(1).single();
        autoReleaseHours = typeof data?.protection_auto_release_hours === "number" ? data.protection_auto_release_hours : undefined;
      }
      return transitionProtectionTransaction(admin, id, to, actor, { autoReleaseHours });
    },
    onFulfillmentStarted: ({ orderId }) => notifyCustomerProtectionFulfillmentStarted(orderId),
    onAwaitingConfirmation: ({ orderId }) => notifyCustomerProtectionAwaitingConfirmation(orderId),
    log: (event, data) => console.warn(`[protection-fulfillment] ${event}`, data ?? {}),
  };
}
