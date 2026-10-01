// Error mapping for the Phase 4 API. The database functions raise short machine codes (see the Phase 4 migration); this turns them into
// HTTP statuses. Phase 2 codes (not_owner, toolkit_not_enabled, demo_profile_not_supported, ...) fall through to docError.
import { docError } from "@/lib/documents/http";

const STATUS: Record<string, number> = {
  product_not_found: 404, order_not_found: 404,
  invalid_kind: 400, invalid_quantity: 400, invalid_reason: 400, invalid_note: 400, invalid_source: 400, invalid_unit_cost: 400, invalid_threshold: 400,
  invalid_sku: 400, invalid_filter: 400, reason_required: 400, opening_quantity_required: 400, digital_not_supported: 400, category_not_enabled: 403,
  not_tracked: 409, already_tracked: 409, insufficient_stock: 409, stock_limit_exceeded: 409, order_not_refunded: 409, exceeds_returnable: 409,
  order_item_not_found: 409, no_change: 409, count_mismatch: 409, stock_changed_retry: 409, duplicate_sku: 409,
};
const UNAVAILABLE_CODES = new Set(["PGRST202", "PGRST205", "42883", "42P01"]);

export type InvApiError = { status: number; body: { error: string; details?: string[] } };

export function invError(error: { code?: string; message?: string } | null | undefined): InvApiError {
  const message = String(error?.message || "");
  const code = String(error?.code || "");
  if (UNAVAILABLE_CODES.has(code) || /could not find the (function|table)|does not exist/i.test(message)) return { status: 503, body: { error: "inventory_unavailable" } };
  const known = Object.keys(STATUS).find((c) => new RegExp(`(^|[^a-z_])${c}($|[^a-z_])`).test(message));
  if (known) return { status: STATUS[known], body: { error: known } };
  return docError(error);
}

export const KNOWN_INVENTORY_ERRORS = Object.keys(STATUS);
