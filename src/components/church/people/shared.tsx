"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, Loader2, X } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { useModalA11y } from "@/components/ui/useModalA11y";

// Shared building blocks of the church People / Groups / Leadership screens. Nothing here knows about permissions: the server decides (every call below goes to /api/church/**, which
// resolves the church and the caller's rights itself), and the screens only hide what the caller's capabilities say would be refused.

export const INPUT =
  "w-full min-h-[44px] rounded-card border border-ringo-border bg-ringo-bg px-3 py-2.5 text-sm text-ringo-text placeholder:text-ringo-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/40 disabled:opacity-60";
export const BTN_PRIMARY =
  "ringo-tactile inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full bg-ringo-indigo px-5 text-sm font-semibold text-white hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/50 focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed";
export const BTN_SECONDARY =
  "ringo-tactile inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full border border-ringo-border bg-ringo-surface px-4 text-sm font-semibold text-ringo-text hover:border-ringo-indigo/40 hover:bg-ringo-indigo/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/40 disabled:opacity-60 disabled:cursor-not-allowed";
export const BTN_DANGER =
  "ringo-tactile inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full bg-ringo-coral px-5 text-sm font-semibold text-white hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-coral/50 focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed";
export const BTN_LINK = "inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-ringo-indigo hover:bg-ringo-indigo/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/40 disabled:opacity-60";

export type ApiResult<T = any> = { ok: true; status: number; body: T } | { ok: false; status: number; code: string; field?: string };

/** One call to /api/church/**. Never throws: a network failure is `code: "network"`. The caller maps `code` to a sentence with errorText(). */
export async function churchApi<T = any>(url: string, init?: { method?: string; body?: unknown }): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method: init?.method ?? "GET",
      headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });
    let json: any = null;
    try {
      json = await res.json();
    } catch {
      /* not JSON */
    }
    if (res.ok && json && json.ok !== false) return { ok: true, status: res.status, body: json as T };
    return { ok: false, status: res.status, code: typeof json?.error === "string" ? json.error : res.status === 401 ? "not_signed_in" : "generic", field: typeof json?.field === "string" ? json.field : undefined };
  } catch {
    return { ok: false, status: 0, code: "network" };
  }
}

/** A sentence in the visitor's language for a server code. Unknown codes get the generic one: a raw code is never shown. */
export function errorText(errors: Record<string, string>, code: string): string {
  return errors[code] ?? errors.generic;
}

/** YYYY-MM-DD (or an ISO timestamp) shown as a local calendar date. Pure date arithmetic: no time zone shifts a stored date. */
export function formatDay(value: string | null | undefined, locale: string): string {
  if (!value) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(d);
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** A short-lived confirmation message, announced politely to assistive technology. */
export function useNotice() {
  const [notice, setNotice] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((message: string) => {
    setNotice(message);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setNotice(""), 5000);
  }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return { notice, show };
}

export function NoticeBar({ message }: { message: string }) {
  return (
    <div role="status" aria-live="polite" className="min-h-0">
      {message && (
        <p className="mb-3 flex items-center gap-2 rounded-2xl border border-emerald-700/25 bg-emerald-700/[0.07] px-4 py-2.5 text-sm font-medium text-emerald-800">
          <CheckCircle2 size={16} aria-hidden="true" />
          {message}
        </p>
      )}
    </div>
  );
}

export function ErrorLine({ message }: { message: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="flex items-start gap-2 text-sm text-ringo-coral">
      <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </p>
  );
}

/** Accessible dialog: portal, focus moves in and returns, Tab is trapped, Escape closes. Bottom sheet on a phone, centred card on larger screens. */
export function Modal(props: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode; wide?: boolean; labelledBy?: string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // keep the page behind from scrolling while a dialog is open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  // The portal target only exists in the browser, after mount. The dialog itself is a separate component so that useModalA11y (which attaches once, on mount) runs when the dialog element exists.
  if (!mounted) return null;
  return createPortal(<ModalBody {...props} />, document.body);
}

function ModalBody({ title, subtitle, onClose, children, wide = false, labelledBy }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode; wide?: boolean; labelledBy?: string }) {
  const { t } = useLanguage();
  const ref = useModalA11y<HTMLDivElement>(onClose);
  const headingId = labelledBy ?? "church-modal-title";
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center">
      <div onClick={onClose} className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm" aria-hidden="true" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
        className={`relative flex max-h-[90vh] w-full flex-col gap-4 overflow-y-auto rounded-t-3xl bg-ringo-surface p-5 shadow-2xl sm:rounded-3xl sm:p-6 ${wide ? "sm:max-w-2xl" : "sm:max-w-md"}`}
      >
        <button type="button" onClick={onClose} aria-label={t.churchPeople.common.close} className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full text-ringo-muted hover:bg-ringo-muted/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/40">
          <X size={16} aria-hidden="true" />
        </button>
        <div className="pr-10">
          <h2 id={headingId} className="font-display text-lg font-semibold text-ringo-text">
            {title}
          </h2>
          {subtitle && <p className="mt-1 text-sm leading-relaxed text-ringo-muted">{subtitle}</p>}
        </div>
        {children}
      </div>
    </div>
  );
}

/** A consequential action asks first, says what will happen, and keeps the dialog open (with the reason) when the server refuses. */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  /** Return an error message to keep the dialog open with it, or "" when done. */
  onConfirm: () => Promise<string>;
  onCancel: () => void;
}) {
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async () => {
    setBusy(true);
    setError("");
    const message = await onConfirm();
    setBusy(false);
    if (message) setError(message);
  };
  return (
    <Modal title={title} onClose={busy ? () => {} : onCancel} labelledBy="church-confirm-title">
      <p className="text-sm leading-relaxed text-ringo-muted">{body}</p>
      <ErrorLine message={error} />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" onClick={onCancel} disabled={busy} className={BTN_SECONDARY}>
          {t.churchPeople.common.cancel}
        </button>
        <button type="button" onClick={run} disabled={busy} className={danger ? BTN_DANGER : BTN_PRIMARY}>
          {busy && <Loader2 size={15} className="animate-spin" aria-hidden="true" />}
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export function Field({ id, label, hint, optional, children }: { id: string; label: string; hint?: string; optional?: boolean; children: React.ReactNode }) {
  const { t } = useLanguage();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-semibold text-ringo-text">
        {label}
        {optional && <span className="ml-1 font-normal text-ringo-muted">({t.churchPeople.common.optional})</span>}
      </label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="text-xs leading-relaxed text-ringo-muted">
          {hint}
        </p>
      )}
    </div>
  );
}

const TONES: Record<string, string> = {
  active: "bg-emerald-700/10 text-emerald-800",
  pending: "bg-amber-600/10 text-amber-800",
  inactive: "bg-ringo-muted/15 text-ringo-muted",
  removed: "bg-ringo-coral/10 text-ringo-coral",
  archived: "bg-ringo-muted/15 text-ringo-muted",
  child: "bg-ringo-indigo/10 text-ringo-indigo",
  youth: "bg-ringo-indigo/[0.06] text-ringo-indigo",
  adult: "bg-ringo-muted/10 text-ringo-muted",
  current: "bg-emerald-700/10 text-emerald-800",
  ended: "bg-ringo-muted/15 text-ringo-muted",
  leader: "bg-ringo-indigo/10 text-ringo-indigo",
  assistant: "bg-ringo-indigo/[0.06] text-ringo-indigo",
};

export function Badge({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONES[tone] ?? TONES.inactive}`}>{children}</span>;
}

export function EmptyState({ icon, title, body, action }: { icon: React.ReactNode; title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-ringo-border bg-ringo-surface/60 px-6 py-12 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-ringo-indigo/10 text-ringo-indigo" aria-hidden="true">
        {icon}
      </span>
      <h2 className="font-display text-base font-semibold text-ringo-text">{title}</h2>
      {body && <p className="max-w-sm text-sm leading-relaxed text-ringo-muted">{body}</p>}
      {action}
    </div>
  );
}

export function Pager({ page, pageSize, total, onPage, busy }: { page: number; pageSize: number; total: number; onPage: (p: number) => void; busy?: boolean }) {
  const { t } = useLanguage();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  return (
    <nav className="mt-4 flex items-center justify-between gap-3" aria-label={t.churchPeople.common.pageOf(page, pages)}>
      <button type="button" className={BTN_SECONDARY} disabled={busy || page <= 1} onClick={() => onPage(page - 1)}>
        {t.churchPeople.common.previous}
      </button>
      <span className="text-xs text-ringo-muted" aria-live="polite">
        {t.churchPeople.common.pageOf(page, pages)}
      </span>
      <button type="button" className={BTN_SECONDARY} disabled={busy || page >= pages} onClick={() => onPage(page + 1)}>
        {t.churchPeople.common.next}
      </button>
    </nav>
  );
}

export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton h-16 rounded-2xl" />
      ))}
    </div>
  );
}
