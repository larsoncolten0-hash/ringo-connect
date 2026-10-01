"use client";

import { useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { currencyMinorDigits, minorToAmountString, parseMinor } from "@/lib/bookkeeping/money";
import { toLocalDateKey } from "@/lib/bookkeeping/summary";
import { DOCUMENT_TIME_ZONE, LIMITS, PAYMENT_METHODS } from "@/lib/documents/constants";
import { formatMoney } from "@/lib/documents/moneyFormat";
import { Modal, callApi, dangerButton, inputClass, labelClass, newRequestId, primaryButton, secondaryButton, useErrorText } from "./shared";

export function ConfirmModal({ title, body, confirmLabel, onClose, onConfirm }: { title: string; body: string; confirmLabel: string; onClose: () => void; onConfirm: () => Promise<string | null> }) {
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const go = async () => {
    setBusy(true);
    setError("");
    const err = await onConfirm();
    setBusy(false);
    if (err) setError(err);
  };
  return (
    <Modal title={title} onClose={busy ? () => {} : onClose}>
      <p className="text-sm text-ringo-muted leading-relaxed">{body}</p>
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
        <button onClick={onClose} disabled={busy} className={secondaryButton}>{t.documents.ui.cancel}</button>
        <button onClick={go} disabled={busy} className={primaryButton}>
          {busy ? <><Loader2 size={15} className="animate-spin" />{t.documents.ui.working}</> : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

/** A destructive action that needs a written reason (voiding an invoice or a payment). */
export function ReasonModal({ title, body, confirmLabel, onClose, onConfirm }: { title: string; body: string; confirmLabel: string; onClose: () => void; onConfirm: (reason: string) => Promise<string | null> }) {
  const { t } = useLanguage();
  const u = t.documents.ui;
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const go = async () => {
    if (reason.trim() === "") return setError(u.errors.reasonRequired);
    setBusy(true);
    setError("");
    const err = await onConfirm(reason);
    setBusy(false);
    if (err) setError(err);
  };
  return (
    <Modal title={title} onClose={busy ? () => {} : onClose}>
      <p className="text-sm text-ringo-muted leading-relaxed">{body}</p>
      <label className={labelClass}>
        {u.reasonLabel}
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={LIMITS.voidReason} rows={3} placeholder={u.reasonPlaceholder} disabled={busy} className={inputClass} />
      </label>
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
        <button onClick={onClose} disabled={busy} className={secondaryButton}>{t.documents.ui.cancel}</button>
        <button onClick={go} disabled={busy} className={dangerButton}>
          {busy ? <><Loader2 size={15} className="animate-spin" />{u.working}</> : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

/**
 * Record a payment the BUSINESS received against an issued invoice. The wording says so on purpose: this is not a Ringo-verified
 * payment. One request id per opening of the dialog makes a double-click or a retry harmless (the server returns the same payment).
 */
export function PaymentModal({ invoiceId, currency, balanceMinor, issueDate, onClose, onDone }: { invoiceId: string; currency: string; balanceMinor: number; issueDate: string | null; onClose: () => void; onDone: () => void }) {
  const { t, locale } = useLanguage();
  const u = t.documents.ui;
  const errorText = useErrorText();
  const digits = currencyMinorDigits(currency);
  const today = toLocalDateKey(new Date(), DOCUMENT_TIME_ZONE);
  const requestId = useRef(newRequestId());
  const [amount, setAmount] = useState(minorToAmountString(balanceMinor, digits));
  const [method, setMethod] = useState<string>("cash");
  const [reference, setReference] = useState("");
  const [paidOn, setPaidOn] = useState(today);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    // instant feedback only: the server and the database make the real decision
    const raw = amount.trim().replace(",", ".");
    const minor = parseMinor(raw, digits);
    if (minor === null || minor <= 0) {
      const frac = (raw.split(".")[1] || "").replace(/0+$/, "");
      return setError(/^\d+\.\d+$/.test(raw) && frac.length > digits ? u.errors.tooPrecise : u.errors.invalidAmount);
    }
    if (minor > balanceMinor) return setError(u.errors.exceedsBalance);
    setBusy(true);
    setError("");
    const r = await callApi("POST", `/api/documents/${encodeURIComponent(invoiceId)}/payments`, { amount: raw, method, reference: reference || null, paid_on: paidOn, client_request_id: requestId.current });
    setBusy(false);
    if (r.ok) return onDone();
    setError(errorText(r.data));
  };

  return (
    <Modal title={u.paymentTitle} onClose={busy ? () => {} : onClose}>
      <p className="text-sm text-ringo-muted leading-relaxed">{u.paymentIntro}</p>
      <label className={labelClass}>
        {u.paymentAmount}
        <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={busy} className={inputClass} />
        <span className="font-normal">{u.paymentBalanceHint(formatMoney(balanceMinor, currency, locale))}</span>
      </label>
      <label className={labelClass}>
        {u.paymentMethodLabel}
        <select value={method} onChange={(e) => setMethod(e.target.value)} disabled={busy} className={inputClass}>
          {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{t.documents.pdf.methods[m]}</option>)}
        </select>
      </label>
      <label className={labelClass}>
        {u.paymentReference}
        <input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={LIMITS.paymentReference} disabled={busy} className={inputClass} />
      </label>
      <label className={labelClass}>
        {u.paymentPaidOn}
        <input type="date" value={paidOn} min={issueDate ?? undefined} max={today} onChange={(e) => setPaidOn(e.target.value)} disabled={busy} className={inputClass} />
      </label>
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
        <button onClick={onClose} disabled={busy} className={secondaryButton}>{u.cancel}</button>
        <button onClick={submit} disabled={busy} className={primaryButton}>
          {busy ? <><Loader2 size={15} className="animate-spin" />{u.working}</> : u.paymentSubmit}
        </button>
      </div>
    </Modal>
  );
}
