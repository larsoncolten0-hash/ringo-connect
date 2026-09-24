// Shared wiring for the product checkout routes: real dependencies, and Result -> HTTP response.
// Server only. Responses carry stable error CODES, never database/provider text.

import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { HTTP_STATUS, type Result } from "./errors";
import { createFapshiProvider } from "./fapshiProvider";
import { createSupabaseStore } from "./supabaseStore";
import type { CheckoutDeps } from "./types";

export function buildCheckoutDeps(): CheckoutDeps {
  return {
    store: createSupabaseStore(createAdminClient()),
    provider: createFapshiProvider(),
    now: () => new Date(),
    newId: () => randomUUID(),
    log: (event, data) => console.warn(`[product-checkout] ${event}`, data ?? {}),
    // No creator notification yet: receipts and notifications arrive with the next increment,
    // in both languages, rather than as hard-coded English here.
  };
}

export function respond<T>(result: Result<T>, successStatus = 200) {
  if (result.ok) return NextResponse.json(result.data, { status: successStatus });
  return NextResponse.json({ error: result.code }, { status: HTTP_STATUS[result.code] });
}

/** Any unexpected exception becomes a generic 500 — the detail goes to the server log only. */
export function internalError(err: unknown) {
  console.error("[product-checkout] unexpected error:", (err as Error)?.message || err);
  return NextResponse.json({ error: "internal_error" }, { status: HTTP_STATUS.internal_error });
}
