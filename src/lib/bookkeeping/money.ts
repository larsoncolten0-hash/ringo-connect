// Exact money handling for bookkeeping. Amounts are held as INTEGER MINOR UNITS of the business's own
// currency, where "minor unit" depends on the currency — NOT always cents:
//   XAF / XOF / JPY ... : 0 decimals  (1 minor unit = 1 FCFA; there is no "cent")
//   USD / EUR / most    : 2 decimals
//   KWD / BHD / TND ... : 3 decimals
// The table is explicit (not read from the runtime's ICU data) so the answer never varies by device,
// and it is kept identical to bk_currency_digits() in the SQL migration by a test.
//
// Rules: parsing is exact (decimal string arithmetic, no floating-point multiplication); an amount with
// more decimals than its currency supports is REJECTED, never rounded; sums are checked against the
// safe-integer range instead of silently losing precision.

export const ZERO_DECIMAL_CURRENCIES = ["BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG", "RWF", "UGX", "UYI", "VND", "VUV", "XAF", "XOF", "XPF"] as const;
export const THREE_DECIMAL_CURRENCIES = ["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"] as const;

/** Largest amount accepted per entry, in major units (mirrors the DB CHECK). */
export const MAX_MAJOR_AMOUNT = 9_999_999_999;

export function currencyMinorDigits(currency: string): 0 | 2 | 3 {
  const c = String(currency || "").toUpperCase();
  if ((ZERO_DECIMAL_CURRENCIES as readonly string[]).includes(c)) return 0;
  if ((THREE_DECIMAL_CURRENCIES as readonly string[]).includes(c)) return 3;
  return 2;
}

/**
 * Exact amount -> integer minor units, or null when unusable. Accepts a JSON number or a numeric string
 * ("12000", "12000.00", "10.50"). Rejects: negatives/zero handling is the caller's (this returns 0 for
 * "0"), exponent notation, thousands separators, NaN/Infinity, more fractional digits than the currency
 * supports (trailing zeros are fine: "12000.00" is 12000 XAF), and anything above MAX_MAJOR_AMOUNT.
 */
export function parseMinor(value: unknown, digits: number): number | null {
  let s: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    s = String(value);
  } else if (typeof value === "string") {
    s = value.trim();
  } else return null;
  if (!/^\d+(\.\d+)?$/.test(s)) return null; // also rules out "1e21", "-5", "1,000", ""
  const [whole, fracRaw = ""] = s.split(".");
  const frac = fracRaw.replace(/0+$/, "");
  if (frac.length > digits) return null; // would need rounding -> refuse
  if (whole.replace(/^0+(?=\d)/, "").length > 10) return null;
  const major = Number(whole);
  if (major > MAX_MAJOR_AMOUNT) return null;
  return major * 10 ** digits + (frac ? Number(frac.padEnd(digits, "0")) : 0);
}

/** Integer minor units -> exact decimal string for the database ("12000", "10.50", "1.234"). */
export function minorToAmountString(minor: number, digits: number): string {
  if (!Number.isSafeInteger(minor) || minor < 0) throw new Error("minorToAmountString: invalid amount");
  if (digits === 0) return String(minor);
  const s = String(minor).padStart(digits + 1, "0");
  return `${s.slice(0, -digits)}.${s.slice(-digits)}`;
}

/** Sum that refuses to lose precision. */
export function addMinor(a: number, b: number): number {
  const r = a + b;
  if (!Number.isSafeInteger(r)) throw new Error("bookkeeping: amount total exceeds the exact range");
  return r;
}

/** Display helper: minor units -> formatted currency string using the app's existing formatter rules. */
export function minorToMajorNumber(minor: number, digits: number): number {
  return minor / 10 ** digits; // display only; never feed the result back into arithmetic
}
