"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { STATEMENT_LIMITS } from "@/lib/customers/constants";
import type { CustomerTotals, TimelineItem } from "@/lib/customers/profile";
import CustomerForm from "./CustomerForm";
import PossibleOrders from "./PossibleOrders";
import { StatusBadge, callApi, dangerButton, primaryButton, secondaryButton, useCustErrorText, useFormatters } from "./shared";

type Inv = { id: string; number: string | null; status: string; currency: string; total_minor: number; amount_paid_minor: number; amount_due_minor: number; issue_date: string | null; due_date: string | null; overdue: boolean };
type Pay = { id: string; invoice_number: string | null; receipt_number: string | null; amount_minor: number; currency: string; method: string; paid_on: string; voided: boolean };
type Profile = {
  customer: { id: string; name: string; phone: string | null; email: string | null; notes: string | null; auto_reminders_paused: boolean; archived: boolean };
  invoices: Inv[]; payments: Pay[]; totals: CustomerTotals[]; truncated: { invoices: boolean; payments: boolean };
  timeline: TimelineItem[]; timeline_truncated: boolean; timeline_partial: boolean; last_activity_date: string | null;
};

/** One customer: contact details, the existing Phase 3 statement (invoices, payments, Outstanding, Overdue), per-currency totals, an activity timeline,
 * and - on request - possible matching Shop orders. Read-only: edits use the Phase 3 contact endpoints. */
export default function CustomerProfileView({ id }: { id: string }) {
  const { t } = useLanguage();
  const p = t.customers.profile;
  const errorText = useCustErrorText();
  const f = useFormatters();
  const [data, setData] = useState<Profile | null>(null);
  const [errorData, setErrorData] = useState<any>(null);
  const error = errorData ? errorText(errorData) : "";
  const [notFound, setNotFound] = useState(false);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    const res = await callApi("GET", `/api/customers/${encodeURIComponent(id)}`);
    if (!res.ok) {
      if (res.status === 404) return setNotFound(true);
      return setErrorData(res.data);
    }
    setErrorData(null);
    setData(res.data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const act = async (url: string, body: unknown) => {
    setErrorData(null);
    const res = await callApi("POST", url, body);
    if (!res.ok) return setErrorData(res.data);
    load();
  };

  const back = <Link href="/dashboard/customers" className="inline-flex items-center gap-1.5 text-sm text-ringo-muted hover:text-ringo-text"><ArrowLeft size={14} />{p.back}</Link>;
  if (notFound) return <div className="flex flex-col gap-4">{back}<p className="text-sm text-ringo-muted">{p.notFound}</p></div>;
  if (!data) {
    return (
      <div className="flex flex-col gap-4">
        {back}
        {error ? (
          <div role="alert" className="flex flex-col gap-2 rounded-card bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-400"><p>{error}</p><div><button className={secondaryButton} onClick={load}>{t.customers.ui.retry}</button></div></div>
        ) : <p className="flex items-center gap-2 text-sm text-ringo-muted"><Loader2 size={14} className="animate-spin" />{t.customers.ui.loading}</p>}
      </div>
    );
  }

  const c = data.customer;
  const describe = (it: TimelineItem): { text: string; amount?: string } => {
    if (it.type === "event") return { text: `${p.events[it.event_type] ?? it.event_type}${it.document_number ? ` (${it.document_number})` : ""}` };
    if (it.type === "invoice") return { text: p.invoiceIssued(it.number ?? "—"), amount: f.money(it.total_minor, it.currency) };
    if (it.type === "payment") return { text: (it.voided ? p.paymentVoided : p.paymentRecorded)(it.invoice_number ?? "—"), amount: f.money(it.amount_minor, it.currency) };
    return { text: p.reminderLine(p.reminderKinds[it.kind] ?? it.kind, p.reminderChannels[it.channel] ?? it.channel, p.reminderStatuses[it.status] ?? it.status, it.document_number ?? "") };
  };
  const atLabel = (at: string) => (/^\d{4}-\d{2}-\d{2}$/.test(at) ? f.day(at) : f.when(at));

  return (
    <div className="flex flex-col gap-5">
      {back}
      {error && <p role="alert" className="rounded-card bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-400">{error}</p>}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="break-words font-display text-xl font-medium text-ringo-text">{c.name}</h1>
          <p className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
            {c.archived && <span className="rounded-full bg-ringo-muted/15 px-2 py-0.5 text-ringo-muted">{p.archivedBadge}</span>}
            {c.auto_reminders_paused && <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-amber-700 dark:text-amber-400">{p.pausedBadge}</span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!c.archived && <button className={secondaryButton} onClick={() => setEditing(true)}>{p.edit}</button>}
          {!c.archived && <button className={secondaryButton} onClick={() => act(`/api/receivables/customers/${c.id}/pause`, { paused: !c.auto_reminders_paused })}>{c.auto_reminders_paused ? p.resume : p.pause}</button>}
          <button className={c.archived ? primaryButton : dangerButton} onClick={() => act(`/api/receivables/customers/${c.id}/archive`, { archived: !c.archived })}>{c.archived ? p.restore : p.archive}</button>
        </div>
      </div>

      <section className="flex flex-col gap-2 rounded-card border border-ringo-border p-4">
        <h2 className="font-display text-base font-medium text-ringo-text">{p.contactTitle}</h2>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div><dt className="text-xs text-ringo-muted">{p.phone}</dt><dd className="break-words text-ringo-text">{c.phone || p.noValue}</dd></div>
          <div><dt className="text-xs text-ringo-muted">{p.email}</dt><dd className="break-words text-ringo-text">{c.email || p.noValue}</dd></div>
          <div className="sm:col-span-2"><dt className="text-xs text-ringo-muted">{p.notes}</dt><dd className="whitespace-pre-wrap break-words text-ringo-text">{c.notes || p.noValue}</dd></div>
        </dl>
        <Link href={`/dashboard/documents/receivables/contacts/${c.id}`} className="w-fit ringo-tactile inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-ringo-border px-4 text-xs font-semibold text-ringo-indigo hover:border-ringo-indigo/40 hover:bg-ringo-indigo/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/40">{p.statementLink}</Link>
      </section>

      <section className="flex flex-col gap-3 rounded-card border border-ringo-border p-4">
        <h2 className="font-display text-base font-medium text-ringo-text">{p.totalsTitle}</h2>
        {(data.truncated.invoices) && <p className="rounded-card bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">{p.truncatedInvoices(STATEMENT_LIMITS.invoices)}</p>}
        {data.totals.length === 0 && <p className="text-sm text-ringo-muted">{p.none}</p>}
        {data.totals.map((tt) => (
          <div key={tt.currency} className="flex flex-col gap-2 rounded-card border border-ringo-border p-3">
            <p className="text-xs font-medium text-ringo-muted">{tt.currency}</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label={p.invoiced} value={f.money(tt.invoiced_minor, tt.currency)} />
              <Stat label={p.paymentsReceived} value={f.money(tt.payments_received_minor, tt.currency)} />
              <Stat label={p.outstanding} value={f.money(tt.outstanding_minor, tt.currency)} />
              <Stat label={p.overdue} value={f.money(tt.overdue_minor, tt.currency)} />
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs text-ringo-muted sm:grid-cols-4">
              <span>{p.invoiceCount}: {tt.invoice_count}</span>
              <span>{p.paymentCount}: {tt.payment_count}</span>
              <span>{p.lastInvoice}: {tt.last_invoice_date ? f.day(tt.last_invoice_date) : p.none}</span>
              <span>{p.lastPayment}: {tt.last_payment_date ? f.day(tt.last_payment_date) : p.none}</span>
            </div>
          </div>
        ))}
        <p className="text-xs text-ringo-muted">{p.lastActivity}: {data.last_activity_date ? f.day(data.last_activity_date) : p.none}</p>
        <p className="text-xs leading-snug text-ringo-muted">{p.totalsNote}</p>
      </section>

      <section className="flex flex-col gap-2 rounded-card border border-ringo-border p-4">
        <h2 className="font-display text-base font-medium text-ringo-text">{p.invoicesTitle}</h2>
        {data.invoices.length === 0 && <p className="text-sm text-ringo-muted">{p.noInvoices}</p>}
        <ul className="flex flex-col gap-2">
          {data.invoices.map((i) => (
            <li key={i.id} className="flex flex-col gap-1 rounded-card border border-ringo-border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link href={`/dashboard/documents/${i.id}`} className="font-medium text-ringo-text hover:underline">{i.number ?? "—"}</Link>
                <StatusBadge status={i.status} overdue={i.overdue} />
              </div>
              <p className="text-xs text-ringo-muted">{[i.issue_date ? f.day(i.issue_date) : null, i.due_date ? p.dueOn(f.day(i.due_date)) : null].filter(Boolean).join(" · ")}</p>
              <p className="text-xs text-ringo-muted">{p.total}: {f.money(i.total_minor, i.currency)} · {p.paid}: {f.money(i.amount_paid_minor, i.currency)}{i.amount_due_minor > 0 ? ` · ${p.amountDue}: ${f.money(i.amount_due_minor, i.currency)}` : ""}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2 rounded-card border border-ringo-border p-4">
        <h2 className="font-display text-base font-medium text-ringo-text">{p.paymentsTitle}</h2>
        {data.truncated.payments && <p className="rounded-card bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">{p.truncatedPayments(STATEMENT_LIMITS.payments)}</p>}
        {data.payments.length === 0 && <p className="text-sm text-ringo-muted">{p.noPayments}</p>}
        <ul className="flex flex-col gap-2">
          {data.payments.map((x) => (
            <li key={x.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-card border border-ringo-border p-3 text-sm ${x.voided ? "opacity-60" : ""}`}>
              <span className="text-ringo-text">{f.day(x.paid_on)} · {x.invoice_number ?? "—"}{x.receipt_number ? ` · ${p.receipt} ${x.receipt_number}` : ""}{x.voided ? ` · ${p.voidedPayment}` : ""}</span>
              <span className="whitespace-nowrap font-medium text-ringo-text">{f.money(x.amount_minor, x.currency)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2 rounded-card border border-ringo-border p-4">
        <h2 className="font-display text-base font-medium text-ringo-text">{p.timelineTitle}</h2>
        {data.timeline_partial && <p className="text-xs text-amber-800 dark:text-amber-300">{p.timelinePartial}</p>}
        {data.timeline.length === 0 && <p className="text-sm text-ringo-muted">{p.timelineEmpty}</p>}
        <ol className="flex flex-col border-l border-ringo-border pl-4">
          {data.timeline.map((it) => {
            const d = describe(it);
            return (
              <li key={`${it.type}-${it.id}`} className="relative pb-3 text-sm last:pb-0">
                <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-ringo-indigo" aria-hidden="true" />
                <p className="text-xs text-ringo-muted">{atLabel(it.at)}</p>
                <p className="break-words text-ringo-text">{d.text}{d.amount ? <span className="text-ringo-muted"> · {d.amount}</span> : null}</p>
              </li>
            );
          })}
        </ol>
        {data.timeline_truncated && <p className="text-xs text-ringo-muted">{p.timelineTruncated(data.timeline.length)}</p>}
      </section>

      <PossibleOrders customerId={c.id} />

      {editing && <CustomerForm customer={{ id: c.id, name: c.name, phone: c.phone, email: c.email, notes: c.notes }} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load(); }} />}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-ringo-muted">{label}</p>
      <p className="mt-0.5 text-base font-medium text-ringo-text">{value}</p>
    </div>
  );
}
