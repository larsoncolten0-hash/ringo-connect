// Ringo Protection — Phase 4 fee arithmetic. Same integer-cents, half-up discipline as
// productCheckout/money.ts's computeEarnings, deliberately re-implemented rather than imported: the
// two are conceptually different calculations (a fee ADDED on top of an amount vs. a commission
// SUBTRACTED from one) and this file must stay dependency-free / browser-safe on its own, exactly
// like money.ts is, so it can be imported for an indicative client-side total before the order or
// the protection_transactions row exists — never authoritative, the server always recomputes it.

function toCents(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : (value as number);
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return Math.round(n * 100);
}
const centsToAmount = (cents: number): number => cents / 100;

export interface ProtectionFeeCalc {
  productAmount: number;
  feeRate: number; // fraction actually used, e.g. 0.03
  feeAmount: number;
  customerTotal: number;
}

/**
 * gross x rate, half-up to the cent — the exact same rounding rule computeEarnings uses, so a
 * product/fee pair is never off by a rounding cent from how earnings would round the same numbers.
 * `null` if the inputs are unusable (non-positive amount, rate outside [0,1]).
 */
export function computeProtectionFee(productAmount: unknown, feeRate: unknown): ProtectionFeeCalc | null {
  const productCents = toCents(productAmount);
  const r = typeof feeRate === "string" ? Number(feeRate) : (feeRate as number);
  if (productCents === null || productCents <= 0) return null;
  if (typeof r !== "number" || !Number.isFinite(r) || r < 0 || r > 1) return null;
  if (productCents > 900_000_000_000) return null;
  const basisPoints = Math.round(r * 10000);
  const scaled = productCents * basisPoints + 5000; // + half a cent-of-a-cent => round half up
  const feeCents = (scaled - (scaled % 10000)) / 10000;
  return {
    productAmount: centsToAmount(productCents),
    feeRate: basisPoints / 10000,
    feeAmount: centsToAmount(feeCents),
    customerTotal: centsToAmount(productCents + feeCents),
  };
}
