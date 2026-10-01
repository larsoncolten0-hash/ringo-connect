// Error mapping for the Phase 3 API. The database functions raise short machine codes (see the Phase 3 migration); this turns them into
// HTTP statuses. Phase 2 codes (document_not_found, not_owner, ...) fall through to docError. Nothing internal reaches the client.
import { docError } from "@/lib/documents/http";

const STATUS: Record<string, number> = {
  customer_not_found: 404, reminder_not_found: 404,
  invalid_customer_name: 400, invalid_phone: 400, invalid_email: 400, invalid_notes: 400, invalid_setting: 400, invalid_channel: 400,
  not_an_invoice: 400, no_reminder_timing: 400, share_link_invalid: 400,
  customer_archived: 409, duplicate_customer: 409, business_email_required: 409, invoice_not_open: 409, nothing_due: 409,
  no_email: 409, email_suppressed: 409, no_phone: 409,
  reminder_too_soon: 429, invoice_reminder_cap: 429, daily_cap_reached: 429,
};
const UNAVAILABLE_CODES = new Set(["PGRST202", "PGRST205", "42883", "42P01"]);

export type RecvApiError = { status: number; body: { error: string; details?: string[] } };

export function recvError(error: { code?: string; message?: string } | null | undefined): RecvApiError {
  const message = String(error?.message || "");
  const code = String(error?.code || "");
  if (UNAVAILABLE_CODES.has(code) || /could not find the (function|table)|does not exist/i.test(message)) {
    return { status: 503, body: { error: "receivables_unavailable" } };
  }
  const known = Object.keys(STATUS).find((c) => new RegExp(`(^|[^a-z_])${c}($|[^a-z_])`).test(message));
  if (known) return { status: STATUS[known], body: { error: known } };
  return docError(error);
}

export const KNOWN_RECEIVABLES_ERRORS = Object.keys(STATUS);
