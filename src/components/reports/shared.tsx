"use client";

import { useLanguage } from "@/components/LanguageProvider";
import { useErrorText } from "@/components/documents/shared";
import { formatDateKey, formatMoney } from "@/lib/documents/moneyFormat";

// Client-side helpers for the Reports and Bookkeeping screens. Nothing here computes a figure: every number comes from the server.
export { callApi, Modal, inputClass, labelClass, primaryButton, secondaryButton, dangerButton, newRequestId } from "@/components/documents/shared";

/** A translated sentence for an API error body of /api/reports. A raw machine code is never shown. */
export function useReportErrorText() {
  const { t } = useLanguage();
  const docsText = useErrorText();
  return (data: any): string => {
    const code = data?.error === "validation_failed" && Array.isArray(data.details) ? String(data.details[0]) : String(data?.error ?? "");
    if (data?.error === "network") return t.reports.errors.network;
    if (t.reports.errors[code]) return t.reports.errors[code];
    if (code === "internal_error") return t.reports.errors.generic;
    return docsText(data);
  };
}

/** The same for /api/bookkeeping/**: validation details first (the first offending field), then the top-level error. */
export function useBookkeepingErrorText() {
  const { t } = useLanguage();
  const docsText = useErrorText();
  return (data: any): string => {
    if (data?.error === "network") return t.bookkeeping.errors.network;
    const first = data?.error === "validation_failed" && Array.isArray(data.details) ? String(data.details[0]).split(":")[0] : null;
    for (const c of [first, data?.error]) if (c && t.bookkeeping.errors[c]) return t.bookkeeping.errors[c];
    if (data?.error === "internal_error" || data?.error === "validation_failed") return t.bookkeeping.errors.generic;
    return docsText(data);
  };
}

export function useFormat() {
  const { locale } = useLanguage();
  const loc = locale === "en" ? "en" : "fr";
  return {
    loc,
    money: (minor: number, currency: string) => formatMoney(minor, currency, loc),
    day: (key: string | null | undefined) => formatDateKey(key, loc),
  };
}
