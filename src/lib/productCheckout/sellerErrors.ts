// Stable, safe error codes for the seller-facing product order routes (Increment 5A). Codes only -
// never database text - so nothing internal leaks and the dashboard can translate them. Dependency-free.

export const SELLER_HTTP_STATUS = {
  not_authenticated: 401,
  forbidden: 403,
  invalid_request: 400,
  order_not_found: 404,
  order_not_fulfillable: 409,
  internal_error: 500,
} as const;

export type SellerErrorCode = keyof typeof SELLER_HTTP_STATUS;

export function isSellerErrorCode(value: unknown): value is SellerErrorCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(SELLER_HTTP_STATUS, value);
}

export type SellerResult<T> = { ok: true; data: T } | { ok: false; code: SellerErrorCode };
export const sellerOk = <T>(data: T): SellerResult<T> => ({ ok: true, data });
export const sellerFail = <T = never>(code: SellerErrorCode): SellerResult<T> => ({ ok: false, code });
