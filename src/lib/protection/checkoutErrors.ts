// Stable, safe error codes for the Ringo Protection checkout API. Codes only — never database or
// provider text. Dependency-free. Mirrors productCheckout/errors.ts's own shape and discipline, kept
// as its own separate module (not imported from productCheckout) so Protection's checkout lane never
// shares a mutable type with Normal Payment's.

export const PROTECTION_HTTP_STATUS = {
  invalid_request: 400,
  invalid_payment_medium: 400,
  invalid_phone: 400,
  order_not_found: 404,
  order_not_payable: 409,
  order_expired: 410,
  protection_disabled: 503,
  protection_not_configured: 503,
  transaction_not_found: 404,
  transaction_already_exists: 409,
  transaction_not_payable: 409,
  payment_provider_unavailable: 503,
  payment_already_pending: 409,
  too_many_payment_attempts: 429,
  rate_limited: 429,
  payment_failed: 502,
  payment_expired: 410,
  forbidden: 403,
  internal_error: 500,
} as const;

export type ProtectionCheckoutErrorCode = keyof typeof PROTECTION_HTTP_STATUS;

export function isProtectionCheckoutErrorCode(value: unknown): value is ProtectionCheckoutErrorCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(PROTECTION_HTTP_STATUS, value);
}

export type Result<T> = { ok: true; data: T } | { ok: false; code: ProtectionCheckoutErrorCode };
export const ok = <T>(data: T): Result<T> => ({ ok: true, data });
export const fail = <T = never>(code: ProtectionCheckoutErrorCode): Result<T> => ({ ok: false, code });
