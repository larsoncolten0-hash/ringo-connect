// Uses the browser/Node's built-in Intl API instead of a hand-maintained
// currency list — this way "all currencies" actually means all of them,
// with correct symbols, decimal places, and formatting per currency,
// and it never goes stale.

/** Every ISO 4217 currency code the runtime knows about, e.g. ["USD", "EUR", ...] */
export function getAllCurrencyCodes(): string[] {
  try {
    // @ts-ignore — supportedValuesOf is ES2022, may not be in older TS lib configs
    const codes: string[] = (Intl as any).supportedValuesOf("currency");
    // Older Android WebView/Chrome builds implement Intl.supportedValuesOf
    // but ship it with a trimmed-down ICU currency list that's missing XAF
    // (this platform's primary currency) even though the API call itself
    // succeeds — so it lands here instead of in the catch below. Belt and
    // suspenders: make sure XAF is always present so it isn't invisible to
    // any Cameroonian creator selecting their own currency, regardless of
    // what a given phone's ICU data happens to include.
    return codes.includes("XAF") ? codes : ["XAF", ...codes];
  } catch {
    // Old-runtime fallback (no Intl.supportedValuesOf at all — common on
    // older Android System WebView, which is why this list used to show up
    // there instead of the full ICU one an updated iPhone gets) — covers
    // the overwhelming majority of real usage. XAF listed first since it's
    // this platform's primary currency.
    return ["XAF", "USD", "EUR", "GBP", "NGN", "KES", "GHS", "ZAR", "INR", "JPY", "CAD", "AUD", "BRL", "MXN"];
  }
}

/** Digits-only WhatsApp number (no "+", matching how whatsapp_number is stored) → the currency a new account with that number should default to, before the owner ever picks one of their own. */
export function defaultCurrencyForWhatsapp(whatsappNumber?: string | null): string {
  const digits = (whatsappNumber || "").replace(/\D/g, "");
  return digits.startsWith("237") ? "XAF" : "USD";
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