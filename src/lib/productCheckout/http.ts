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
    // Increment 5B: the customer's receipt email and My Ringo notification. settleProductPayment
    // already calls this at most once (only the caller that flips the order to paid) and already
    // wraps it in a try/catch that never blocks or reverses settlement — both senders below are
    // independently best-effort and non-throwing on top of that.
    onOrderPaid: async ({ order }) => {
      await Promise.allSettled([sendShopOrderReceiptEmail(order.id), notifyShopOrderConfirmed(order.id)]);
    },
  };
}

// Result -> HTTP mapping lives in responses.ts; re-exported so the routes keep one import.
export { respond, internalError } from "./responses";
