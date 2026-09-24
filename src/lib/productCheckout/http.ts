// Shared wiring for the product checkout routes: real dependencies, and Result -> HTTP response.
// Server only. Responses carry stable error CODES, never database/provider text.

import { randomUUID } from "crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { createFapshiProvider } from "./fapshiProvider";
import { createSupabaseRateLimiter } from "./commerceRateLimiter";
import { createProviderPollGate } from "./pollGate";
import { createSupabaseStore } from "./supabaseStore";
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
    // No creator notification yet: receipts and notifications arrive with the next increment,
    // in both languages, rather than as hard-coded English here.
  };
}

// Result -> HTTP mapping lives in responses.ts; re-exported so the routes keep one import.
export { respond, internalError } from "./responses";
