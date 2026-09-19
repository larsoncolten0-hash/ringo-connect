"use client";

import { useState } from "react";
import { Loader2, Undo2, X } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import type { ActivityItem } from "@/lib/loyalty/history";
import { actionText, api, codeOf, fmtDateTime, newKey, outcomeText } from "@/components/loyalty/format";

const btnGhost =
  "inline-flex items-center justify-center gap-1.5 rounded-xl border border-ringo-border px-3 py-1.5 text-xs font-medium text-ringo-text transition hover:border-ringo-indigo/40 disabled:opacity-50";

// The business-wide loyalty history: customer, action, date, staff, program. Nothing is ever
// deleted; a mistake is corrected with a reversal (a new entry) that needs a written reason.
export default function ActivityList({
  initialItems,
  initialCursor,
  canReverse,
}: {
  initialItems: ActivityItem[];
  initialCursor: string | null;
  canReverse: boolean;
}) {
  const { t, locale } = useLanguage();
  const L = t.loyalty;
  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [reversing, setReversing] = useState<{ id: string; label: string; key: string } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadMore() {
    if (!cursor || loading) return;
    setLoading(true);
    const res = await api(`/api/loyalty/activities?cursor=${encodeURIComponent(cursor)}`);
    setLoading(false);
    if (res.status === 200 && res.data) {
      setItems((prev) => [...prev, ...(res.data.items as ActivityItem[])]);
      setCursor(res.data.nextCursor ?? null);
    } else setNotice({ kind: "error", text: res.status === 0 ? L.scan.network : outcomeText(L, codeOf(res)) });
  }

  async function reload() {
    const res = await api("/api/loyalty/activities");
    if (res.status === 200 && res.data) {
      setItems(res.data.items as ActivityItem[]);
      setCursor(res.data.nextCursor ?? null);
    }
  }

  async function confirmReverse() {
    if (!reversing || busy || reason.trim().length < 3) return;
    setBusy(true);
    const target = reversing;
    const res = await api(`/api/loyalty/activities/${target.id}/reverse`, { body: { reason: reason.trim(), idempotency_key: target.key } });
    setBusy(false);
    const code = codeOf(res);
    if (res.status === 200) {
      setNotice({ kind: "ok", text: outcomeText(L, code) });
      setReversing(null);
      setReason("");
      await reload();
    } else {
      if (res.status !== 0) setReversing({ ...target, key: newKey() });
      setNotice({ kind: "error", text: res.status === 0 ? L.scan.network : outcomeText(L, code) });
      if (code === "already_reversed" || code === "not_reversible") await reload();
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-ringo-text">{L.activity.title}</h2>

      {notice && (
        <p role="status" className={`rounded-xl px-4 py-3 text-sm font-medium ${notice.kind === "ok" ? "bg-emerald-500/10 text-emerald-600" : "bg-red-500/10 text-red-500"}`}>
          {notice.text}
        </p>
      )}

      {items.length === 0 && <p className="rounded-card border border-ringo-border/70 bg-ringo-surface p-6 text-center text-sm text-ringo-muted">{L.activity.empty}</p>}

      <div className="flex flex-col overflow-hidden rounded-card border border-ringo-border/70 bg-ringo-surface">
        {items.map((it) => {
          const label = actionText(L, it.actionKey);
          const abs = Math.abs(it.quantity);
          const sign = it.quantity > 0 ? "+" : "−";
          const text = `${sign}${abs} ${abs === 1 ? label.one : label.many}`;
          const isCarry = it.source === "carry_over";
          const reversible = canReverse && it.kind === "record" && !it.reversed && !isCarry;
          return (
            <div key={it.id} className="flex items-start justify-between gap-3 border-b border-ringo-border/50 px-4 py-3 last:border-0">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ringo-text">{it.customerName || "—"}</p>
                <p className={`text-sm ${it.reversed ? "text-ringo-muted line-through" : "text-ringo-text"}`}>
                  {text}
                  {(it.programName || it.packageName) && (
                    <span className="text-ringo-muted">
                      {" · "}
                      {it.programName ?? `${L.activity.packageUse}: ${it.packageName}`}
                    </span>
                  )}
                  {it.reversed && <span className="ml-2 rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold text-red-500 no-underline">{L.activity.reversed}</span>}
                  {it.kind === "reversal" && <span className="ml-2 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-600">{L.activity.reversalOf}</span>}
                  {isCarry && <span className="ml-2 rounded-full bg-ringo-muted/15 px-2 py-0.5 text-[10px] font-semibold text-ringo-muted">{L.activity.carryOver}</span>}
                </p>
                {it.reason && <p className="text-xs italic text-ringo-muted">“{it.reason}”</p>}
                <p className="text-xs text-ringo-muted">
                  {fmtDateTime(it.createdAt, locale)} · {L.activity.colStaff}: {it.staffLabel ?? L.activity.unknownStaff}
                </p>
              </div>
              {reversible && (
                <button
                  type="button"
                  onClick={() => {
                    setReason("");
                    setReversing({ id: it.id, label: `${it.customerName} · ${text}`, key: newKey() });
                  }}
                  className={btnGhost}
                >
                  <Undo2 size={13} /> {L.activity.reverse}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {cursor && (
        <button type="button" onClick={loadMore} disabled={loading} className="self-center rounded-xl border border-ringo-border px-4 py-2 text-sm font-medium text-ringo-text disabled:opacity-50">
          {loading ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" /> {L.activity.loading}
            </span>
          ) : (
            L.activity.loadMore
          )}
        </button>
      )}

      {reversing && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label={L.activity.reverseTitle}>
          <div className="w-full max-w-md rounded-2xl bg-ringo-surface p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-base font-bold text-ringo-text">{L.activity.reverseTitle}</h3>
                <p className="mt-0.5 truncate text-sm text-ringo-muted">{reversing.label}</p>
              </div>
              <button type="button" aria-label={L.activity.cancel} onClick={() => setReversing(null)} className="text-ringo-muted">
                <X size={18} />
              </button>
            </div>
            <p className="mt-2 text-xs text-ringo-muted">{L.activity.reverseBody}</p>
            <label className="mt-3 flex flex-col gap-1 text-xs font-medium text-ringo-muted">
              {L.activity.reasonLabel}
              <textarea
                value={reason}
                maxLength={300}
                rows={3}
                onChange={(e) => setReason(e.target.value)}
                placeholder={L.activity.reasonPlaceholder}
                className="w-full rounded-xl border border-ringo-border bg-ringo-bg px-3 py-2.5 text-sm text-ringo-text focus:outline-none focus:ring-2 focus:ring-ringo-indigo/30"
              />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setReversing(null)} className="rounded-xl border border-ringo-border px-4 py-2.5 text-sm font-medium text-ringo-text">
                {L.activity.cancel}
              </button>
              <button
                type="button"
                disabled={busy || reason.trim().length < 3}
                onClick={confirmReverse}
                className="inline-flex items-center gap-2 rounded-xl bg-ringo-indigo px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {busy ? <Loader2 size={15} className="animate-spin" /> : L.activity.confirmReverse}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
