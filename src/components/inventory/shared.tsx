"use client";

import { useLanguage } from "@/components/LanguageProvider";
import { useErrorText } from "@/components/documents/shared";
import { invErrorKey } from "@/lib/inventory/uiErrors";
import { formatMoney } from "@/lib/documents/moneyFormat";

// Client-side helpers for the Inventory screens. Nothing here decides a quantity: every figure comes from /api/inventory/** and the
// database re-checks every operation. UI pieces are shared with the invoice screens.
export { callApi, Modal, inputClass, labelClass, primaryButton, secondaryButton, dangerButton, newRequestId } from "@/components/documents/shared";

/** A translated sentence for an API error body. A raw machine code is never shown. */
export function useInvErrorText() {
  const { t } = useLanguage();
  const docsText = useErrorText();
  return (data: any): string => {
    const first = data?.error === "validation_failed" && Array.isArray(data.details) ? String(data.details[0]).split(":")[0] : data?.error;
    const key = invErrorKey(first);
    if (key && t.inventory.errors[key]) return t.inventory.errors[key];
    return docsText(data);
  };
}

export function useMoney() {
  const { locale } = useLanguage();
  const loc = locale === "en" ? "en" : "fr";
  return {
    money: (minor: number, currency: string) => formatMoney(minor, currency, loc),
    when: (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(loc === "fr" ? "fr-FR" : "en-GB", { day: "numeric", month: "short", year: "numeric" }) : ""),
  };
}

const TONE: Record<string, string> = {
  out: "bg-rose-500/10 text-rose-700 dark:text-rose-400",
  low: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  ok: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  legacy: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
  untracked: "bg-ringo-muted/10 text-ringo-muted",
};
export function StateBadge({ state }: { state: string }) {
  const { t } = useLanguage();
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE[state] || TONE.untracked}`}>{t.inventory.ui.state[state] ?? state}</span>;
}
