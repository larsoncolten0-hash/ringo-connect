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
    transition: (id, to, actor) => transitionProtectionTransaction(admin, id, to, actor),
    onFulfillmentStarted: ({ orderId }) => notifyCustomerProtectionFulfillmentStarted(orderId),
    onAwaitingConfirmation: ({ orderId }) => notifyCustomerProtectionAwaitingConfirmation(orderId),
    log: (event, data) => console.warn(`[protection-fulfillment] ${event}`, data ?? {}),
  };
}
