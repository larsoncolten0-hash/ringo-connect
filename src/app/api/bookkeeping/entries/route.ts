import { NextResponse } from "next/server";
import { resolveBookkeepingOwner } from "@/lib/bookkeeping/access";
import { denialResponse, rpcErrorResponse } from "@/lib/bookkeeping/http";
import { entryIsInvoicePayment } from "@/lib/bookkeeping/invoicePaymentGuard";
import { currencyMinorDigits, minorToAmountString } from "@/lib/bookkeeping/money";
import { DEFAULT_TIME_ZONE, toLocalDateKey, validateEntryInput } from "@/lib/bookkeeping/summary";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Record a manual entry (sale / other income / expense / cash in / cash out). Owner-only: the business is
// the caller's OWN profile; a profile id in the body is ignored. `replaces_entry_id` turns this into a
// correction (old entry voided + new one inserted atomically). `client_request_id` makes a retry safe.
export async function POST(request: Request) {
  const access = await resolveBookkeepingOwner();
  if (!access.ok) return denialResponse(access.reason);
  const { owner } = access;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const currency = (owner.profile.currency || "XAF").toUpperCase();
  const today = toLocalDateKey(new Date(), DEFAULT_TIME_ZONE);
  const entryDate = body.entry_date ?? today;
  const v = validateEntryInput({ ...body, entry_date: entryDate }, { currency, today });
  if (!v.ok) return NextResponse.json({ error: "validation_failed", details: v.errors }, { status: 400 });

  for (const k of ["replaces_entry_id", "client_request_id"] as const) {
    if (body[k] != null && !(typeof body[k] === "string" && UUID.test(body[k]))) return NextResponse.json({ error: "validation_failed", details: [`invalid_${k}`] }, { status: 400 });
  }

  // Phase 2 invariant (same rule as the void route): an entry created by a seller-recorded invoice payment is never replaced through this generic
  // correction path; that would void the entry while the payment stays recorded. Unknown => refuse (fail closed).
  if (body.replaces_entry_id) {
    const linked = await entryIsInvoicePayment(owner.admin, body.replaces_entry_id);
    if (linked === "yes") return NextResponse.json({ error: "entry_linked_to_invoice_payment" }, { status: 409 });
    if (linked === "unknown") return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  const { data, error } = await owner.admin.rpc("bk_record_entry", {
    p_profile_id: owner.profile.id,
    p_actor_user_id: owner.userId,
    p_kind: body.kind,
    p_amount: minorToAmountString(v.minor, currencyMinorDigits(currency)),
    p_entry_date: entryDate,
    p_category: body.category ?? null,
    p_description: body.description ?? null,
    p_cash_settled: body.cash_settled ?? true,
    p_linked_order_type: body.linked_order_type ?? null,
    p_linked_order_id: body.linked_order_id ?? null,
    p_replaces_entry_id: body.replaces_entry_id ?? null,
    p_client_request_id: body.client_request_id ?? null,
  });
  if (error) return rpcErrorResponse(error.message);
  return NextResponse.json(data, { status: (data as any)?.duplicate ? 200 : 201 });
}
