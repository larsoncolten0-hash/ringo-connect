// Error mapping for the Phase 2 document API. The database functions raise short machine codes (see
// supabase/migrations/2026-12-02_documents_invoices_receipts.sql); this turns them into HTTP statuses. Anything unrecognised is
// logged server-side and returned as a generic 500 (no internal detail reaches the client).

const STATUS: Record<string, number> = {
  // not found
  profile_unavailable: 404, document_not_found: 404, payment_not_found: 404, share_not_found: 404, product_not_found: 404,
  customer_not_found: 404,
  // not allowed
  not_owner: 403, toolkit_not_enabled: 403, demo_profile_not_supported: 403,
  // invalid input
  unsupported_document_type: 400, invalid_locale: 400, invalid_lines: 400, invalid_line: 400, too_many_lines: 400, invalid_notes: 400,
  invalid_terms: 400, invalid_customer: 400, invalid_description: 400, invalid_quantity: 400, invalid_unit_price: 400, invalid_discount: 400,
  invalid_product: 400, invalid_tax_rate: 400, invalid_due_days: 400, invalid_display_name: 400, tax_incomplete: 400, amount_too_precise: 400,
  amount_too_large: 400, discount_exceeds_amount: 400, no_lines: 400, zero_total: 400, customer_required: 400, invalid_due_date: 400,
  request_id_required: 400, invalid_amount: 400, invalid_method: 400, invalid_reference: 400, invalid_paid_on: 400, reason_required: 400,
  invalid_replacement: 400, invalid_token_hash: 400, invalid_expiry: 400, date_in_future: 400,
  invalid_sold_on: 400, invalid_payment_details: 400,
  // state conflicts
  document_not_draft: 409, document_void: 409, invoice_not_payable: 409, invoice_has_payments: 409, use_void_payment: 409, currency_changed: 409,
  insufficient_stock: 409, request_id_conflict: 409,
  exceeds_balance: 409, tax_not_configured: 409, document_not_shareable: 409, too_many_shares: 409, order_already_counted: 409,
  // should never happen (guards against our own bugs): reported as server errors
  totals_mismatch: 500, bookkeeping_conflict: 500, sale_conflict: 500,
};

const UNAVAILABLE_CODES = new Set(["PGRST202", "PGRST205", "42883", "42P01"]);

export type ApiError = { status: number; body: { error: string; details?: string[] } };

/** Maps a PostgREST/Postgres error object to an API error. */
export function docError(error: { code?: string; message?: string } | null | undefined): ApiError {
  const message = String(error?.message || "");
  const code = String(error?.code || "");
  // Phase 2 not applied yet (function/table missing): a clear, retryable "not available", not a crash
  if (UNAVAILABLE_CODES.has(code) || /could not find the (function|table)|does not exist/i.test(message)) {
    return { status: 503, body: { error: "documents_unavailable" } };
  }
  const known = Object.keys(STATUS).find((c) => new RegExp(`(^|[^a-z_])${c}($|[^a-z_])`).test(message));
  if (known) return { status: STATUS[known], body: { error: known } };
  if (message.includes("bk_documents_one_replacement_idx")) return { status: 409, body: { error: "replacement_exists" } };
  console.error("documents rpc failed:", code, message.slice(0, 200));
  return { status: 500, body: { error: "internal_error" } };
}

export const KNOWN_DOCUMENT_ERRORS = Object.keys(STATUS);
