"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, Loader2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { formatDateKey, formatMoney, formatQuantityMilli } from "@/lib/documents/moneyFormat";
import type { DocumentModel, LineModel, PartyModel } from "@/lib/documents/types";
import { ReasonModal } from "./DocModals";
import DocumentActions from "./DocumentActions";
import { ShareButton } from "./ShareModal";
import { StatusBadge, callApi, downloadPdf, secondaryButton, useErrorText } from "./shared";

type PaymentView = { id: string; receipt_document_id: string; receipt_number: string | null; receipt_status: string | null; amount_minor: number; balance_after_minor: number; method: string; reference: string | null; paid_on: string; recorded_at: string; voided: boolean; void_reason: string | null; can_void: boolean };
type View = {
  id: string; doc_type: "invoice" | "receipt"; status: string; model: DocumentModel; balance_minor: number; overdue: boolean; created_at: string; voided_at: string | null; void_reason: string | null;
  replaced_by: { id: string; number: string } | null; replaces_document_id: string | null; parent: { id: string; number: string } | null; payments: PaymentView[];
  events: { event_type: string; created_at: string }[]; actions: any;
};

// One document (invoice or payment receipt), read-only, with the actions its state allows. All amounts are exact minor units from the
// server. Payments are always described as RECORDED BY THE BUSINESS: nothing on this screen says or implies Ringo verified them.
export default function DocumentView({ id }: { id: string }) {
  const { t } = useLanguage();
  const u = t.documents.ui;
  const router = useRouter();
  const errorText = useErrorText();
  const [view, setView] = useState<View | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    const r = await callApi("GET", `/api/documents/${encodeURIComponent(id)}`);
    setLoading(false);
    if (!r.ok) return setError(r.status === 404 ? u.notFound : errorText(r.data));
    setView(r.data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="py-12 flex items-center justify-center text-ringo-muted"><Loader2 size={20} className="animate-spin" /><span className="sr-only">{u.loading}</span></div>;
  if (error || !view) return <div className="flex flex-col items-start gap-3"><p role="alert" className="text-sm text-rose-600">{error || u.notFound}</p><Link href="/dashboard/documents" className={secondaryButton}>{u.back}</Link></div>;
  return view.doc_type === "receipt" ? <ReceiptBody view={view} /> : <InvoiceBody view={view} reload={load} gone={() => router.push("/dashboard/documents")} />;
}

// ------------------------------------------------------------------------------------------------- shared bits
function PartyBlock({ title, p, seller }: { title: string; p: PartyModel; seller: boolean }) {
  const { t } = useLanguage();
  return (
    <div className="min-w-0 flex flex-col gap-0.5 text-sm">
      <h3 className="text-xs font-medium text-ringo-muted mb-1">{title}</h3>
      <p className="font-medium text-ringo-text break-words">{p.name || "—"}</p>
      {seller && p.legalName && p.legalName !== p.name && <p className="text-ringo-muted break-words">{p.legalName}</p>}
      {p.address && <p className="text-ringo-muted whitespace-pre-line break-words">{p.address}</p>}
      {p.phone && <p className="text-ringo-muted break-words">{p.phone}</p>}
      {p.email && <p className="text-ringo-muted break-words">{p.email}</p>}
      {p.taxId && <p className="text-ringo-muted break-words">{t.documents.pdf.taxId}: {p.taxId}</p>}
      {seller && p.registrationNo && <p className="text-ringo-muted break-words">{t.documents.pdf.registrationNo}: {p.registrationNo}</p>}
    </div>
  );
}

function VoidBanner({ view }: { view: View }) {
  const { t } = useLanguage();
  const u = t.documents.ui;
  return (
    <div role="status" className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-4 text-sm flex flex-col gap-1">
      <p className="font-medium text-rose-700 dark:text-rose-400">{u.voidedBanner}</p>
      {view.void_reason && <p className="text-ringo-muted break-words">{u.voidedReason(view.void_reason)}</p>}
      {view.replaced_by && <Link href={`/dashboard/documents/${view.replaced_by.id}`} className="text-ringo-indigo hover:underline w-fit">{u.replacedBy(view.replaced_by.number)}</Link>}
    </div>
  );
}

function Card({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <section className="rounded-2xl border border-ringo-border/70 bg-ringo-surface p-4 sm:p-5 flex flex-col gap-3">
      {title && <h2 className="text-sm font-medium text-ringo-text">{title}</h2>}
      {children}
    </section>
  );
}

function Pdf({ id, label }: { id: string; label: string }) {
  const { t } = useLanguage();
  const errorText = useErrorText();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  return (
    <div className="flex flex-col gap-1">
      <button onClick={async () => { setBusy(true); setMsg(""); const err = await downloadPdf(id); setBusy(false); if (err) setMsg(errorText(err) || t.documents.ui.downloadFailed); }} disabled={busy} className={secondaryButton}>
        {busy ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}{label}
      </button>
      {msg && <p role="alert" className="text-xs text-rose-600">{msg}</p>}
    </div>
  );
}

function ItemsList({ lines, m, showMoney }: { lines: LineModel[]; m: DocumentModel; showMoney: boolean }) {
  const { t, locale } = useLanguage();
  const u = t.documents.ui;
  return (
    <ul className="flex flex-col divide-y divide-ringo-border/50">
      {lines.map((l) => (
        <li key={l.position} className="py-2.5 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-1 sm:gap-4 text-sm">
          <div className="min-w-0">
            <p className="text-ringo-text whitespace-pre-line break-words">{l.description}</p>
            {showMoney && (
              <p className="text-xs text-ringo-muted tabular-nums">
                {formatQuantityMilli(l.quantityMilli, locale)} × {formatMoney(l.unitPriceMinor, m.currency, locale)}
                {l.discountMinor > 0 ? ` · ${u.lineDiscount}: -${formatMoney(l.discountMinor, m.currency, locale)}` : ""}
                {m.taxRateBp !== null && l.taxMinor > 0 ? ` · ${u.taxTotal}: ${formatMoney(l.taxMinor, m.currency, locale)}` : ""}
              </p>
            )}
          </div>
          <p className="tabular-nums font-medium text-ringo-text shrink-0">{formatMoney(showMoney ? l.totalMinor : l.grossMinor, m.currency, locale)}</p>
        </li>
      ))}
    </ul>
  );
}

function Fig({ label, value, tone }: { label: string; value: string; tone?: "strong" | "accent" }) {
  return (
    <div className="rounded-xl border border-ringo-border/60 p-3 min-w-0">
      <p className="text-xs text-ringo-muted">{label}</p>
      <p className={`text-base tabular-nums break-words ${tone === "accent" ? "font-semibold text-ringo-indigo" : tone === "strong" ? "font-semibold text-ringo-text" : "text-ringo-text"}`}>{value}</p>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------- invoice
function InvoiceBody({ view, reload, gone }: { view: View; reload: () => void; gone: () => void }) {
  const { t, locale } = useLanguage();
  const u = t.documents.ui;
  const errorText = useErrorText();
  const m = view.model;
  const [voidPay, setVoidPay] = useState<PaymentView | null>(null);
  const isDraft = view.status === "draft";

  return (
    <div className="flex flex-col gap-5 max-w-3xl">
      <div className="flex flex-col gap-2">
        <Link href="/dashboard/documents" className="text-sm text-ringo-muted hover:text-ringo-text w-fit">← {u.back}</Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-2xl font-medium text-ringo-text tracking-[-0.01em] break-words">{m.number ? `${u.invoiceHeading} ${m.number}` : `${u.invoiceHeading} · ${u.draftLabel}`}</h1>
          <StatusBadge status={view.status} overdue={view.overdue} />
        </div>
        {view.replaces_document_id && <p className="text-sm text-ringo-muted">{u.correctsInvoice}</p>}
      </div>

      {view.status === "void" && <VoidBanner view={view} />}

      <DocumentActions
        doc={{ id: view.id, number: m.number, currency: m.currency, balanceMinor: view.balance_minor, issueDate: m.issueDate }}
        actions={view.actions} onChanged={reload} onGone={gone}
      />

      <Card>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <PartyBlock title={u.from} p={m.seller} seller />
          <PartyBlock title={u.billedTo} p={m.customer} seller={false} />
        </div>
        <dl className="grid grid-cols-2 gap-3 text-sm pt-1">
          <div><dt className="text-xs text-ringo-muted">{t.documents.pdf.issueDate}</dt><dd className="text-ringo-text">{m.issueDate ? formatDateKey(m.issueDate, locale) : "—"}</dd></div>
          <div><dt className="text-xs text-ringo-muted">{t.documents.pdf.dueDate}</dt><dd className="text-ringo-text">{m.dueDate ? formatDateKey(m.dueDate, locale) : "—"}</dd></div>
        </dl>
      </Card>

      <Card title={u.items}>
        <ItemsList lines={m.lines} m={m} showMoney />
        <div className="flex flex-col gap-1.5 text-sm pt-2 border-t border-ringo-border/60">
          <SumRow label={u.subtotal} value={formatMoney(m.subtotalMinor, m.currency, locale)} />
          {m.discountMinor > 0 && <SumRow label={u.discountTotal} value={`-${formatMoney(m.discountMinor, m.currency, locale)}`} />}
          {m.taxRateBp !== null && <SumRow label={m.taxLabel || u.taxTotal} value={formatMoney(m.taxMinor, m.currency, locale)} />}
          <SumRow label={u.totalDue} value={formatMoney(m.totalMinor, m.currency, locale)} strong />
        </div>
      </Card>

      {!isDraft && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Fig label={u.invoiceTotal} value={formatMoney(m.totalMinor, m.currency, locale)} tone="strong" />
          <Fig label={u.amountReceived} value={formatMoney(m.amountPaidMinor, m.currency, locale)} />
          <Fig label={u.balanceOutstanding} value={view.status === "void" ? "—" : formatMoney(view.balance_minor, m.currency, locale)} tone="accent" />
        </div>
      )}

      {!isDraft && (
        <Card title={u.payments}>
          {view.payments.length === 0 ? <p className="text-sm text-ringo-muted">{u.noPayments}</p> : (
            <ul className="flex flex-col gap-3">
              {view.payments.map((p) => (
                <li key={p.id} className={`rounded-xl border border-ringo-border/60 p-3 flex flex-col gap-2 ${p.voided ? "opacity-60" : ""}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className={`font-medium tabular-nums ${p.voided ? "line-through" : ""}`}>{formatMoney(p.amount_minor, m.currency, locale)}</p>
                    {p.voided && <StatusBadge status="void" />}
                  </div>
                  <p className="text-xs text-ringo-muted">{u.recordedByBusiness}</p>
                  <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <div><dt className="text-ringo-muted">{u.paymentDate}</dt><dd className="text-ringo-text">{formatDateKey(p.paid_on, locale)}</dd></div>
                    <div><dt className="text-ringo-muted">{u.paymentMethod}</dt><dd className="text-ringo-text">{t.documents.pdf.methods[p.method] ?? p.method}</dd></div>
                    <div><dt className="text-ringo-muted">{u.reference}</dt><dd className="text-ringo-text break-words">{p.reference || "—"}</dd></div>
                    <div><dt className="text-ringo-muted">{u.balanceAfter}</dt><dd className="text-ringo-text tabular-nums">{formatMoney(p.balance_after_minor, m.currency, locale)}</dd></div>
                  </dl>
                  {p.voided && p.void_reason && <p className="text-xs text-ringo-muted break-words">{u.voidedReason(p.void_reason)}</p>}
                  <div className="flex flex-wrap gap-2">
                    {p.receipt_number && <Link href={`/dashboard/documents/${p.receipt_document_id}`} className={secondaryButton}>{u.viewReceipt} · {p.receipt_number}</Link>}
                    {p.receipt_number && <Pdf id={p.receipt_document_id} label={u.downloadReceipt} />}
                    {p.can_void && <button onClick={() => setVoidPay(p)} className="inline-flex min-h-[44px] items-center rounded-card border border-rose-500/40 px-4 py-2 text-sm font-medium text-rose-700 dark:text-rose-400 hover:bg-rose-500/10">{u.voidPayment}</button>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {(m.notes || m.terms) && (
        <Card>
          {m.notes && <div><h3 className="text-xs font-medium text-ringo-muted mb-1">{u.notes}</h3><p className="text-sm text-ringo-text whitespace-pre-line break-words">{m.notes}</p></div>}
          {m.terms && <div><h3 className="text-xs font-medium text-ringo-muted mb-1">{u.terms}</h3><p className="text-sm text-ringo-text whitespace-pre-line break-words">{m.terms}</p></div>}
        </Card>
      )}

      {view.events.length > 0 && (
        <Card title={u.history}>
          <ul className="flex flex-col gap-1.5 text-sm">
            {view.events.map((e, i) => (
              e.event_type in u.events ? (
                <li key={i} className="flex items-center justify-between gap-3">
                  <span className="text-ringo-text">{u.events[e.event_type]}</span>
                  <span className="text-xs text-ringo-muted tabular-nums">{new Date(e.created_at).toLocaleString(locale === "fr" ? "fr-FR" : "en-GB", { dateStyle: "medium", timeStyle: "short" })}</span>
                </li>
              ) : null
            ))}
          </ul>
        </Card>
      )}

      {voidPay && (
        <ReasonModal title={u.voidPaymentTitle} body={u.voidPaymentBody} confirmLabel={u.voidPayment} onClose={() => setVoidPay(null)}
          onConfirm={async (reason) => {
            const r = await callApi("POST", `/api/documents/payments/${encodeURIComponent(voidPay.id)}/void`, { reason });
            if (!r.ok) return errorText(r.data);
            setVoidPay(null);
            reload();
            return null;
          }} />
      )}
    </div>
  );
}

function SumRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-3 ${strong ? "text-base font-medium text-ringo-text" : "text-ringo-muted"}`}>
      <span className="break-words min-w-0">{label}</span>
      <span className="tabular-nums shrink-0">{value}</span>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------- receipt (RCT-)
function ReceiptBody({ view }: { view: View }) {
  const { t, locale } = useLanguage();
  const u = t.documents.ui;
  const m = view.model;
  const p = m.payment;
  return (
    <div className="flex flex-col gap-5 max-w-2xl">
      <div className="flex flex-col gap-2">
        <Link href={view.parent ? `/dashboard/documents/${view.parent.id}` : "/dashboard/documents"} className="text-sm text-ringo-muted hover:text-ringo-text w-fit">← {view.parent ? `${u.forInvoice} ${view.parent.number}` : u.back}</Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-2xl font-medium text-ringo-text tracking-[-0.01em] break-words">{u.receiptHeading} {m.number}</h1>
          <StatusBadge status={view.status} />
        </div>
      </div>

      {view.status === "void" && <VoidBanner view={view} />}

      <Card>
        {/* This is the sentence that matters: a receipt for a payment the business recorded, never a Ringo-verified payment. */}
        <p className="text-sm font-medium text-ringo-text">{u.recordedByBusiness}</p>
        {p && (
          <>
            <div className="rounded-xl border border-ringo-border/60 p-4">
              <p className="text-xs text-ringo-muted">{u.amountReceived}</p>
              <p className={`text-2xl font-semibold tabular-nums break-words ${view.status === "void" ? "line-through text-ringo-muted" : "text-ringo-indigo"}`}>{formatMoney(p.amountMinor, m.currency, locale)}</p>
              <p className="text-xs text-ringo-muted">{m.currency}</p>
            </div>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div><dt className="text-xs text-ringo-muted">{u.receiptNumber}</dt><dd className="text-ringo-text">{m.number}</dd></div>
              <div><dt className="text-xs text-ringo-muted">{u.forInvoice}</dt><dd className="text-ringo-text">{view.parent ? <Link href={`/dashboard/documents/${view.parent.id}`} className="text-ringo-indigo hover:underline">{p.invoiceNumber}</Link> : p.invoiceNumber}</dd></div>
              <div><dt className="text-xs text-ringo-muted">{u.paymentDate}</dt><dd className="text-ringo-text">{formatDateKey(p.paidOn, locale)}</dd></div>
              <div><dt className="text-xs text-ringo-muted">{u.paymentMethod}</dt><dd className="text-ringo-text">{t.documents.pdf.methods[p.method] ?? p.method}</dd></div>
              <div><dt className="text-xs text-ringo-muted">{u.reference}</dt><dd className="text-ringo-text break-words">{p.reference || "—"}</dd></div>
              <div><dt className="text-xs text-ringo-muted">{u.balanceAfter}</dt><dd className="text-ringo-text tabular-nums">{formatMoney(p.balanceAfterMinor, m.currency, locale)}</dd></div>
            </dl>
          </>
        )}
      </Card>

      <Card>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <PartyBlock title={u.from} p={m.seller} seller />
          <PartyBlock title={u.billedTo} p={m.customer} seller={false} />
        </div>
      </Card>

      {m.parent && m.parent.lines.length > 0 && (
        <Card title={`${u.items} · ${m.parent.number}`}>
          <ItemsList lines={m.parent.lines} m={m} showMoney={false} />
        </Card>
      )}

      <div className="flex flex-wrap gap-2"><Pdf id={view.id} label={u.downloadReceipt} />{view.actions?.share && <ShareButton docId={view.id} number={m.number} className={secondaryButton} />}</div>
    </div>
  );
}

