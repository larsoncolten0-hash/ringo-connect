// Business Toolkit Phase 7C (bookkeeping entry corrections): the API as a plain function; the route src/app/api/reports/entries/[id]/correct/route.ts is a thin
// wrapper that resolves the owner (the same owner-only gate as Phases 1-6). A correction is NOT a new accounting mechanism: it calls the EXISTING
// bk_record_entry RPC with `replaces_entry_id`, which in one transaction voids the original (void reason "Replaced by a correction", never deleted),
// inserts the replacement linked by replaces_entry_id, and writes the 'created' and 'replaced' audit events. This module only decides WHAT may be sent:
//
//   * the original is loaded server-side, scoped to the caller's own profile (another business's entry is "not found");
//   * the accounting KIND and the ORDER LINK are always taken from the original, never from the client (a differing value is refused);
//   * the currency is the business's own (an original in another currency is refused rather than silently converted);
//   * a voided entry, and any entry that belongs to an invoice payment (or carries the reserved invoice_payment category), is refused: those are corrected
//     through the invoice / payment workflow (doc_void_payment), never through this generic path;
//   * the request id makes a double submit or a retry replay the same result instead of correcting twice.
import { currencyMinorDigits, minorToAmountString, parseMinor } from "@/lib/bookkeeping/money";
import { entryIsInvoicePayment } from "@/lib/bookkeeping/invoicePaymentGuard";
import { entryIsSaleReceipt } from "@/lib/bookkeeping/saleReceiptGuard";
import { rpcErrorResponse } from "@/lib/bookkeeping/http";
import { DEFAULT_TIME_ZONE, toLocalDateKey, validateEntryInput } from "@/lib/bookkeeping/summary";
import type { ApiResult, DocOwner } from "@/lib/documents/handlers";
import { isUuid } from "@/lib/documents/validation";

export const RESERVED_CATEGORY = "invoice_payment";
const ENTRY_COLUMNS = "id, kind, amount, currency, entry_date, category, description, cash_settled, linked_order_type, linked_order_id, replaces_entry_id, voided_at, created_at";

const bad = (details: string[]): ApiResult => ({ status: 400, body: { error: "validation_failed", details } });
const conflict = (error: string): ApiResult => ({ status: 409, body: { error } });
const notFound = (): ApiResult => ({ status: 404, body: { error: "entry_not_found" } });
const internal = (): ApiResult => ({ status: 500, body: { error: "internal_error" } });

const norm = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const has = (o: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(o, k);

export async function correctEntry(owner: DocOwner, id: string, rawBody: unknown, opts: { now?: Date } = {}): Promise<ApiResult> {
  if (!isUuid(id)) return notFound();
  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) return { status: 400, body: { error: "invalid_body" } };
  const body = rawBody as Record<string, unknown>;
  if (!isUuid(body.client_request_id)) return bad(["invalid_client_request_id"]);
  const requestId = body.client_request_id as string;
  const profileId = owner.profile.id;

  // ---- the original, read server-side and only within the caller's own business
  const { data: original, error: loadError } = await owner.supabase.from("bk_entries").select(ENTRY_COLUMNS).eq("profile_id", profileId).eq("id", id).maybeSingle();
  if (loadError) { console.error("correction load failed:", String(loadError.message || "").slice(0, 200)); return internal(); }
  if (!original) return notFound();

  // ---- idempotency: this request id may already have produced THIS correction (replay) or belong to something else (conflict)
  const { data: seen, error: seenError } = await owner.supabase.from("bk_entries").select(ENTRY_COLUMNS).eq("profile_id", profileId).eq("client_request_id", requestId).maybeSingle();
  if (seenError) return internal();
  if (seen) return seen.replaces_entry_id === id ? { status: 200, body: { entry: seen, duplicate: true, replaced_entry_id: id } } : conflict("client_request_id_in_use");

  if (original.voided_at) return conflict("entry_already_voided");

  // ---- invoice-payment entries are never corrected here (checked in the database, and by the reserved category as a second line)
  const link = await entryIsInvoicePayment(owner.admin, id);
  if (link === "yes" || original.category === RESERVED_CATEGORY) return conflict("entry_linked_to_invoice_payment");
  if (link === "unknown") return internal();
  const saleLink = await entryIsSaleReceipt(owner.admin, id);
  if (saleLink === "yes") return conflict("entry_linked_to_sale");
  if (saleLink === "unknown") return internal();

  // ---- what the client may NOT change: kind, order link, replaced entry. A repeat of the original value is harmless; any other value is refused.
  if (has(body, "kind") && body.kind !== original.kind) return bad(["kind_cannot_change"]);
  const linkType = original.linked_order_type ?? null, linkId = original.linked_order_id ?? null;
  if ((has(body, "linked_order_type") && (body.linked_order_type ?? null) !== linkType) || (has(body, "linked_order_id") && (body.linked_order_id ?? null) !== linkId)) return bad(["order_link_cannot_change"]);
  if (has(body, "replaces_entry_id") && body.replaces_entry_id !== id) return bad(["invalid_replaces_entry_id"]);

  const currency = (owner.profile.currency || "XAF").toUpperCase();
  if (String(original.currency).toUpperCase() !== currency) return conflict("entry_currency_mismatch");
  const digits = currencyMinorDigits(currency);

  // ---- the editable fields; an omitted one keeps the original value, null clears a category or description
  const next = {
    kind: original.kind as string,
    amount: has(body, "amount") ? body.amount : original.amount,
    entry_date: has(body, "entry_date") ? body.entry_date : original.entry_date,
    category: has(body, "category") ? body.category : original.category,
    description: has(body, "description") ? body.description : original.description,
    cash_settled: has(body, "cash_settled") ? body.cash_settled : original.cash_settled,
    linked_order_type: linkType,
    linked_order_id: linkId,
  };
  if (typeof next.category === "string" && next.category.trim().toLowerCase() === RESERVED_CATEGORY) return bad(["category_reserved"]);
  const today = toLocalDateKey(opts.now ?? new Date(), DEFAULT_TIME_ZONE);
  const v = validateEntryInput(next as any, { currency, today });
  if (!v.ok) return bad(v.errors);

  const oldMinor = parseMinor(typeof original.amount === "number" ? String(original.amount) : original.amount, digits);
  const unchanged = oldMinor === v.minor && next.entry_date === original.entry_date && norm(next.category) === norm(original.category)
    && norm(next.description) === norm(original.description) && (next.cash_settled ?? true) === (original.cash_settled === true);
  if (unchanged) return bad(["no_changes"]);

  // ---- the existing atomic RPC: void the original + insert the replacement + audit events, idempotent on the request id
  const { data, error } = await owner.admin.rpc("bk_record_entry", {
    p_profile_id: profileId,
    p_actor_user_id: owner.userId,
    p_kind: original.kind,
    p_amount: minorToAmountString(v.minor, digits),
    p_entry_date: next.entry_date,
    p_category: next.category ?? null,
    p_description: next.description ?? null,
    p_cash_settled: next.cash_settled ?? true,
    p_linked_order_type: linkType,
    p_linked_order_id: linkId,
    p_replaces_entry_id: id,
    p_client_request_id: requestId,
  });
  if (error) {
    const r = rpcErrorResponse(error.message);
    return { status: r.status, body: await r.json() };
  }
  return { status: (data as any)?.duplicate ? 200 : 201, body: { ...(data as object), replaced_entry_id: id } };
}
