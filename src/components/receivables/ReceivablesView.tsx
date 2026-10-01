"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BellRing, Link2, Loader2, Plus } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import LinkCustomerModal from "./LinkCustomerModal";
import ReminderModal, { type ReminderTarget } from "./ReminderModal";
import { callApi, primaryButton, secondaryButton, useFormatters, useRecvErrorText } from "./shared";

type Bucket = { amount_minor: number; count: number };
type Cust = { customer_id: string; name: string; archived: boolean; auto_paused: boolean; outstanding_minor: number; overdue_minor: number; invoice_count: number; oldest_due_date: string | null; last_reminder_at: string | null };
type Cur = {
  currency: string; can_record_payment: boolean; outstanding_minor: number; overdue_minor: number; invoice_count: number; overdue_count: number;
  aging: Record<string, Bucket>; customers: Cust[]; unassigned: { outstanding_minor: number; overdue_minor: number; invoice_count: number };
};
type Inv = {
  id: string; number: string | null; due_date: string | null; currency: string; amount_due_minor: number; overdue: boolean; days_overdue: number; customer_id: string | null;
  customer_name: string | null; linked: boolean; has_email: boolean; has_phone: boolean; can_record_payment: boolean; last_reminder_at: string | null;
};

const AGING_ORDER = ["not_due", "no_due_date", "d1_30", "d31_60", "d61_90", "d90_plus"];
const PAGE = 25;

/** Debtors overview: Outstanding Balance and Overdue per currency (never mixed), aging, per-customer balances, and the invoices with an Amount Due. */
export default function ReceivablesView() {
  const { t } = useLanguage();
  const r = t.receivables.ui;
  const errorText = useRecvErrorText();
  const f = useFormatters();
  const [summary, setSummary] = useState<{ currencies: Cur[] } | null>(null);
  const [error, setError] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [items, setItems] = useState<Inv[] | null>(null);
  const [total, setTotal] = useState(0);
  const [remind, setRemind] = useState<ReminderTarget | null>(null);
  const [linking, setLinking] = useState<Inv | null>(null);

  const loadSummary = useCallback(async () => {
    const res = await callApi("GET", "/api/receivables/summary");
    if (!res.ok) return setError(errorText(res.data));
    setSummary(res.data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const loadInvoices = useCallback(async (offset: number, replace: boolean) => {
    const res = await callApi("GET", `/api/receivables/invoices?limit=${PAGE}&offset=${offset}${overdueOnly ? "&overdue=1" : ""}`);
    if (!res.ok) return setError(errorText(res.data));
    setTotal(res.data.total);
    setItems((cur) => (replace || !cur ? res.data.items : [...cur, ...res.data.items]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overdueOnly]);

  useEffect(() => { loadSummary(); }, [loadSummary]);
  useEffect(() => { setItems(null); loadInvoices(0, true); }, [loadInvoices]);
  const refresh = () => { loadSummary(); loadInvoices(0, true); };

  if (error) return <p role="alert" className="text-sm text-rose-600">{error}</p>;
  if (!summary || items === null) return <div className="py-12 flex items-center justify-center text-ringo-muted"><Loader2 size={20} className="animate-spin" /><span className="sr-only">{r.loading}</span></div>;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1 max-w-2xl">
          <h1 className="font-display text-2xl font-medium text-ringo-text tracking-[-0.01em]">{r.title}</h1>
          <p className="text-sm text-ringo-muted">{r.intro}</p>
        </div>
        <Link href="/dashboard/documents/new?credit=1" className={primaryButton}><Plus size={15} />{r.newCreditSale}</Link>
      </div>

      {summary.currencies.length === 0 ? (
        <p className="text-sm text-ringo-muted rounded-2xl border border-ringo-border/70 bg-ringo-surface p-5">{r.empty}</p>
      ) : (
        summary.currencies.map((c) => (
          <section key={c.currency} className="rounded-2xl border border-ringo-border/70 bg-ringo-surface p-4 sm:p-5 flex flex-col gap-4" aria-label={c.currency}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="rounded-xl bg-ringo-muted/5 p-4">
                <p className="text-xs text-ringo-muted">{r.outstandingBalance} · {c.currency}</p>
                <p className="font-display text-2xl text-ringo-text tabular-nums">{f.money(c.outstanding_minor, c.currency)}</p>
                <p className="text-xs text-ringo-muted">{r.invoiceCount(c.invoice_count)}</p>
              </div>
              <div className="rounded-xl bg-rose-500/5 p-4">
                <p className="text-xs text-ringo-muted">{r.overdue} · {c.currency}</p>
                <p className="font-display text-2xl text-rose-700 dark:text-rose-400 tabular-nums">{f.money(c.overdue_minor, c.currency)}</p>
                <p className="text-xs text-ringo-muted">{r.overdueCount(c.overdue_count)}</p>
              </div>
            </div>
            <div>
              <p className="text-xs font-medium text-ringo-muted mb-2">{r.agingTitle}</p>
              <ul className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {AGING_ORDER.map((k) => (
                  <li key={k} className="rounded-card border border-ringo-border/60 px-3 py-2 text-xs">
                    <span className="text-ringo-muted block">{r.aging[k]}</span>
                    <span className="tabular-nums text-ringo-text text-sm">{f.money(c.aging[k]?.amount_minor ?? 0, c.currency)}</span>
                    <span className="text-ringo-muted"> · {c.aging[k]?.count ?? 0}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs font-medium text-ringo-muted mb-2">{r.byCustomer}</p>
              <ul className="flex flex-col gap-2">
                {c.customers.map((x) => (
                  <li key={x.customer_id} className="flex items-center justify-between gap-3 rounded-card border border-ringo-border/60 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ringo-text truncate">{x.name}</p>
                      <p className="text-xs text-ringo-muted">
                        {r.invoiceCount(x.invoice_count)}{x.oldest_due_date ? ` · ${r.dueOn(f.day(x.oldest_due_date))}` : ""}
                        {x.auto_paused ? ` · ${r.pausedBadge}` : ""}{x.last_reminder_at ? ` · ${r.lastReminder(f.when(x.last_reminder_at))}` : ""}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm tabular-nums text-ringo-text">{f.money(x.outstanding_minor, c.currency)}</p>
                      {x.overdue_minor > 0 && <p className="text-xs tabular-nums text-rose-600">{r.overdue}: {f.money(x.overdue_minor, c.currency)}</p>}
                      <Link href={`/dashboard/documents/receivables/contacts/${x.customer_id}`} className="text-xs text-ringo-indigo hover:underline">{r.viewStatement}</Link>
                    </div>
                  </li>
                ))}
                {c.unassigned.invoice_count > 0 && (
                  <li className="flex items-center justify-between gap-3 rounded-card border border-dashed border-ringo-border px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ringo-text">{r.unassigned}</p>
                      <p className="text-xs text-ringo-muted">{r.invoiceCount(c.unassigned.invoice_count)} · {r.unassignedHint}</p>
                    </div>
                    <p className="text-sm tabular-nums text-ringo-text shrink-0">{f.money(c.unassigned.outstanding_minor, c.currency)}</p>
                  </li>
                )}
              </ul>
            </div>
          </section>
        ))
      )}
      <p className="text-xs text-ringo-muted">{r.currencyNote} {r.uncollectedNote}</p>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-ringo-text">{r.invoicesTitle}</h2>
          <div className="flex gap-2" role="group" aria-label={r.invoicesTitle}>
            <button type="button" aria-pressed={!overdueOnly} onClick={() => setOverdueOnly(false)} className={!overdueOnly ? primaryButton : secondaryButton}>{r.filterAll}</button>
            <button type="button" aria-pressed={overdueOnly} onClick={() => setOverdueOnly(true)} className={overdueOnly ? primaryButton : secondaryButton}>{r.filterOverdue}</button>
          </div>
        </div>
        {items.length === 0 ? <p className="text-sm text-ringo-muted">{r.empty}</p> : (
          <ul className="flex flex-col gap-2">
            {items.map((i) => (
              <li key={i.id} className="rounded-2xl border border-ringo-border/70 bg-ringo-surface p-3 sm:p-4 flex flex-col gap-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/dashboard/documents/${i.id}`} className="text-sm font-medium text-ringo-text hover:underline">{i.number}</Link>
                    <p className="text-xs text-ringo-muted truncate">{i.customer_name ?? "—"}{!i.linked ? ` · ${r.unlinked}` : ""}</p>
                    <p className={`text-xs ${i.overdue ? "text-rose-600" : "text-ringo-muted"}`}>{i.due_date ? r.dueOn(f.day(i.due_date)) : r.noDueDate}{i.overdue ? ` · ${r.daysLate(i.days_overdue)}` : ""}</p>
                    <p className="text-xs text-ringo-muted">{i.last_reminder_at ? r.lastReminder(f.when(i.last_reminder_at)) : r.noReminderYet}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-ringo-muted">{r.amountDue}</p>
                    <p className="text-base tabular-nums font-medium text-ringo-text">{f.money(i.amount_due_minor, i.currency)}</p>
                  </div>
                </div>
                {!i.can_record_payment && <p className="text-xs text-amber-700 dark:text-amber-400">{r.currencyBlocked}</p>}
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => setRemind({ id: i.id, number: i.number, hasEmail: i.has_email, hasPhone: i.has_phone })} className={secondaryButton}><BellRing size={15} />{r.remind}</button>
                  <button onClick={() => setLinking(i)} className={secondaryButton}><Link2 size={15} />{i.linked ? r.changeCustomer : r.linkCustomer}</button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {items.length < total && <button onClick={() => loadInvoices(items.length, false)} className={`${secondaryButton} self-center`}>{r.loadMore}</button>}
      </section>

      {remind && <ReminderModal target={remind} onClose={() => setRemind(null)} onDone={refresh} />}
      {linking && <LinkCustomerModal documentId={linking.id} currentName={linking.linked ? linking.customer_name : null} invoiceCustomer={{ name: linking.customer_name }} onClose={() => setLinking(null)} onDone={refresh} />}
    </div>
  );
}
