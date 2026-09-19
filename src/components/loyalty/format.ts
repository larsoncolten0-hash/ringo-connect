import type { Locale, Translations } from "@/lib/i18n/translations";
import { formatPrice } from "@/lib/currency";

// Small client helpers shared by the Loyalty screens. No display text lives here: every
// label comes from t.loyalty.* (English + French).

export type LoyaltyT = Translations["loyalty"];

const TAG: Record<Locale, string> = { en: "en-GB", fr: "fr-FR" };

export function fmtDate(iso: string | null | undefined, locale: Locale): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(TAG[locale], { day: "numeric", month: "short", year: "numeric" });
}

export function fmtDateTime(iso: string | null | undefined, locale: Locale): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(TAG[locale], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function fmtNumber(n: number, locale: Locale): string {
  return new Intl.NumberFormat(TAG[locale]).format(n);
}

export function fmtMoney(amount: number, currency: string | null, locale: Locale): string {
  return currency ? formatPrice(amount, currency, locale) : fmtNumber(amount, locale);
}

/** Wording for an action key; falls back to the raw key so an unknown one never renders blank. */
export function actionText(t: LoyaltyT, key: string) {
  const a = (t.actions as Record<string, { one: string; many: string; howMany: string; record: string; reward: string }>)[key];
  return a ?? { one: key, many: key, howMany: key, record: key, reward: "" };
}

/** Translated message for an outcome/error code returned by the API. */
export function outcomeText(t: LoyaltyT, code: string | undefined | null): string {
  return (code && t.outcomes[code]) || t.outcomes.server_error;
}

export function newKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `k-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

export type ApiResult<T = any> = { status: number; data: T | null };

/**
 * JSON fetch that never throws. status 0 means the request never got an answer (offline,
 * timeout), which callers treat differently from a real answer: an idempotency key is only
 * discarded after a REAL response, so retrying a request that may have reached the server
 * can never record it twice.
 */
export async function api<T = any>(url: string, init: { method?: string; body?: unknown } = {}): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
      headers: init.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      credentials: "same-origin",
    });
    let data: T | null = null;
    try {
      data = (await res.json()) as T;
    } catch {
      data = null;
    }
    return { status: res.status, data };
  } catch {
    return { status: 0, data: null };
  }
}

/** Error/outcome code from an API result, or null when the call succeeded. */
export function codeOf(res: ApiResult<any>): string | null {
  if (res.status === 0) return "network";
  return res.data?.outcome ?? res.data?.error ?? (res.status >= 200 && res.status < 300 ? null : "server_error");
}
