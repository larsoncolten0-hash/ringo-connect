"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { Modal, callApi, inputClass, labelClass, newRequestId, primaryButton, secondaryButton, useRecvErrorText } from "./shared";

type Contact = { id: string; name: string; phone?: string | null; email?: string | null };
type Suggestion = Contact & { match: "phone" | "email" | "both" };

/**
 * Links an invoice to one of the owner's contacts (or removes the link). The invoice and its frozen customer snapshot never change: this only
 * decides whose balance the invoice counts towards. Suggestions come from the SAME business's contacts and never link anything by themselves.
 */
export default function LinkCustomerModal({ documentId, currentName, invoiceCustomer, onClose, onDone }: {
  documentId: string; currentName: string | null; invoiceCustomer?: { name?: string | null; phone?: string | null; email?: string | null }; onClose: () => void; onDone: () => void;
}) {
  const { t } = useLanguage();
  const r = t.receivables.ui;
  const errorText = useRecvErrorText();
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const [s, c] = await Promise.all([
        callApi("GET", `/api/receivables/documents/${encodeURIComponent(documentId)}/suggestions`),
        callApi("GET", "/api/receivables/customers"),
      ]);
      setSuggestions(s.ok ? s.data.items : []);
      setContacts(c.ok ? c.data.items : []);
    })();
  }, [documentId]);

  const apply = async (customerId: string | null) => {
    setBusy(true);
    setError("");
    const res = await callApi("PUT", `/api/receivables/documents/${encodeURIComponent(documentId)}/customer`, { customer_id: customerId });
    setBusy(false);
    if (!res.ok) return setError(errorText(res.data));
    onDone();
    onClose();
  };

  const createFromInvoice = async () => {
    if (!invoiceCustomer?.name) return;
    setBusy(true);
    setError("");
    const created = await callApi("POST", "/api/receivables/customers", { name: invoiceCustomer.name, phone: invoiceCustomer.phone || null, email: invoiceCustomer.email || null, client_request_id: newRequestId() });
    if (!created.ok) {
      setBusy(false);
      // an existing contact with the same phone or email: offer it instead of creating a second one (never merged automatically)
      if (created.data?.error === "duplicate_customer" && created.data.existing?.id) { setPick(created.data.existing.id); return setError(r.duplicateBody(created.data.existing.name)); }
      return setError(errorText(created.data));
    }
    await apply(created.data.customer.id);
  };

  return (
    <Modal title={r.linkTitle} onClose={busy ? () => {} : onClose}>
      <p className="text-sm text-ringo-muted leading-relaxed">{r.linkIntro}</p>
      {currentName && <p className="text-sm text-ringo-text">{r.linkedTo(currentName)}</p>}
      {suggestions === null ? <Loader2 size={16} className="animate-spin text-ringo-muted" /> : (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-ringo-muted">{r.suggested}</p>
          {suggestions.length === 0 ? <p className="text-sm text-ringo-muted">{r.noSuggestion}</p> : suggestions.map((s) => (
            <button key={s.id} type="button" disabled={busy} onClick={() => apply(s.id)} className={`${secondaryButton} justify-between`}>
              <span className="truncate">{s.name}</span>
              <span className="text-xs text-ringo-muted">{s.match === "both" ? r.matchBoth : s.match === "phone" ? r.matchPhone : r.matchEmail}</span>
            </button>
          ))}
        </div>
      )}
      <label className={labelClass}>
        {r.chooseContact}
        <select value={pick} onChange={(e) => setPick(e.target.value)} className={inputClass}>
          <option value="">—</option>
          {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      <div className="flex flex-col sm:flex-row gap-2 sm:justify-end flex-wrap">
        {currentName && <button onClick={() => apply(null)} disabled={busy} className={secondaryButton}>{r.unlink}</button>}
        {invoiceCustomer?.name && <button onClick={createFromInvoice} disabled={busy} className={secondaryButton}>{r.createFromInvoice}</button>}
        <button onClick={() => pick && apply(pick)} disabled={busy || !pick} className={primaryButton}>{busy ? <Loader2 size={15} className="animate-spin" /> : r.link}</button>
      </div>
    </Modal>
  );
}
