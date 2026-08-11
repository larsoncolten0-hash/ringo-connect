// Uses the browser/Node's built-in Intl API instead of a hand-maintained
// currency list — this way "all currencies" actually means all of them,
// with correct symbols, decimal places, and formatting per currency,
// and it never goes stale.

/** Every ISO 4217 currency code the runtime knows about, e.g. ["USD", "EUR", ...] */
export function getAllCurrencyCodes(): string[] {
  try {
    // @ts-ignore — supportedValuesOf is ES2022, may not be in older TS lib configs
    return (Intl as any).supportedValuesOf("currency");
  } catch {
    // Extremely old runtime fallback — covers the overwhelming majority of real usage.
    return ["USD", "EUR", "GBP", "NGN", "KES", "GHS", "ZAR", "INR", "JPY", "CAD", "AUD", "BRL", "MXN"];
  }
}

/** "USD — US Dollar" style label for a select option */
export function getCurrencyLabel(code: string, locale = "en"): string {
  try {
    const displayNames = new Intl.DisplayNames([locale], { type: "currency" });
    const name = displayNames.of(code);
    return name && name !== code ? `${code} — ${name}` : code;
  } catch {
    return code;
  }
}

/** Formats an amount using the correct symbol/placement/decimals for the currency, e.g. formatPrice(9.99, "EUR") -> "€9.99" */
export function formatPrice(
  amount: number | string | null | undefined,
  currency: string,
  locale = "en"
): string {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  if (n === null || n === undefined || Number.isNaN(n)) return "";
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency: currency || "USD" }).format(n);
  } catch {
    return `${currency} ${n}`;
  }
}