"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { callApi, StatusBadge, useFormatters, useRecvErrorText } from "./shared";

type Inv = { id: string; number: string | null; status: string; currency: string; total_minor: number; amount_paid_minor: number; amount_due_minor: number; due_date: string | null; overdue: boolean };
type Pay = { id: string; invoice_number: string | null; receipt_number: string | null; amount_minor: number; currency: string; method: string; reference: string | null; paid_on: string; voided: boolean };
type Statement = {
  customer: { id: string; name: string; phone: string | null; email: string | null; notes: string | null; auto_reminders_paused: boolean; archived: boolean };
  invoices: Inv[]; payments: Pay[]; totals: { currency: string; outstanding_minor: number; overdue_minor: number }[];
};

/** One contact's statement: their invoices, the payments the business recorded (voided ones marked), and the Outstanding Balance per currency. */
export default function StatementView({ id }: { id: string }) {
  const { t } = useLanguage();
  const r = t.receivables.ui;
  const errorText = useRecvErrorText();
  const f = useFormatters();
  const [data, setData] = useState<Statement | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const res = await callApi("GET", `/api/receivables/customers/${encodeURIComponent(id)}`);
      if (!res.ok) return setError(errorText(res.data));
      setData(res.data);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (error) return <div className="flex flex-col gap-3 items-start"><p role="alert" className="text-sm text-rose-600">{error}</p><Link href="/dashboard/documents/receivables/contacts" className="text-sm text-ringo-indigo hover:underline">{r.back}</Link></div>;
  if (!data) return <div className="py-12 flex items-center justify-center text-ringo-muted"><Loader2 size={20} className="animate-spin" /><span className="sr-only">{r.loading}</span></div>;
  const c = data.customer;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <Link href="/dashboard/documents/receivables/contacts" className="text-sm text-ringo-muted hover:text-ringo-text w-fit">← {r.back}</Link>
        <h1 className="font-display text-2xl font-medium text-ringo-text tracking-[-0.01em]">{r.statementTitle(c.name)}</h1>
        <p className="text-sm text-ringo-muted break-words">{[c.phone, c.email].filter(Boolean).join(" · ")}</p>
        {c.auto_reminders_paused && <p className="text-xs text-amber-700 dark:text-amber-400">{r.pausedBadge}</p>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {data.totals.length === 0 ? <p className="text-sm text-ringo-muted">{r.empty}</p> : data.totals.map((x) => (
          <div key={x.currency} className="rounded-2xl border border-ringo-border/70 bg-ringo-surface p-4">
            <p className="text-xs text-ringo-muted">{r.totalOutstanding} · {x.currency}</p>
            <p className="font-display text-2xl text-ringo-text tabular-nums">{f.money(x.outstanding_minor, x.currency)}</p>
            {x.overdue_minor > 0 && <p className="text-xs text-rose-600 tabular-nums">{r.overdue}: {f.money(x.overdue_minor, x.currency)}</p>}
          </div>
        ))}
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-ringo-text">{r.invoicesSection}</h2>
        <ul className="flex flex-col gap-2">
          {data.invoices.map((i) => (
            <li key={i.id} className="rounded-2xl border border-ringo-border/70 bg-ringo-surface p-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link href={`/dashboard/documents/${i.id}`} className="text-sm font-medium text-ringo-text hover:underline">{i.number}</Link>
                <div className="mt-1"><StatusBadge status={i.status} overdue={i.overdue} /></div>
                <p className="text-xs text-ringo-muted">{i.due_date ? r.dueOn(f.day(i.due_date)) : r.noDueDate}</p>
              </div>
              <div className="text-right shrink-0 text-xs text-ringo-muted">
                <p>{r.total}: <span className="tabular-nums text-ringo-text">{f.money(i.total_minor, i.currency)}</span></p>
                <p>{r.paid}: <span className="tabular-nums text-ringo-text">{f.money(i.amount_paid_minor, i.currency)}</span></p>
                <p>{r.amountDue}: <span className="tabular-nums text-ringo-text font-medium">{f.money(i.amount_due_minor, i.currency)}</span></p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-ringo-text">{r.paymentsSection}</h2>
        <p className="text-xs text-ringo-muted">{r.paymentsNote}</p>
        {data.payments.length === 0 ? <p className="text-sm text-ringo-muted">{r.noPayments}</p> : (
          <ul className="flex flex-col gap-2">
            {data.payments.map((p) => (
              <li key={p.id} className={`rounded-2xl border border-ringo-border/70 bg-ringo-surface p-3 flex items-start justify-between gap-3 ${p.voided ? "opacity-60" : ""}`}>
                <div className="min-w-0 text-xs text-ringo-muted">
                  <p className="text-sm text-ringo-text">{p.invoice_number} · {f.day(p.paid_on)}{p.voided ? ` · ${r.voidedPayment}` : ""}</p>
                  <p>{t.documents.pdf.methods[p.method] ?? p.method}{p.reference ? ` · ${p.reference}` : ""}{p.receipt_number ? ` · ${r.receiptLabel} ${p.receipt_number}` : ""}</p>
                </div>
                <p className={`text-sm tabular-nums shrink-0 ${p.voided ? "line-through" : "text-ringo-text"}`}>{f.money(p.amount_minor, p.currency)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
