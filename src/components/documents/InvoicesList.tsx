"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { FileText, Loader2, Plus } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import EmptyState from "@/components/editor/EmptyState";
import { formatDateKey, formatMoney } from "@/lib/documents/moneyFormat";
import type { DocumentActions as Flags } from "@/lib/documents/actions";
import DocumentActions from "./DocumentActions";
import { StatusBadge, callApi, primaryButton, secondaryButton, useErrorText } from "./shared";

const PAGE = 20;
const FILTERS = [
  { key: "", label: "filterAll" },
  { key: "draft", label: "filterDraft" },
  { key: "issued", label: "filterIssued" },
  { key: "partially_paid", label: "filterPartial" },
  { key: "paid", label: "filterPaid" },
  { key: "void", label: "filterVoid" },
] as const;

type Item = {
  id: string; number: string | null; status: string; customer_name: string | null; issue_date: string | null; due_date: string | null; currency: string;
  total_minor: number; amount_paid_minor: number; balance_minor: number; overdue: boolean; actions: Flags;
};

// The owner's invoices. Every figure is exact (integer minor units from the server) and every action offered comes from the server's
// state rule, so a row never shows a button the database would refuse.
export default function InvoicesList() {
  const { t, locale } = useLanguage();
  const u = t.documents.ui;
  const errorText = useErrorText();
  const [status, setStatus] = useState<string>("");
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const q = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
    if (status) q.set("status", status);
    const r = await callApi("GET", `/api/documents?${q.toString()}`);
    setLoading(false);
    if (!r.ok) return setError(errorText(r.data) || u.loadError);
    setItems(r.data.items || []);
    setTotal(r.data.total || 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, offset]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="flex flex-col gap-5 max-w-4xl">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-medium text-ringo-text tracking-[-0.01em] mb-1">{u.title}</h1>
          <p className="text-sm text-ringo-muted max-w-lg">{u.subtitle}</p>
        </div>
        <Link href="/dashboard/documents/new" className={primaryButton}><Plus size={16} />{u.createInvoice}</Link>
      </div>

      <div className="flex flex-wrap gap-2" role="tablist">
        {FILTERS.map((f) => {
          const active = f.key === status;
          return (
            <button key={f.key} role="tab" aria-selected={active} onClick={() => { setStatus(f.key); setOffset(0); }}
              className={`inline-flex min-h-[40px] items-center rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${active ? "border-ringo-indigo bg-ringo-indigo/10 text-ringo-indigo" : "border-ringo-border/70 text-ringo-muted hover:text-ringo-text"}`}>
              {u[f.label]}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="py-12 flex items-center justify-center text-ringo-muted"><Loader2 size={20} className="animate-spin" /><span className="sr-only">{u.loading}</span></div>
      ) : error ? (
        <div className="flex flex-col items-start gap-3 rounded-2xl border border-rose-500/30 p-4">
          <p role="alert" className="text-sm text-rose-600">{error}</p>
          <button onClick={load} className={secondaryButton}>{u.retry}</button>
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={FileText} title={status ? u.emptyFilteredTitle : u.emptyTitle} hint={status ? undefined : u.emptyHint} />
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((d) => (
            <li key={d.id} className="rounded-2xl border border-ringo-border/70 bg-ringo-surface p-4 flex flex-col gap-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link href={`/dashboard/documents/${d.id}`} className="text-base font-medium text-ringo-text hover:text-ringo-indigo break-words">
                    {d.number ?? u.draftLabel}
                  </Link>
                  <p className="text-sm text-ringo-muted break-words">{d.customer_name || u.noCustomer}</p>
                </div>
                <StatusBadge status={d.status} overdue={d.overdue} />
              </div>
              <dl className="grid grid-cols-2 sm:grid-cols-5 gap-x-4 gap-y-2 text-sm">
                <Figure label={u.issueDate} value={d.issue_date ? formatDateKey(d.issue_date, locale) : "—"} />
                <Figure label={u.dueDate} value={d.due_date ? formatDateKey(d.due_date, locale) : "—"} />
                <Figure label={u.total} value={formatMoney(d.total_minor, d.currency, locale)} strong />
                <Figure label={u.received} value={formatMoney(d.amount_paid_minor, d.currency, locale)} />
                <Figure label={u.outstanding} value={d.status === "draft" || d.status === "void" ? "—" : formatMoney(d.balance_minor, d.currency, locale)} strong />
              </dl>
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/dashboard/documents/${d.id}`} className={secondaryButton}>{u.view}</Link>
                <DocumentActions doc={{ id: d.id, number: d.number, currency: d.currency, balanceMinor: d.balance_minor, issueDate: d.issue_date }} actions={d.actions} onChanged={load} />
              </div>
            </li>
          ))}
        </ul>
      )}

      {!loading && !error && total > PAGE && (
        <div className="flex items-center justify-between gap-3">
          <button onClick={() => setOffset(Math.max(0, offset - PAGE))} disabled={offset === 0} className={secondaryButton}>{u.previous}</button>
          <span className="text-sm text-ringo-muted tabular-nums">{u.pageOf(offset + 1, Math.min(offset + PAGE, total), total)}</span>
          <button onClick={() => setOffset(offset + PAGE)} disabled={offset + PAGE >= total} className={secondaryButton}>{u.next}</button>
        </div>
      )}
    </div>
  );
}

function Figure({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-ringo-muted">{label}</dt>
      <dd className={`break-words tabular-nums ${strong ? "font-medium text-ringo-text" : "text-ringo-text"}`}>{value}</dd>
    </div>
  );
}
