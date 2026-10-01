"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { CONTACT_LIMITS } from "@/lib/receivables/constants";
import { Modal, callApi, inputClass, labelClass, newRequestId, primaryButton, secondaryButton, useCustErrorText } from "./shared";

export type CustomerFields = { id: string; name: string; phone: string | null; email: string | null; notes: string | null };

/** Create or edit a customer. It only calls the EXISTING Phase 3 contact endpoints (POST /api/receivables/customers, PUT .../[id]): the server
 * validates every field, refuses a duplicate phone/email (it reports the existing contact and never merges), and decides what is allowed. */
export default function CustomerForm({ customer, onClose, onSaved }: { customer: CustomerFields | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage();
  const r = t.receivables.ui; // the same labels the Contacts screen uses
  const errorText = useCustErrorText();
  const requestId = useRef(newRequestId()); // one id per open form: a double click or a retry replays instead of creating twice
  const [v, setV] = useState({ name: customer?.name ?? "", phone: customer?.phone ?? "", email: customer?.email ?? "", notes: customer?.notes ?? "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dup, setDup] = useState<{ id: string; name: string } | null>(null);

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    setDup(null);
    const body = { ...v, ...(customer ? {} : { client_request_id: requestId.current }) };
    const res = customer ? await callApi("PUT", `/api/receivables/customers/${customer.id}`, body) : await callApi("POST", "/api/receivables/customers", body);
    setBusy(false);
    if (!res.ok) {
      if (res.data?.error === "duplicate_customer" && res.data.existing) { setDup(res.data.existing); return setError(r.duplicateBody(res.data.existing.name)); }
      return setError(errorText(res.data));
    }
    onSaved();
  };

  return (
    <Modal title={customer ? r.editContact : r.addContact} onClose={busy ? () => {} : onClose}>
      <label className={labelClass}>{r.contactName}<input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} maxLength={CONTACT_LIMITS.name} className={inputClass} autoFocus /></label>
      <label className={labelClass}>{r.contactPhone}<input value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} maxLength={CONTACT_LIMITS.phone} inputMode="tel" className={inputClass} /></label>
      <label className={labelClass}>{r.contactEmail}<input value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} maxLength={CONTACT_LIMITS.email} inputMode="email" className={inputClass} /></label>
      <label className={labelClass}>{r.contactNotes}<textarea value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} maxLength={CONTACT_LIMITS.notes} rows={3} className={inputClass} /></label>
      {error && <p role="alert" className="text-sm text-rose-600">{dup ? <strong>{r.duplicateTitle}. </strong> : null}{error}</p>}
      {dup && <Link href={`/dashboard/customers/${dup.id}`} className="w-fit text-sm text-ringo-indigo hover:underline">{r.useExisting}</Link>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button onClick={onClose} disabled={busy} className={secondaryButton}>{r.cancel}</button>
        <button onClick={save} disabled={busy} className={primaryButton}>{busy ? <><Loader2 size={15} className="animate-spin" />{r.saving}</> : r.save}</button>
      </div>
    </Modal>
  );
}
