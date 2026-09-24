// Result -> HTTP response for the product checkout routes. Responses carry stable error CODES, never
// database/provider text. Kept apart from http.ts (which wires real dependencies) so the mapping can be
// exercised without a database. Server only.

import { NextResponse } from "next/server";
import { HTTP_STATUS, type Result } from "./errors";

export function respond<T>(result: Result<T>, successStatus = 200) {
  if (result.ok) return NextResponse.json(result.data, { status: successStatus });
  return NextResponse.json({ error: result.code }, { status: HTTP_STATUS[result.code] });
}

/** Any unexpected exception becomes a generic 500 — the detail goes to the server log only. */
export function internalError(err: unknown) {
  console.error("[product-checkout] unexpected error:", (err as Error)?.message || err);
  return NextResponse.json({ error: "internal_error" }, { status: HTTP_STATUS.internal_error });
}
