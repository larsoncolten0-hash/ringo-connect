"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/components/LanguageProvider";

// Ambassador Program — Management action buttons for the ledger and payout
// tables (see AdminAmbassadorsView.tsx). Every button is a plain fetch to an
// assertAdmin()-gated route that takes only an id (plus, where a person must
// explain themselves, a reason/note/transaction id). Nothing here sends an
// amount, recipient or status. Irreversible actions ask first. The database
// state machine — not this component — decides whether an action is allowed.
type Kind = "release" | "reverse" | "send" | "check" | "markPaid" | "reject" | "resolveSent" | "resolveNotSent";

export default function AmbassadorPayoutActions({ kind, id, disabled = false }: { kind: Kind; id: string; disabled?: boolean }) {
  const { t } = useLanguage();
  const a = t.ambassadorPayouts.admin;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const errors = a.errors as Record<string, string>;

  const labels: Record<Kind, string> = {
    release: a.releaseForPayout,
    reverse: a.reverse,
    send: a.sendFapshi,
    check: a.checkStatus,
    markPaid: a.markPaid,
    reject: a.rejectPayout,
    resolveSent: a.resolveSent,
    resolveNotSent: a.resolveNotSent,
  };

  async function run() {
    let url = "";
    let body: Record<string, unknown> | undefined;
    if (kind === "release") {
      url = "/api/admin/ambassador-payouts/eligible";
      body = { ledgerIds: [id] };
    } else if (kind === "reverse") {
      const reason = window.prompt(a.reasonPrompt);
      if (!reason) return;
      url = `/api/admin/ambassador-commissions/${id}/reverse`;
      body = { reason };
    } else if (kind === "send") {
      if (!window.confirm(a.confirmSend)) return;
      url = `/api/admin/ambassador-payouts/${id}/send`;
    } else if (kind === "check") {
      url = `/api/admin/ambassador-payouts/${id}/check`;
    } else if (kind === "markPaid") {
      const note = window.prompt(a.notePrompt);
      if (!note) return;
      url = `/api/admin/ambassador-payouts/${id}/mark-paid`;
      body = { note };
    } else if (kind === "reject") {
      const reason = window.prompt(a.reasonPrompt);
      if (!reason) return;
      url = `/api/admin/ambassador-payouts/${id}/reject`;
      body = { reason };
    } else if (kind === "resolveSent") {
      const fapshiTransId = window.prompt(a.txPrompt);
      if (!fapshiTransId) return;
      const note = window.prompt(a.notePrompt);
      if (!note) return;
      url = `/api/admin/ambassador-payouts/${id}/resolve`;
      body = { outcome: "sent", fapshiTransId, note };
    } else {
      if (!window.confirm(a.confirmNotSent)) return;
      const note = window.prompt(a.notePrompt);
      if (!note) return;
      url = `/api/admin/ambassador-payouts/${id}/resolve`;
      body = { outcome: "not_sent", note };
    }

    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.ok !== false) {
        setMessage({ ok: true, text: kind === "check" && json.fapshiStatus ? a.fapshiStatus(json.fapshiStatus) : kind === "release" ? a.released(Number(json.count ?? 0)) : a.done });
        router.refresh();
      } else {
        setMessage({ ok: false, text: errors[json.code] || errors.failed });
        // A refused/uncertain send changes the payout's state; show it.
        if (json.code === "fapshi_ambiguous" || json.code === "fapshi_rejected") router.refresh();
      }
    } catch {
      setMessage({ ok: false, text: errors.network });
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <button type="button" onClick={run} disabled={busy || disabled} className="text-xs font-medium px-2 py-1 rounded-md border border-ringo-border/60 text-ringo-text disabled:opacity-50">
        {labels[kind]}
      </button>
      {message && <span className={`text-[11px] max-w-[220px] ${message.ok ? "text-emerald-600" : "text-red-500"}`}>{message.text}</span>}
    </span>
  );
}

/** Admin control for platform_settings.ambassador_min_payout_xaf. It only edits
 *  the setting; the database enforces it on every payout request. */
export function AmbassadorMinPayoutSetting({ initial }: { initial: number | null }) {
  const { t } = useLanguage();
  const a = t.ambassadorPayouts.admin;
  const router = useRouter();
  const [value, setValue] = useState(initial != null ? String(initial) : "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const errors = a.errors as Record<string, string>;

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/ambassador-settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ minPayoutXaf: value }) });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.ok) {
        setMessage({ ok: true, text: a.minPayoutSaved });
        router.refresh();
      } else {
        setMessage({ ok: false, text: errors[json.code] || errors.failed });
      }
    } catch {
      setMessage({ ok: false, text: errors.network });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="text-xs text-ringo-muted flex flex-col gap-1">
        {a.minPayoutTitle}
        <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="numeric" className="w-32 rounded-lg border border-ringo-border/60 bg-ringo-bg px-3 py-2 text-sm text-ringo-text" />
      </label>
      <button type="button" onClick={save} disabled={busy || initial === null} className="text-sm font-medium px-3 py-2 rounded-lg bg-ringo-indigo text-white disabled:opacity-60">
        {a.minPayoutSave}
      </button>
      {message && <span className={`text-xs ${message.ok ? "text-emerald-600" : "text-red-500"}`}>{message.text}</span>}
    </div>
  );
}
