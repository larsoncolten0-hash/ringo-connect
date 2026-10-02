// Business Toolkit: the ONE implementation of "record (or replace) a bookkeeping entry", shared by
//   * POST /api/bookkeeping/entries (the Bookkeeping entries screen and any API caller), and
//   * the Ringo AI draft application ("Confirm & Apply" for a prepared entry).
// Both end in the same protected RPC (bk_record_entry); there is no second bookkeeping implementation. The behaviour is exactly what the route did before
// this module existed: the same validation, the same date rule (Africa/Douala "today"), the same invoice-payment replacement guard, the same status codes
// and bodies. The business is ALWAYS the owner's own profile (owner comes from the server-resolved session); a profile id in `body` is never read.
import { NextResponse } from "next/server";
import { rpcErrorResponse } from "./http";
import { entryIsInvoicePayment } from "./invoicePaymentGuard";
import { entryIsSaleReceipt } from "./saleReceiptGuard";
import { currencyMinorDigits, minorToAmountString } from "./money";
import { DEFAULT_TIME_ZONE, toLocalDateKey, validateEntryInput } from "./summary";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RecordEntryOwner = { userId: string; profile: { id: string; currency: string | null }; admin: any };
export type RecordEntryResult = { status: number; body: any };

const fail = (status: number, body: unknown): RecordEntryResult => ({ status, body });

export async function recordEntry(owner: RecordEntryOwner, body: Record<string, any>, opts: { now?: Date } = {}): Promise<RecordEntryResult> {
  const currency = (owner.profile.currency || "XAF").toUpperCase();
  const today = toLocalDateKey(opts.now ?? new Date(), DEFAULT_TIME_ZONE);
  const entryDate = body.entry_date ?? today;
  const v = validateEntryInput({ ...body, entry_date: entryDate } as any, { currency, today });
  if (!v.ok) return fail(400, { error: "validation_failed", details: v.errors });

  for (const k of ["replaces_entry_id", "client_request_id"] as const) {
    if (body[k] != null && !(typeof body[k] === "string" && UUID.test(body[k]))) return fail(400, { error: "validation_failed", details: [`invalid_${k}`] });
  }

  // Phase 2 invariant (same rule as the void route): an entry created by a seller-recorded invoice payment is never replaced through this generic
  // correction path; that would void the entry while the payment stays recorded. Unknown => refuse (fail closed).
  if (body.replaces_entry_id) {
    const linked = await entryIsInvoicePayment(owner.admin, body.replaces_entry_id);
    if (linked === "yes") return fail(409, { error: "entry_linked_to_invoice_payment" });
    if (linked === "unknown") return fail(500, { error: "internal_error" });
    // Record Sale invariant: the bookkeeping sale of a sale receipt is never replaced on its own
    const saleLink = await entryIsSaleReceipt(owner.admin, body.replaces_entry_id);
    if (saleLink === "yes") return fail(409, { error: "entry_linked_to_sale" });
    if (saleLink === "unknown") return fail(500, { error: "internal_error" });
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
  if (error) {
    const r: NextResponse = rpcErrorResponse(error.message);
    return fail(r.status, await r.json());
  }
  return { status: (data as any)?.duplicate ? 200 : 201, body: data };
}
