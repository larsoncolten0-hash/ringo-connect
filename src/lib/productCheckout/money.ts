// Exact money arithmetic for checkout/settlement. Whole cents as integers, never floating point
// fees. Dependency-free.

/** Value -> integer cents (handles JSON numbers and numeric strings). NaN-safe: returns null. */
export function toCents(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : (value as number);
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

export const centsToAmount = (cents: number): number => cents / 100;

/** Same amount to the cent? */
export function sameAmount(a: unknown, b: unknown): boolean {
  const x = toCents(a);
  const y = toCents(b);
  return x !== null && y !== null && x === y;
}

/** Whole units only (Fapshi moves whole XAF). */
export function isWholeAmount(value: unknown): boolean {
  const c = toCents(value);
  return c !== null && c > 0 && c % 100 === 0;
}

export interface Earnings {
  gross: number;
  platformFee: number;
  net: number;
  rate: number;
}

/**
 * gross x rate, half-up to the cent, computed on integers. The rate is numeric(5,4), i.e. whole
 * basis points, so the maths is exact. `null` if the inputs are unusable.
 * Guarantees gross === platformFee + net.
 */
export function computeEarnings(grossAmount: unknown, rate: unknown): Earnings | null {
  const grossCents = toCents(grossAmount);
  const r = typeof rate === "string" ? Number(rate) : (rate as number);
  if (grossCents === null || grossCents <= 0) return null;
  if (typeof r !== "number" || !Number.isFinite(r) || r < 0 || r > 1) return null;
  // Keeps grossCents x basisPoints (<= 10^4) inside the range where doubles hold integers exactly.
  if (grossCents > 900_000_000_000) return null;
  const basisPoints = Math.round(r * 10000);
  const scaled = grossCents * basisPoints + 5000; // + half a cent-of-a-cent => round half up
  const feeCents = (scaled - (scaled % 10000)) / 10000;
  const netCents = grossCents - feeCents;
  return { gross: centsToAmount(grossCents), platformFee: centsToAmount(feeCents), net: centsToAmount(netCents), rate: basisPoints / 10000 };
}
