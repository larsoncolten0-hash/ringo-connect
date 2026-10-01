// Maps an API error code to the key of a translated message in t.inventory.errors. Unknown codes return null so the caller can fall back to
// the Phase 2 mapping (documents.ui.errors) and finally "generic": a raw machine code is never shown to a person.
const MAP: Record<string, string> = {
  inventory_unavailable: "unavailable", documents_unavailable: "unavailable", product_not_found: "productNotFound", order_not_found: "orderNotFound",
  not_tracked: "notTracked", already_tracked: "alreadyTracked", insufficient_stock: "insufficientStock", stock_limit_exceeded: "stockLimit",
  order_not_refunded: "orderNotRefunded", exceeds_returnable: "exceedsReturnable", order_item_not_found: "orderItemNotFound", no_change: "noChange",
  count_mismatch: "countMismatch", stock_changed_retry: "stockChangedRetry", duplicate_sku: "duplicateSku", digital_not_supported: "digitalNotSupported",
  category_not_enabled: "categoryNotEnabled", invalid_quantity: "invalidQuantity", invalid_reason: "invalidReason", reason_required: "reasonRequired",
  invalid_note: "invalidNote", invalid_source: "invalidSource", invalid_unit_cost: "invalidUnitCost", amount_too_precise: "tooPrecise",
  invalid_threshold: "invalidThreshold", invalid_sku: "invalidSku", opening_quantity_required: "openingRequired", invalid_kind: "invalidQuantity", invalid_filter: "invalidQuantity",
};
export function invErrorKey(code: unknown): string | null {
  return typeof code === "string" && MAP[code] ? MAP[code] : null;
}
