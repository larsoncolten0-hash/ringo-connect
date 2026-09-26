// Result -> HTTP response for the Ringo Protection checkout routes. Mirrors
// productCheckout/responses.ts exactly. Server only.

import { NextResponse } from "next/server";
import { PROTECTION_HTTP_STATUS, type Result } from "./checkoutErrors";

export function respond<T>(result: Result<T>, successStatus = 200) {
  if (result.ok) return NextResponse.json(result.data, { status: successStatus });
  return NextResponse.json({ error: result.code }, { status: PROTECTION_HTTP_STATUS[result.code] });
}

/** Any unexpected exception becomes a generic 500 — the detail goes to the server log only. */
export function internalError(err: unknown) {
  console.error("[protection-checkout] unexpected error:", (err as Error)?.message || err);
  return NextResponse.json({ error: "internal_error" }, { status: PROTECTION_HTTP_STATUS.internal_error });
}
