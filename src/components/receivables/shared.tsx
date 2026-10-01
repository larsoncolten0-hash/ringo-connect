"use client";

import { useLanguage } from "@/components/LanguageProvider";
import { useErrorText } from "@/components/documents/shared";
import { recvErrorKey } from "@/lib/receivables/uiErrors";
import { formatDateKey, formatMoney } from "@/lib/documents/moneyFormat";

// Small client-side helpers for the Debtors screens. Nothing here decides anything about money, reminders or limits: every figure and every
// refusal comes from the server (/api/receivables/**), and the database re-checks all of it. Re-exported UI pieces live in documents/shared.
export { callApi, Modal, StatusBadge, inputClass, labelClass, primaryButton, secondaryButton, dangerButton, newRequestId } from "@/components/documents/shared";

/** A translated, human sentence for an API error body. A raw machine code is never shown. */
export function useRecvErrorText() {
  const { t } = useLanguage();
  const docsText = useErrorText();
  return (data: any): string => {
    const key = recvErrorKey(data?.error);
    if (key && t.receivables.errors[key]) return t.receivables.errors[key];
    return docsText(data);
  };
}

export function useFormatters() {
  const { locale } = useLanguage();
  const loc = locale === "en" ? "en" : "fr";
  return {
    money: (minor: number, currency: string) => formatMoney(minor, currency, loc),
    day: (key: string | null | undefined) => formatDateKey(key, loc),
    when: (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(loc === "fr" ? "fr-FR" : "en-GB", { day: "numeric", month: "short", year: "numeric" }) : ""),
  };
}
