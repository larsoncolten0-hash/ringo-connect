// Shared wiring for the product checkout routes: real dependencies, and Result -> HTTP response.
// Server only. Responses carry stable error CODES, never database/provider text.

import { randomUUID } from "crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { createFapshiProvider } from "./fapshiProvider";
import { createSupabaseRateLimiter } from "./commerceRateLimiter";
import { createProviderPollGate } from "./pollGate";
import { createSupabaseStore } from "./supabaseStore";
import { sendShopOrderReceiptEmail } from "@/lib/email/sendShopOrderReceiptEmail";
import { notifyShopOrderConfirmed } from "@/lib/customer/shopOrderPush";
import { notifySellerNewShopOrder } from "@/lib/shopSellerNotifications";
import type { CheckoutDeps } from "./types";

// One gate per server instance, shared by every request it serves.
const providerPollGate = createProviderPollGate();

export function buildCheckoutDeps(): CheckoutDeps {
  const admin = createAdminClient();
  return {
    store: createSupabaseStore(admin),
    provider: createFapshiProvider(),
    pollGate: providerPollGate,
    limiter: createSupabaseRateLimiter(admin),
    now: () => new Date(),
    newId: () => randomUUID(),
    log: (event, data) => console.warn(`[product-checkout] ${event}`, data ?? {}),
    // Increment 5B: the customer's receipt email and My Ringo notification. Increment (Shop
    // Phase): the seller's "New order" bell + push, using the same reused infrastructure the
    // music/booking "New order" alerts already use. settleProductPayment already calls this at
    // most once (only the caller that flips the order to paid) and already wraps it in a
    // try/catch that never blocks or reverses settlement — every sender below is independently
    // best-effort and non-throwing on top of that, so none of them can duplicate on a retried/
    // repeated payment callback (there is nothing to duplicate: this hook itself never fires
    // twice for the same order).
    onOrderPaid: async ({ order }) => {
      await Promise.allSettled([sendShopOrderReceiptEmail(order.id), notifyShopOrderConfirmed(order.id), notifySellerNewShopOrder(order.id)]);
    },
  };
}

// Result -> HTTP mapping lives in responses.ts; re-exported so the routes keep one import.
export { respond, internalError } from "./responses";
