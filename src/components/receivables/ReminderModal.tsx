"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, Loader2, Mail, MessageCircle } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { Modal, callApi, inputClass, labelClass, newRequestId, primaryButton, secondaryButton, useFormatters, useRecvErrorText } from "./shared";

export type ReminderTarget = { id: string; number: string | null; hasEmail: boolean; hasPhone: boolean };

type Row = { id: string; trigger_type: string; channel: string; status: string; kind: string; amount_due_minor: number; currency: string; created_at: string; recipient_hint: string | null; include_link: boolean };

/**
 * Manual reminder for ONE invoice: email (sent by Ringo through the existing email infrastructure, limited server-side) or WhatsApp (only
 * opens the owner's own WhatsApp with a ready message; never marked as sent). An invoice link is included only if the owner pastes one
 * they already created with Share link; nothing here creates a link. The history below is read from the server.
 */
export default function ReminderModal({ target, onClose, onDone }: { target: ReminderTarget; onClose: () => void; onDone: () => void }) {
  const { t } = useLanguage();
  const r = t.receivables.ui;
  const errorText = useRecvErrorText();
  const f = useFormatters();
  const requestId = useRef({ email: newRequestId(), whatsapp_manual: newRequestId() });
  const [channel, setChannel] = useState<"email" | "whatsapp_manual">(target.hasEmail || !target.hasPhone ? "email" : "whatsapp_manual");
  const [withLink, setWithLink] = useState(false);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);

  const load = async () => {
    const res = await callApi("GET", `/api/receivables/documents/${encodeURIComponent(target.id)}/reminders`);
    setRows(res.ok ? res.data.items : []);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const go = async () => {
    setBusy(true);
    setError("");
    setOk("");
    const res = await callApi("POST", `/api/receivables/documents/${encodeURIComponent(target.id)}/reminders`, {
      channel, client_request_id: requestId.current[channel], ...(withLink && link.trim() ? { share_link: link.trim() } : {}),
    });
    setBusy(false);
    if (!res.ok) {
      // a refused attempt may be retried with a fresh request id (the refused one never created a reminder)
      requestId.current[channel] = newRequestId();
      return setError(errorText(res.data));
    }
    if (channel === "whatsapp_manual" && res.data.whatsapp?.href) {
      window.open(res.data.whatsapp.href, "_blank", "noopener,noreferrer");
      setOk(r.whatsappOpened);
    } else setOk(r.emailSentOk);
    requestId.current[channel] = newRequestId();
    onDone();
    load();
  };

  const canGo = channel === "email" ? target.hasEmail : target.hasPhone;
  return (
    <Modal title={`${r.reminderTitle}${target.number ? ` · ${target.number}` : ""}`} onClose={busy ? () => {} : onClose}>
      <p className="text-sm text-ringo-muted leading-relaxed">{r.reminderIntro}</p>
      <div className="flex gap-2" role="radiogroup" aria-label={r.reminderTitle}>
        <button type="button" role="radio" aria-checked={channel === "email"} onClick={() => setChannel("email")} className={channel === "email" ? primaryButton : secondaryButton}><Mail size={15} />{r.channelEmail}</button>
        <button type="button" role="radio" aria-checked={channel === "whatsapp_manual"} onClick={() => setChannel("whatsapp_manual")} className={channel === "whatsapp_manual" ? primaryButton : secondaryButton}><MessageCircle size={15} />{r.channelWhatsapp}</button>
      </div>

      {channel === "email" && !target.hasEmail && <p className="text-sm text-amber-700 dark:text-amber-400">{r.noEmail}</p>}
      {channel === "whatsapp_manual" && !target.hasPhone && <p className="text-sm text-amber-700 dark:text-amber-400">{r.noPhone}</p>}
      {channel === "whatsapp_manual" && <p className="text-xs text-ringo-muted">{r.whatsappNote}</p>}
      {channel === "email" && <p className="text-xs text-ringo-muted">{r.limitsNote}</p>}

      <label className="flex items-center gap-2 text-sm text-ringo-text">
        <input type="checkbox" checked={withLink} onChange={(e) => setWithLink(e.target.checked)} className="accent-ringo-indigo" />
        {r.includeLink}
      </label>
      {withLink && (
        <label className={labelClass}>
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder={r.linkPlaceholder} aria-label={r.includeLink} className={`${inputClass} font-mono text-xs`} />
          <span className="font-normal">{r.linkHelp}</span>
        </label>
      )}

      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      {ok && <p role="status" className="text-sm text-emerald-600">{ok}</p>}
      <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
        <button onClick={onClose} disabled={busy} className={secondaryButton}>{r.back}</button>
        <button onClick={go} disabled={busy || !canGo} className={primaryButton}>
          {busy ? <><Loader2 size={15} className="animate-spin" />{r.sendingEmail}</> : channel === "email" ? <><Mail size={15} />{r.sendEmail}</> : <><ExternalLink size={15} />{r.openWhatsapp}</>}
        </button>
      </div>

      <div className="flex flex-col gap-2 pt-1">
        <p className="text-xs font-medium text-ringo-muted">{r.historyTitle}</p>
        {rows === null && <Loader2 size={16} className="animate-spin text-ringo-muted" />}
        {rows !== null && rows.length === 0 && <p className="text-sm text-ringo-muted">{r.historyEmpty}</p>}
        {rows !== null && rows.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {rows.map((x) => (
              <li key={x.id} className="text-xs text-ringo-muted rounded-card border border-ringo-border/60 px-3 py-2">
                <span className="text-ringo-text font-medium">{r.reminderStatus[x.status] ?? x.status}</span>
                {` · ${r.reminderChannel[x.channel] ?? x.channel} · ${r.reminderBy[x.trigger_type] ?? x.trigger_type} · ${f.when(x.created_at)}`}
                {x.recipient_hint ? ` · ${x.recipient_hint}` : ""}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
