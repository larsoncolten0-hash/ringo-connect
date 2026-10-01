// Maps an API error code to the key of a translated message in t.documents.ui.errors. Unknown codes fall back to "generic":
// a raw machine code is never shown to a person, and nothing technical leaks into the screen.
const MAP: Record<string, string> = {
  documents_unavailable: "unavailable",
  not_owner: "notAllowed", toolkit_not_enabled: "notAllowed", demo_profile_not_supported: "notAllowed", not_signed_in: "notAllowed",
  no_profile: "notAllowed", plan_not_enabled: "notAllowed", category_not_enabled: "notAllowed", demo_profile: "notAllowed",
  document_not_found: "notFound", payment_not_found: "notFound",
  validation_failed: "validation",
  invalid_amount: "invalidAmount", amount_too_precise: "tooPrecise", invalid_paid_on: "invalidDate",
  exceeds_balance: "exceedsBalance", invoice_not_payable: "notPayable", currency_changed: "currencyChanged",
  no_lines: "noLines", customer_required: "customerRequired", zero_total: "zeroTotal", invalid_due_date: "invalidDueDate",
  tax_not_configured: "taxNotConfigured", invoice_has_payments: "hasPayments", reason_required: "reasonRequired",
  document_not_draft: "notDraft", document_void: "notDraft",
  integrity_check_failed: "integrity",
  too_many_shares: "tooManyShares", document_not_shareable: "notShareable", share_not_found: "notFound",
};

export function errorKey(code: unknown): string {
  return typeof code === "string" && MAP[code] ? MAP[code] : "generic";
}

/** Field-level validation details look like "invalid_quantity:2": the code and the 0-based line index. */
export function parseDetail(detail: string): { code: string; line: number | null } {
  const m = /^([a-z_]+)(?::(\d+))?$/.exec(detail);
  return m ? { code: m[1], line: m[2] === undefined ? null : Number(m[2]) } : { code: "generic", line: null };
}
