"use client";

import { useLanguage } from "@/components/LanguageProvider";
import { useRecvErrorText } from "@/components/receivables/shared";

// Client-side helpers for the Customers screens. Nothing here computes a figure or decides who may see what: every number and every refusal comes
// from the server (/api/customers/** and the existing /api/receivables/customers/**).
export { callApi, Modal, StatusBadge, inputClass, labelClass, primaryButton, secondaryButton, dangerButton, newRequestId } from "@/components/documents/shared";
export { useFormatters } from "@/components/receivables/shared";

/** A translated sentence for an API error body. Customers errors first, then the existing Phase 3 contact errors (duplicate, invalid fields...). */
export function useCustErrorText() {
  const { t } = useLanguage();
  const recvText = useRecvErrorText();
  return (data: any): string => {
    if (data?.error === "network") return t.customers.errors.network;
    const code = data?.error === "validation_failed" && Array.isArray(data.details) ? String(data.details[0]) : String(data?.error ?? "");
    if (t.customers.errors[code]) return t.customers.errors[code];
    return recvText(data);
  };
}
