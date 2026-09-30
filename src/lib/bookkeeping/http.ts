import { NextResponse } from "next/server";
import { DENIAL_STATUS, type BookkeepingDenial } from "./decision";

// Error codes the database RPCs raise (see 2026-12-01_bookkeeping_foundation.sql) -> HTTP status.
// Anything not listed is an unexpected failure: logged server-side, generic message to the client.
const RPC_STATUS: Record<string, number> = {
  profile_unavailable: 404, entry_not_found: 404, linked_order_not_found: 404,
  not_owner: 403, toolkit_not_enabled: 403, demo_profile_not_supported: 403,
  date_in_future: 400, reason_required: 400, invalid_amount: 400, amount_too_precise: 400,
  order_already_counted: 409, entry_already_voided: 409,
};

export function rpcErrorResponse(message: string | undefined) {
  // Backstop: two racing manual sales for one order hit the unique index instead of the RPC pre-check.
  if ((message || "").includes("bk_entries_one_live_sale_link_idx")) return NextResponse.json({ error: "order_already_counted" }, { status: 409 });
  const code = Object.keys(RPC_STATUS).find((c) => (message || "").includes(c));
  if (code) return NextResponse.json({ error: code }, { status: RPC_STATUS[code] });
  console.error("bookkeeping rpc failed:", message);
  return NextResponse.json({ error: "internal_error" }, { status: 500 });
}

export const denialResponse = (reason: BookkeepingDenial) => NextResponse.json({ error: reason }, { status: DENIAL_STATUS[reason] });
