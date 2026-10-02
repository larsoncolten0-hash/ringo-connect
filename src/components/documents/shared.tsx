"use client";

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { errorKey } from "@/lib/documents/uiErrors";

// Small client-side pieces shared by the invoice screens. Nothing here decides anything about money or state: every figure and every
// permitted action comes from the server (/api/documents/**), and the database re-checks all of it.

export type ApiResponse<T = any> = { ok: boolean; status: number; data: T };

export async function callApi<T = any>(method: string, url: string, body?: unknown): Promise<ApiResponse<T>> {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: "network" } as any };
  }
}

/** Turns an API error body into a translated, human sentence. A raw machine code is never shown. */
export function useErrorText() {
  const { t } = useLanguage();
  return (data: any): string => {
    if (data?.error === "network") return t.documents.ui.errors.network;
    // a validation failure names the first offending field: show the specific message when there is one
    if (data?.error === "validation_failed" && Array.isArray(data.details) && data.details.length > 0) {
      const code = String(data.details[0]).split(":")[0];
      const k = errorKey(code);
      if (k !== "generic") return t.documents.ui.errors[k] ?? t.documents.ui.errors.validation;
    }
    return t.documents.ui.errors[errorKey(data?.error)] ?? t.documents.ui.errors.generic;
  };
}

/** Downloads the owner's PDF for a document. Returns null on success, or the API error body to show. */
export async function downloadPdf(id: string): Promise<{ error: string } | null> {
  try {
    const res = await fetch(`/api/documents/${encodeURIComponent(id)}/pdf`);
    if (!res.ok) return (await res.json().catch(() => ({ error: "generic" }))) as { error: string };
    const blob = await res.blob();
    const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") || "")?.[1] || "document.pdf";
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    return null;
  } catch {
    return { error: "network" };
  }
}

/**
 * Prints the document's PDF without downloading it first: the PDF is fetched, loaded into an invisible frame and the browser's print dialog is opened on it.
 * Returns an error when the PDF could not be fetched or the browser blocked printing (the caller then offers Download PDF).
 */
export async function printPdf(id: string): Promise<{ error: string } | null> {
  try {
    const res = await fetch(`/api/documents/${encodeURIComponent(id)}/pdf`);
    if (!res.ok) return (await res.json().catch(() => ({ error: "generic" }))) as { error: string };
    const blob = new Blob([await res.blob()], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const frame = document.createElement("iframe");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
    frame.src = url;
    const cleanup = () => { frame.remove(); URL.revokeObjectURL(url); };
    return await new Promise((resolve) => {
      frame.onload = () => {
        try {
          frame.contentWindow?.focus();
          frame.contentWindow?.print();
          setTimeout(cleanup, 60_000);
          resolve(null);
        } catch {
          cleanup();
          resolve({ error: "print" });
        }
      };
      document.body.appendChild(frame);
    });
  } catch {
    return { error: "network" };
  }
}

/** A UUID for idempotency keys. crypto.randomUUID needs a secure context; the fallback keeps the key unique enough for a retry guard. */
export function newRequestId(): string {
  const c: any = typeof crypto !== "undefined" ? crypto : null;
  if (c?.randomUUID) return c.randomUUID();
  const hex = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${(8 + Math.floor(Math.random() * 4)).toString(16)}${hex(3)}-${hex(12)}`;
}

const TONE: Record<string, string> = {
  draft: "bg-ringo-muted/15 text-ringo-muted",
  issued: "bg-ringo-indigo/10 text-ringo-indigo",
  partially_paid: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  paid: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  void: "bg-rose-500/10 text-rose-700 dark:text-rose-400",
};

export function StatusBadge({ status, overdue = false }: { status: string; overdue?: boolean }) {
  const { t } = useLanguage();
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${TONE[status] ?? TONE.draft}`}>{t.documents.pdf.status[status] ?? status}</span>
      {overdue && <span className="inline-flex items-center rounded-full bg-rose-500/15 px-2.5 py-1 text-xs font-medium text-rose-700 dark:text-rose-400">{t.documents.ui.overdue}</span>}
    </span>
  );
}

/** A bottom sheet on phones, a centred dialog on larger screens. Portaled to <body> like the other dashboard modals. */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const { t } = useLanguage();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-label={title} className="relative w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl bg-ringo-surface p-5 sm:p-6 flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
        <button onClick={onClose} aria-label={t.documents.ui.cancel} className="absolute right-4 top-4 w-8 h-8 rounded-full flex items-center justify-center text-ringo-muted hover:bg-ringo-muted/10 transition">
          <X size={15} />
        </button>
        <h2 className="font-display text-lg font-medium text-ringo-text pr-8">{title}</h2>
        {children}
      </div>
    </div>,
    document.body
  );
}

export const inputClass = "w-full text-sm border border-ringo-border rounded-card px-3 py-2.5 bg-ringo-bg text-ringo-text disabled:opacity-60";
export const labelClass = "flex flex-col gap-1.5 text-xs font-medium text-ringo-muted";
export const primaryButton = "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-card bg-ringo-indigo px-4 py-2 text-sm font-medium text-white transition hover:brightness-110 disabled:opacity-50";
export const secondaryButton = "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-card border border-ringo-border px-4 py-2 text-sm font-medium text-ringo-text transition hover:bg-ringo-muted/10 disabled:opacity-50";
export const dangerButton = "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-card border border-rose-500/40 px-4 py-2 text-sm font-medium text-rose-700 dark:text-rose-400 transition hover:bg-rose-500/10 disabled:opacity-50";
