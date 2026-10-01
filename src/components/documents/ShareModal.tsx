"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Link2, Loader2, Share2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { SHARE_DEFAULT_DAYS, SHARE_MAX_ACTIVE } from "@/lib/documents/shareConstants";
import { Modal, callApi, dangerButton, inputClass, labelClass, primaryButton, secondaryButton, useErrorText } from "./shared";

type ShareRow = { id: string; expires_at: string; revoked_at: string | null; created_at: string; last_accessed_at: string | null; access_count: number; active: boolean };

const EXPIRY_CHOICES = [1, 7, 14, 30, 90];

/**
 * Owner-side share-link controls for one issued document. The link is shown ONCE, right after it is created (the server keeps only
 * its hash, so it can never be shown again); the list below shows each link's state, never a usable URL. Nothing is sent
 * automatically: the owner copies the link or opens their own share sheet and chooses who receives it.
 */
export function ShareButton({ docId, number, className }: { docId: string; number: string | null; className: string }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className={className}><Link2 size={15} />{t.documents.ui.share.button}</button>
      {open && <ShareModal docId={docId} number={number} onClose={() => setOpen(false)} />}
    </>
  );
}

function ShareModal({ docId, number, onClose }: { docId: string; number: string | null; onClose: () => void }) {
  const { t, locale } = useLanguage();
  const s = t.documents.ui.share;
  const errorText = useErrorText();
  const [rows, setRows] = useState<ShareRow[] | null>(null);
  const [days, setDays] = useState(SHARE_DEFAULT_DAYS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fresh, setFresh] = useState<{ url: string; expires_at: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const base = `/api/documents/${encodeURIComponent(docId)}/shares`;
  const canNativeShare = typeof navigator !== "undefined" && typeof (navigator as any).share === "function";

  const load = useCallback(async () => {
    const r = await callApi<{ items: ShareRow[] }>("GET", base);
    if (!r.ok) return setError(errorText(r.data));
    setRows(r.data.items ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);
  useEffect(() => { load(); }, [load]);

  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");
  const activeCount = (rows ?? []).filter((r) => r.active).length;

  const create = async () => {
    setBusy(true);
    setError("");
    setCopied(false);
    const r = await callApi("POST", base, { expires_in_days: days });
    setBusy(false);
    if (!r.ok) return setError(errorText(r.data));
    setFresh({ url: String(r.data.url), expires_at: String(r.data.expires_at) });
    load();
  };

  const copy = async () => {
    if (!fresh) return;
    try {
      await navigator.clipboard.writeText(fresh.url);
      setCopied(true);
    } catch {
      // clipboard unavailable (insecure context or denied): the link stays selectable in the field below
      setCopied(false);
    }
  };

  const nativeShare = async () => {
    if (!fresh) return;
    try {
      await (navigator as any).share({ title: number ?? undefined, text: s.message(number ?? ""), url: fresh.url });
    } catch {
      // the person closed the share sheet: nothing to do
    }
  };

  const revoke = async (id: string) => {
    if (!window.confirm(s.revokeConfirm)) return;
    setRevoking(id);
    setError("");
    const r = await callApi("POST", `/api/documents/shares/${encodeURIComponent(id)}/revoke`);
    setRevoking(null);
    if (!r.ok) return setError(errorText(r.data));
    load();
  };

  return (
    <Modal title={s.title} onClose={onClose}>
      <p className="text-sm text-ringo-muted leading-relaxed">{s.intro}</p>

      {fresh && (
        <div className="rounded-card border border-emerald-500/30 bg-emerald-500/5 p-3 flex flex-col gap-2">
          <p className="text-sm font-medium text-ringo-text">{s.newLinkTitle}</p>
          <input readOnly value={fresh.url} onFocus={(e) => e.currentTarget.select()} className={`${inputClass} font-mono text-xs`} aria-label={s.newLinkTitle} />
          <p className="text-xs text-ringo-muted">{s.newLinkNote}</p>
          <p className="text-xs text-ringo-muted">{s.expiresOn}: {fmt(fresh.expires_at)}</p>
          <div className="flex flex-wrap gap-2">
            <button onClick={copy} className={primaryButton}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? s.copied : s.copy}</button>
            {canNativeShare && <button onClick={nativeShare} className={secondaryButton}><Share2 size={15} />{s.shareVia}</button>}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <label className={labelClass}>
          {s.expiry}
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} disabled={busy} className={inputClass}>
            {EXPIRY_CHOICES.map((d) => <option key={d} value={d}>{s.days(d)}</option>)}
          </select>
        </label>
        <button onClick={create} disabled={busy || activeCount >= SHARE_MAX_ACTIVE} className={primaryButton}>
          {busy ? <><Loader2 size={15} className="animate-spin" />{s.creating}</> : <><Link2 size={15} />{s.create}</>}
        </button>
        <p className="text-xs text-ringo-muted">{s.limit(SHARE_MAX_ACTIVE)}</p>
      </div>

      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}

      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium text-ringo-muted">{s.existing}</p>
        {rows === null && <Loader2 size={16} className="animate-spin text-ringo-muted" />}
        {rows !== null && rows.length === 0 && <p className="text-sm text-ringo-muted">{s.none}</p>}
        {rows !== null && rows.length > 0 && (
          <ul className="flex flex-col gap-2">
            {rows.map((r) => {
              const state = r.revoked_at ? s.revoked : r.active ? s.active : s.expired;
              return (
                <li key={r.id} className="rounded-card border border-ringo-border p-3 flex items-start justify-between gap-3">
                  <div className="text-xs text-ringo-muted flex flex-col gap-0.5 min-w-0">
                    <span className="text-sm font-medium text-ringo-text">{state}</span>
                    <span>{s.createdOn}: {fmt(r.created_at)}</span>
                    <span>{s.expiresOn}: {fmt(r.expires_at)}</span>
                    <span>{r.access_count === 0 ? s.neverOpened : `${s.opens(r.access_count)} · ${s.lastOpened}: ${fmt(r.last_accessed_at)}`}</span>
                  </div>
                  {r.active && (
                    <button onClick={() => revoke(r.id)} disabled={revoking === r.id} className={dangerButton}>
                      {revoking === r.id ? s.revoking : s.revoke}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex justify-end"><button onClick={onClose} className={secondaryButton}>{s.close}</button></div>
    </Modal>
  );
}
