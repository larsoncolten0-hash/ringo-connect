"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { ENTRY_KINDS } from "@/lib/bookkeeping/summary";
import { todayKeyOf } from "@/lib/reports/period";
import { Modal, callApi, dangerButton, inputClass, labelClass, newRequestId, primaryButton, secondaryButton, useBookkeepingErrorText, useFormat } from "@/components/reports/shared";

type Entry = {
  id: string; kind: string; amount_minor: number | null; currency: string; entry_date: string; category: string | null; description: string | null;
  cash_settled: boolean; voided_at: string | null; void_reason: string | null; created_at: string; invoice_payment: boolean;
};
const PAGE = 25;
const PRESETS = ["rent", "transport", "salaries", "supplies", "utilities", "marketing", "stock_purchase"];
const OUT_KINDS = ["expense", "cash_out"];

/** The bookkeeping entries screen. It only calls the existing Phase 1 endpoints (create and void) and a read-only history list; the server
 * validates every field and applies the ownership, plan and void rules. Nothing here decides an amount, a date limit or who may void. */
export default function EntriesView() {
  const { t } = useLanguage();
  const u = t.bookkeeping.ui;
  const errorText = useBookkeepingErrorText();
  const fmt = useFormat();
  const [kind, setKind] = useState("");
  const [showVoided, setShowVoided] = useState(false);
  const [items, setItems] = useState<Entry[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [currency, setCurrency] = useState("XAF");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [creating, setCreating] = useState(false);
  const [voiding, setVoiding] = useState<Entry | null>(null);

  const load = useCallback(async (offset: number) => {
    setBusy(true);
    const qs = `limit=${PAGE}&offset=${offset}${kind ? `&kind=${kind}` : ""}${showVoided ? "&include_voided=1" : ""}`;
    const res = await callApi("GET", `/api/reports/entries?${qs}`);
    setBusy(false);
    setLoaded(true);
    if (!res.ok) return setError(errorText(res.data));
    setError("");
    setCurrency(res.data.currency);
    setHasMore(res.data.has_more === true);
    setItems((prev) => (offset === 0 ? res.data.items : [...prev, ...res.data.items]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, showVoided]);
  useEffect(() => { load(0); }, [load]);

  const categoryText = (c: string | null) => (c ? (u.categories[c] ?? (c === "invoice_payment" ? u.fromInvoice : c)) : "");

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-display text-xl font-medium text-ringo-text">{u.title}</h1>
          <p className="mt-1 text-sm text-ringo-muted">{u.intro}</p>
        </div>
        <button className={primaryButton} onClick={() => { setSaved(false); setCreating(true); }}><Plus size={15} />{u.newEntry}</button>
      </div>
      {saved && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">{u.saved}</p>}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className={labelClass}>{u.filterKind}
          <select className={inputClass} value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">{u.allKinds}</option>
            {ENTRY_KINDS.map((k) => <option key={k} value={k}>{u.kind[k]}</option>)}
          </select>
        </label>
        <label className="flex min-h-[44px] items-center gap-2 text-sm text-ringo-text">
          <input type="checkbox" className="accent-ringo-indigo" checked={showVoided} onChange={(e) => setShowVoided(e.target.checked)} />
          {u.showVoided}
        </label>
      </div>

      {error && <p role="alert" className="rounded-card bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-400">{error}</p>}
      {!loaded && busy && <p className="flex items-center gap-2 text-sm text-ringo-muted"><Loader2 size={14} className="animate-spin" />{u.loading}</p>}
      {loaded && !error && items.length === 0 && <p className="text-sm text-ringo-muted">{u.empty}</p>}

      <ul className="flex flex-col gap-2">
        {items.map((e) => (
          <li key={e.id} className={`flex flex-col gap-2 rounded-card border border-ringo-border p-3 sm:flex-row sm:items-center sm:justify-between ${e.voided_at ? "opacity-60" : ""}`}>
            <div className="min-w-0">
              <p className="text-sm font-medium text-ringo-text">{u.kind[e.kind] ?? e.kind}{e.category ? <span className="font-normal text-ringo-muted"> · {categoryText(e.category)}</span> : null}</p>
              <p className="text-xs text-ringo-muted">{fmt.day(e.entry_date)}{e.description ? ` · ${e.description}` : ""}</p>
              <div className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
                {e.voided_at && <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-rose-700 dark:text-rose-400">{u.voided}</span>}
                {!e.cash_settled && !e.voided_at && <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-amber-700 dark:text-amber-400">{OUT_KINDS.includes(e.kind) ? u.notPaid : u.notReceived}</span>}
                {e.invoice_payment && <span className="rounded-full bg-sky-500/10 px-2 py-0.5 text-sky-700 dark:text-sky-400">{u.fromInvoice}</span>}
              </div>
              {e.voided_at && e.void_reason && <p className="mt-1 text-xs text-ringo-muted">{u.voidReasonShown(e.void_reason)}</p>}
              {e.invoice_payment && !e.voided_at && <p className="mt-1 text-xs text-ringo-muted">{u.invoicePaymentManaged}</p>}
            </div>
            <div className="flex items-center gap-3 sm:flex-col sm:items-end">
              <span className={`whitespace-nowrap text-sm font-medium ${OUT_KINDS.includes(e.kind) ? "text-rose-700 dark:text-rose-400" : "text-ringo-text"}`}>
                {e.amount_minor === null ? "?" : `${OUT_KINDS.includes(e.kind) ? "- " : ""}${fmt.money(e.amount_minor, e.currency)}`}
              </span>
              {!e.voided_at && !e.invoice_payment && <button className={`${dangerButton} !min-h-[36px] !px-3 !py-1 text-xs`} onClick={() => setVoiding(e)}>{u.voidAction}</button>}
            </div>
          </li>
        ))}
      </ul>
      {hasMore && <button className={secondaryButton} disabled={busy} onClick={() => load(items.length)}>{u.loadMore}</button>}

      {creating && <EntryForm currency={currency} onClose={() => setCreating(false)} onDone={() => { setCreating(false); setSaved(true); load(0); }} />}
      {voiding && <VoidDialog entry={voiding} onClose={() => setVoiding(null)} onDone={() => { setVoiding(null); load(0); }} />}
    </div>
  );
}

function EntryForm({ currency, onClose, onDone }: { currency: string; onClose: () => void; onDone: () => void }) {
  const { t } = useLanguage();
  const u = t.bookkeeping.ui;
  const errorText = useBookkeepingErrorText();
  const [kind, setKind] = useState("expense");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(() => todayKeyOf(new Date()));
  const [preset, setPreset] = useState("");
  const [custom, setCustom] = useState("");
  const [description, setDescription] = useState("");
  const [settled, setSettled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rid] = useState(newRequestId); // one id per open form: a double click or a retry replays instead of recording twice
  const cashKind = kind === "cash_in" || kind === "cash_out";
  const category = cashKind ? "" : preset === "__other" ? custom.trim() : preset;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const res = await callApi("POST", "/api/bookkeeping/entries", {
      kind,
      amount: amount.trim().replace(",", "."),
      entry_date: date,
      category: category || undefined,
      description: description.trim() || undefined,
      cash_settled: cashKind ? true : settled,
      client_request_id: rid,
    });
    setBusy(false);
    if (!res.ok) return setError(errorText(res.data));
    onDone();
  };

  return (
    <Modal title={u.newEntry} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label className={labelClass}>{u.entryType}
          <select className={inputClass} value={kind} onChange={(e) => { setKind(e.target.value); setSettled(true); }}>
            {ENTRY_KINDS.map((k) => <option key={k} value={k}>{u.kind[k]}</option>)}
          </select>
        </label>
        <p className="-mt-1 text-xs text-ringo-muted">{u.kindHelp[kind]}</p>
        <label className={labelClass}>{u.amount} ({currency})<input className={inputClass} inputMode="decimal" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        <label className={labelClass}>{u.date}<input className={inputClass} type="date" max={todayKeyOf(new Date())} value={date} onChange={(e) => setDate(e.target.value)} /></label>
        {!cashKind && (
          <>
            <label className={labelClass}>{u.category}
              <select className={inputClass} value={preset} onChange={(e) => setPreset(e.target.value)}>
                <option value="">{u.noCategory}</option>
                {PRESETS.map((c) => <option key={c} value={c}>{u.categories[c]}</option>)}
                <option value="__other">{u.categoryOther}</option>
              </select>
            </label>
            {preset === "__other" && <label className={labelClass}>{u.categoryName}<input className={inputClass} maxLength={60} value={custom} onChange={(e) => setCustom(e.target.value)} /></label>}
          </>
        )}
        <label className={labelClass}>{u.description}<input className={inputClass} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
        {!cashKind && (
          <div>
            <label className="flex min-h-[44px] items-center gap-2 text-sm text-ringo-text">
              <input type="checkbox" className="accent-ringo-indigo" checked={settled} onChange={(e) => setSettled(e.target.checked)} />
              {kind === "expense" ? u.settledOut : u.settledIn}
            </label>
            <p className="text-xs text-ringo-muted">{u.settledNote}</p>
          </div>
        )}
        <p className="text-xs text-ringo-muted">{u.currencyNote(currency)}</p>
        {error && <p role="alert" className="text-sm text-rose-700 dark:text-rose-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={secondaryButton} onClick={onClose}>{u.cancel}</button>
          <button type="submit" className={primaryButton} disabled={busy}>{busy ? u.saving : u.save}</button>
        </div>
      </form>
    </Modal>
  );
}

function VoidDialog({ entry, onClose, onDone }: { entry: Entry; onClose: () => void; onDone: () => void }) {
  const { t } = useLanguage();
  const u = t.bookkeeping.ui;
  const errorText = useBookkeepingErrorText();
  const fmt = useFormat();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!reason.trim()) return setError(t.bookkeeping.errors.reason_required);
    setBusy(true);
    setError("");
    const res = await callApi("POST", `/api/bookkeeping/entries/${entry.id}/void`, { reason: reason.trim() });
    setBusy(false);
    if (!res.ok) return setError(errorText(res.data));
    onDone();
  };
  return (
    <Modal title={u.voidTitle} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <p className="text-sm text-ringo-text">{u.kind[entry.kind]} · {entry.amount_minor === null ? "?" : fmt.money(entry.amount_minor, entry.currency)} · {fmt.day(entry.entry_date)}</p>
        <p className="text-sm text-ringo-muted">{u.voidBody}</p>
        <label className={labelClass}>{u.voidReason}<input className={inputClass} autoFocus maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        {error && <p role="alert" className="text-sm text-rose-700 dark:text-rose-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={secondaryButton} onClick={onClose}>{u.cancel}</button>
          <button type="submit" className={dangerButton} disabled={busy}>{busy ? u.saving : u.voidConfirm}</button>
        </div>
      </form>
    </Modal>
  );
}
