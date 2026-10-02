import { NextResponse } from "next/server";
import { resolveBookkeepingOwner } from "@/lib/bookkeeping/access";
import { denialResponse } from "@/lib/bookkeeping/http";
import { recordEntry } from "@/lib/bookkeeping/recordEntry";

export const dynamic = "force-dynamic";

// Record a manual entry (sale / other income / expense / cash in / cash out). Owner-only: the business is
// the caller's OWN profile; a profile id in the body is ignored. `replaces_entry_id` turns this into a
// correction (old entry voided + new one inserted atomically). `client_request_id` makes a retry safe.
// All the logic (validation, the invoice-payment replacement guard, the RPC) lives in src/lib/bookkeeping/recordEntry.ts, which the
// Ringo AI "Confirm & Apply" path shares, so there is exactly one bookkeeping implementation.
export async function POST(request: Request) {
  const access = await resolveBookkeepingOwner();
  if (!access.ok) return denialResponse(access.reason);
  const { owner } = access;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const r = await recordEntry(owner, body);
  return NextResponse.json(r.body, { status: r.status });
}
