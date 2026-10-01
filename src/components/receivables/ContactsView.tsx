"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, Pencil, Plus } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { CONTACT_LIMITS } from "@/lib/receivables/constants";
import { Modal, callApi, dangerButton, inputClass, labelClass, newRequestId, primaryButton, secondaryButton, useFormatters, useRecvErrorText } from "./shared";

type Contact = { id: string; name: string; phone: string | null; email: string | null; notes: string | null; auto_reminders_paused: boolean; archived_at: string | null };
type Balances = Record<string, { currency: string; outstanding_minor: number }[]>;

/** The merchant-owned contact book: add, edit, archive/restore, pause automatic reminders. Contacts are never merged automatically. */
export default function ContactsView() {
  const { t } = useLanguage();
  const r = t.receivables.ui;
  const errorText = useRecvErrorText();
  const f = useFormatters();
  const [items, setItems] = useState<Contact[] | null>(null);
  const [balances, setBalances] = useState<Balances>({});
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Contact | "new" | null>(null);

  const load = useCallback(async () => {
    const [c, s] = await Promise.all([callApi("GET", `/api/receivables/customers${showArchived ? "?archived=1" : ""}`), callApi("GET", "/api/receivables/summary")]);
    if (!c.ok) return setError(errorText(c.data));
    setItems(c.data.items);
    const b: Balances = {};
    if (s.ok) for (const cur of s.data.currencies) for (const x of cur.customers) (b[x.customer_id] ||= []).push({ currency: cur.currency, outstanding_minor: x.outstanding_minor });
    setBalances(b);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showArchived]);
  useEffect(() => { load(); }, [load]);

  const act = async (url: string, body: unknown) => {
    setError("");
    const res = await callApi("POST", url, body);
    if (!res.ok) return setError(errorText(res.data));
    load();
  };

  if (items === null && !error) return <div className="py-12 flex items-center justify-center text-ringo-muted"><Loader2 size={20} className="animate-spin" /><span className="sr-only">{r.loading}</span></div>;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1 max-w-2xl">
          <h1 className="font-display text-2xl font-medium text-ringo-text tracking-[-0.01em]">{r.contactsTitle}</h1>
          <p className="text-sm text-ringo-muted">{r.contactsIntro}</p>
        </div>
        <button onClick={() => setEditing("new")} className={primaryButton}><Plus size={15} />{r.addContact}</button>
      </div>
      <label className="flex items-center gap-2 text-sm text-ringo-text">
        <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="accent-ringo-indigo" />
        {r.showArchived}
      </label>
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      {items && items.length === 0 && <p className="text-sm text-ringo-muted">{r.noContacts}</p>}
      <ul className="flex flex-col gap-2">
        {(items || []).map((c) => (
          <li key={c.id} className="rounded-2xl border border-ringo-border/70 bg-ringo-surface p-3 sm:p-4 flex flex-col gap-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link href={`/dashboard/documents/receivables/contacts/${c.id}`} className="text-sm font-medium text-ringo-text hover:underline">{c.name}</Link>
                <p className="text-xs text-ringo-muted break-words">{[c.phone, c.email].filter(Boolean).join(" · ") || "—"}</p>
                <p className="text-xs text-ringo-muted">
                  {c.archived_at ? r.archivedBadge : ""}{c.archived_at && c.auto_reminders_paused ? " · " : ""}{c.auto_reminders_paused ? r.pausedBadge : ""}
                </p>
              </div>
              <div className="text-right shrink-0">
                {(balances[c.id] || []).map((b) => (
                  <p key={b.currency} className="text-sm tabular-nums text-ringo-text">{r.balance}: {f.money(b.outstanding_minor, b.currency)}</p>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {!c.archived_at && <button onClick={() => setEditing(c)} className={secondaryButton}><Pencil size={15} />{r.editContact}</button>}
              {!c.archived_at && <button onClick={() => act(`/api/receivables/customers/${c.id}/pause`, { paused: !c.auto_reminders_paused })} className={secondaryButton}>{c.auto_reminders_paused ? r.resumeAuto : r.pauseAuto}</button>}
              <button onClick={() => act(`/api/receivables/customers/${c.id}/archive`, { archived: !c.archived_at })} className={c.archived_at ? secondaryButton : dangerButton}>{c.archived_at ? r.restore : r.archive}</button>
            </div>
          </li>
        ))}
      </ul>
      {editing && <ContactForm contact={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}

function ContactForm({ contact, onClose, onSaved }: { contact: Contact | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage();
  const r = t.receivables.ui;
  const errorText = useRecvErrorText();
  const requestId = useRef(newRequestId());
  const [v, setV] = useState({ name: contact?.name ?? "", phone: contact?.phone ?? "", email: contact?.email ?? "", notes: contact?.notes ?? "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dup, setDup] = useState<{ id: string; name: string } | null>(null);

  const save = async () => {
    setBusy(true);
    setError("");
    setDup(null);
    const body = { ...v, ...(contact ? {} : { client_request_id: requestId.current }) };
    const res = contact ? await callApi("PUT", `/api/receivables/customers/${contact.id}`, body) : await callApi("POST", "/api/receivables/customers", body);
    setBusy(false);
    if (!res.ok) {
      if (res.data?.error === "duplicate_customer" && res.data.existing) { setDup(res.data.existing); return setError(r.duplicateBody(res.data.existing.name)); }
      return setError(errorText(res.data));
    }
    onSaved();
  };

  return (
    <Modal title={contact ? r.editContact : r.addContact} onClose={busy ? () => {} : onClose}>
      <label className={labelClass}>{r.contactName}<input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} maxLength={CONTACT_LIMITS.name} className={inputClass} /></label>
      <label className={labelClass}>{r.contactPhone}<input value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} maxLength={CONTACT_LIMITS.phone} inputMode="tel" className={inputClass} /></label>
      <label className={labelClass}>{r.contactEmail}<input value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} maxLength={CONTACT_LIMITS.email} inputMode="email" className={inputClass} /></label>
      <label className={labelClass}>{r.contactNotes}<textarea value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} maxLength={CONTACT_LIMITS.notes} rows={3} className={inputClass} /></label>
      {error && <p role="alert" className="text-sm text-rose-600">{dup ? <strong>{r.duplicateTitle}. </strong> : null}{error}</p>}
      {dup && <Link href={`/dashboard/documents/receivables/contacts/${dup.id}`} className="text-sm text-ringo-indigo hover:underline w-fit">{r.useExisting}</Link>}
      <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
        <button onClick={onClose} disabled={busy} className={secondaryButton}>{r.cancel}</button>
        <button onClick={save} disabled={busy} className={primaryButton}>{busy ? <><Loader2 size={15} className="animate-spin" />{r.saving}</> : r.save}</button>
      </div>
    </Modal>
  );
}
