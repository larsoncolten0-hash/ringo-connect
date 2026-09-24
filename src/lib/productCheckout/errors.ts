// Stable, safe error codes for the product checkout API. Codes only — never database or provider
// text — so nothing internal leaks and the UI can translate them. Dependency-free.

export const HTTP_STATUS = {
  invalid_request: 400,
  invalid_quantity: 400,
  quantity_exceeds_max: 400,
  invalid_name: 400,
  invalid_phone: 400,
  invalid_email: 400,
  invalid_payment_medium: 400,
  commerce_disabled: 503,
  payment_provider_unavailable: 503,
  profile_unavailable: 404,
  music_profile_not_supported: 409,
  commerce_currency_unsupported: 409,
  product_unavailable: 404,
  product_price_unsupported: 409,
  insufficient_stock: 409,
  too_many_open_orders: 429,
  order_not_found: 404,
  order_expired: 410,
  order_not_payable: 409,
  payment_already_pending: 409,
  too_many_payment_attempts: 429,
  rate_limited: 429,
  payment_amount_invalid: 409,
  payment_amount_mismatch: 409,
  payment_currency_mismatch: 409,
  payment_failed: 502,
  payment_expired: 410,
  payment_review: 409,
  internal_error: 500,
} as const;

export type CheckoutErrorCode = keyof typeof HTTP_STATUS;

export function isCheckoutErrorCode(value: unknown): value is CheckoutErrorCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(HTTP_STATUS, value);
}

// Messages raised by create_product_order() that map 1:1 onto a public code.
const DB_CODES: CheckoutErrorCode[] = [
  "invalid_quantity",
  "quantity_exceeds_max",
  "commerce_disabled",
  "payment_provider_unavailable",
  "profile_unavailable",
  "music_profile_not_supported",
  "commerce_currency_unsupported",
  "too_many_open_orders",
  "insufficient_stock",
  "product_unavailable",
];

/** Maps the raw message of a database exception onto a public code (anything unknown -> internal_error). */
export function codeFromDbMessage(message: string | null | undefined): CheckoutErrorCode {
  const m = (message || "").trim();
  return (DB_CODES as string[]).includes(m) ? (m as CheckoutErrorCode) : "internal_error";
}

export type Result<T> = { ok: true; data: T } | { ok: false; code: CheckoutErrorCode };
export const ok = <T>(data: T): Result<T> => ({ ok: true, data });
export const fail = <T = never>(code: CheckoutErrorCode): Result<T> => ({ ok: false, code });
