// Church giving, the money part: real dependencies and the HTTP mapping for the public gift routes. SERVER ONLY.
// Reuses, without changing them, the Shop's Fapshi adapter, the status poll gate and the abuse limiter (the limiter's phone and IP buckets are shared on purpose: one stranger's phone cannot be flooded
// with prompts by switching between the Shop and a church). Church tables only; no Shop table is read or written from here.

import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { createFapshiProvider } from "@/lib/productCheckout/fapshiProvider";
import { createSupabaseRateLimiter } from "@/lib/productCheckout/commerceRateLimiter";
import { createProviderPollGate } from "@/lib/productCheckout/pollGate";
import { createToken, type GiftDeps, type Result } from "./flow";
import { sendChurchGiftReceiptEmail } from "./receiptEmail";
import { createSupabaseGiftStore } from "./store";
import { GIFT_HTTP_STATUS } from "./rules";

// One gate per server instance, shared by every request it serves (Fapshi limits status requests per transaction).
const pollGate = createProviderPollGate();

export function buildGiftDeps(): GiftDeps {
  const admin = createAdminClient();
  return {
    store: createSupabaseGiftStore(admin),
    provider: createFapshiProvider(),
    pollGate,
    limiter: createSupabaseRateLimiter(admin),
    now: () => new Date(),
    newId: () => randomUUID(),
    newToken: createToken,
    log: (event, data) => console.warn(`[church-gifts] ${event}`, data ?? {}),
    // The receipt email: once (the store claims it for the first caller only), best effort, never blocks settlement.
    onGiftPaid: async (gift, church) => {
      await sendChurchGiftReceiptEmail(gift, church);
    },
  };
}

export const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Result -> HTTP. Only stable codes leave the server, never database or provider text. */
export function respond<T>(result: Result<T>, okStatus = 200): NextResponse {
  return result.ok ? json({ ok: true, ...(result.data as object) }, okStatus) : json({ ok: false, error: result.code }, GIFT_HTTP_STATUS[result.code] ?? 500);
}

export function internalError(err: unknown): NextResponse {
  console.error(JSON.stringify({ scope: "church_gifts", result: "handler_error", name: (err as Error)?.name || "Error" })); // never the message: it can quote a person's data
  return json({ ok: false, error: "server_error" }, 500);
}
