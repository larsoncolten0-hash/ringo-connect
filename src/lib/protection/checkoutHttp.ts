// Shared wiring for the Ringo Protection checkout routes: real dependencies, and Result -> HTTP
// response. Server only. Mirrors productCheckout/http.ts's own shape. The only things imported from
// outside this module are: the ALREADY-BUILT Phase 2 engine (transitionProtectionTransaction,
// unmodified), the generic Fapshi client (fapshi.ts, unmodified, via its own adapter file here), and
// createProviderPollGate (a pure, stateless-per-call utility productCheckout already uses — reusing
// its implementation creates no shared mutable state with Normal Payment's own gate instance).

import { randomUUID } from "crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { createProviderPollGate } from "@/lib/productCheckout/pollGate";
import { transitionProtectionTransaction } from "./engine";
import { createProtectionFapshiProvider } from "./checkoutFapshiProvider";
import { createProtectionRateLimiter } from "./checkoutRateLimit";
import { createProtectionCheckoutStore } from "./checkoutStore";
import { PROVIDER_STATUS_MIN_GAP_MS } from "./checkoutConstants";
import { notifySellerNewShopOrder } from "@/lib/shopSellerNotifications";
import { sendShopOrderReceiptEmail } from "@/lib/email/sendShopOrderReceiptEmail";
import { notifyShopOrderConfirmed } from "@/lib/customer/shopOrderPush";
import type { ProtectionCheckoutDeps } from "./checkoutTypes";

// One gate per server instance, shared by every Protection request it serves — a separate instance
// from productCheckout's own gate (no shared state, just the same implementation).
const providerPollGate = createProviderPollGate(PROVIDER_STATUS_MIN_GAP_MS);

export function buildProtectionCheckoutDeps(): ProtectionCheckoutDeps {
  const admin = createAdminClient();
  return {
    store: createProtectionCheckoutStore(admin),
    provider: createProtectionFapshiProvider(),
    pollGate: providerPollGate,
    limiter: createProtectionRateLimiter(admin),
    now: () => new Date(),
    newId: () => randomUUID(),
    log: (event, data) => console.warn(`[protection-checkout] ${event}`, data ?? {}),
    transition: (id, to, actor, opts) => transitionProtectionTransaction(admin, id, to, actor, opts),
    // The same, already-reused-elsewhere notification functions Shop Phase wired into Normal
    // Payment's onOrderPaid — they read only from the order id and have no dependency on
    // customer_payments or commerce_sale_earnings, so they are safe to reuse unmodified here too.
    onProtected: async ({ orderId }) => {
      await Promise.allSettled([sendShopOrderReceiptEmail(orderId), notifyShopOrderConfirmed(orderId), notifySellerNewShopOrder(orderId)]);
    },
  };
}

export { respond, internalError } from "./checkoutResponses";
