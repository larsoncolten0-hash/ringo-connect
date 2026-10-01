"use client";

import { useState } from "react";
import Link from "next/link";
import { CircleDollarSign, Download, FilePenLine, FilePlus2, Send, Trash2, XCircle } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import type { DocumentActions as Flags } from "@/lib/documents/actions";
import { ConfirmModal, PaymentModal, ReasonModal } from "./DocModals";
import { ShareButton } from "./ShareModal";
import { callApi, dangerButton, downloadPdf, primaryButton, secondaryButton, useErrorText } from "./shared";

export type ActionDoc = { id: string; number: string | null; currency: string; balanceMinor: number; issueDate: string | null };

/**
 * The state-aware action buttons for one invoice. It renders ONLY what `actions` allows — the flags come from the server (the same rule
 * the database enforces) — so nothing is offered that would be rejected. Sharing offers a secret view/download link (ShareModal).
 */
export default function DocumentActions({ doc, actions, onChanged, onGone }: { doc: ActionDoc; actions: Flags; onChanged: () => void; onGone?: () => void }) {
  const { t } = useLanguage();
  const u = t.documents.ui;
  const errorText = useErrorText();
  const [dialog, setDialog] = useState<null | "issue" | "discard" | "void" | "payment">(null);
  const [message, setMessage] = useState("");
  const [busyPdf, setBusyPdf] = useState(false);
  const base = `/api/documents/${encodeURIComponent(doc.id)}`;
  const close = () => setDialog(null);

  const pdf = async () => {
    setBusyPdf(true);
    setMessage("");
    const err = await downloadPdf(doc.id);
    setBusyPdf(false);
    if (err) setMessage(err.error === "network" ? u.errors.network : errorText(err) || u.downloadFailed);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {actions.edit && <Link href={`/dashboard/documents/${doc.id}/edit`} className={secondaryButton}><FilePenLine size={15} />{u.edit}</Link>}
        {actions.issue && <button onClick={() => setDialog("issue")} className={primaryButton}><Send size={15} />{u.issue}</button>}
        {actions.recordPayment && <button onClick={() => setDialog("payment")} className={primaryButton}><CircleDollarSign size={15} />{u.recordPayment}</button>}
        {actions.pdf && !actions.edit && <button onClick={pdf} disabled={busyPdf} className={secondaryButton}><Download size={15} />{u.downloadPdf}</button>}
        {actions.share && <ShareButton docId={doc.id} number={doc.number} className={secondaryButton} />}
        {actions.correct && <Link href={`/dashboard/documents/new?correct=${doc.id}`} className={secondaryButton}><FilePlus2 size={15} />{u.correct}</Link>}
        {actions.void && <button onClick={() => setDialog("void")} className={dangerButton}><XCircle size={15} />{u.voidInvoice}</button>}
        {actions.discard && <button onClick={() => setDialog("discard")} className={dangerButton}><Trash2 size={15} />{u.discard}</button>}
      </div>
      {message && <p role="alert" className="text-sm text-rose-600">{message}</p>}

      {dialog === "issue" && (
        <ConfirmModal title={u.issueTitle} body={u.issueBody} confirmLabel={u.issue} onClose={close}
          onConfirm={async () => { const r = await callApi("POST", `${base}/issue`); if (!r.ok) return errorText(r.data); close(); onChanged(); return null; }} />
      )}
      {dialog === "discard" && (
        <ConfirmModal title={u.discardTitle} body={u.discardBody} confirmLabel={u.discard} onClose={close}
          onConfirm={async () => { const r = await callApi("DELETE", base); if (!r.ok) return errorText(r.data); close(); (onGone ?? onChanged)(); return null; }} />
      )}
      {dialog === "void" && (
        <ReasonModal title={u.voidTitle} body={u.voidBody} confirmLabel={u.voidInvoice} onClose={close}
          onConfirm={async (reason) => { const r = await callApi("POST", `${base}/void`, { reason }); if (!r.ok) return errorText(r.data); close(); onChanged(); return null; }} />
      )}
      {dialog === "payment" && (
        <PaymentModal invoiceId={doc.id} currency={doc.currency} balanceMinor={doc.balanceMinor} issueDate={doc.issueDate} onClose={close} onDone={() => { close(); onChanged(); }} />
      )}
    </div>
  );
}
