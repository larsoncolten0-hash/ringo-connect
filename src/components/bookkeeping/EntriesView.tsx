"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Clock, Loader2, Plus, Wallet, type LucideIcon } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { ENTRY_KINDS } from "@/lib/bookkeeping/summary";
import { todayKeyOf } from "@/lib/reports/period";
import EntryCorrectionDialog from "./EntryCorrectionDialog";
import { Modal, callApi, dangerButton, inputClass, labelClass, newRequestId, primaryButton, secondaryButton, useBookkeepingErrorText, useFormat } from "@/components/reports/shared";

type Entry = {
  id: string; kind: string; amount_minor: number | null; currency: string; entry_date: string; category: string | null; description: string | null;
  cash_settled: boolean; voided_at: string | null; void_reason: string | null; created_at: string; invoice_payment: boolean;
  replaces_entry_id?: string | null; replaced_by_id?: string | null; correctable?: boolean;
};
type Summary = { currency: string; revenue: { totalMinor: number }; expenses: { totalMinor: number }; cash: { netMovementMinor: number }; uncollected: { salesMinor: number; otherIncomeMinor: number } };
const PAGE = 25;
const PRESETS = ["rent", "transport", "salaries", "supplies", "utilities", "marketing", "stock_purchase"];
const OUT_KINDS = ["expense", "cash_out"];
const IN_KINDS = ["sale", "other_income", "cash_in"];

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
  const [creating, setCreating] = useState<null | "sale" | "expense">(null); // which entry the form opens on: Add income or Add expense
  const [summary, setSummary] = useState<Summary | null>(null);
  const [voiding, setVoiding] = useState<Entry | null>(null);
  const [correcting, setCorrecting] = useState<Entry | null>(null);
  const [corrected, setCorrected] = useState(false);

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

  // this month's totals, computed by the server (read-only); if they cannot be read the cards simply stay away, the list still works
  const loadSummary = useCallback(async () => {
    const res = await callApi("GET", "/api/bookkeeping/summary");
    if (res.ok && res.data?.summary) setSummary(res.data.summary);
  }, []);
  useEffect(() => { loadSummary(); }, [loadSummary]);
  const reload = () => { load(0); loadSummary(); };

  const money = (e: Entry) => (e.amount_minor === null ? "?" : fmt.money(e.amount_minor, e.currency));
  // the correction chain, shown from the entries already on screen (the other end may be on another page or hidden)
  const chainReplacedBy = (e: Entry) => { const r = items.find((x) => x.id === e.replaced_by_id); return r ? u.chainReplacedBy(fmt.day(r.entry_date), money(r)) : u.chainReplacedByOther; };
  const chainReplaces = (e: Entry) => { const o = items.find((x) => x.id === e.replaces_entry_id); return o ? u.chainReplaces(fmt.day(o.entry_date), money(o)) : u.chainReplacesOther; };
  const categoryText = (c: string | null) => (c ? (u.categories[c] ?? (c === "invoice_payment" ? u.fromInvoice : c)) : "");

  const owed = summary ? summary.uncollected.salesMinor + summary.uncollected.otherIncomeMinor : 0;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-xl font-medium text-ringo-text">{u.title}</h1>
        <p className="mt-1 text-sm text-ringo-muted">{u.intro}</p>
      </div>

      {summary && (
        <section aria-label={u.thisMonth} className="flex flex-col gap-2">
          <h2 className="text-xs font-medium uppercase tracking-wider text-ringo-muted">{u.thisMonth}</h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <SummaryCard icon={ArrowDownLeft} tone="in" label={u.summaryRevenue} value={fmt.money(summary.revenue.totalMinor, summary.currency)} />
            <SummaryCard icon={ArrowUpRight} tone="out" label={u.summaryExpenses} value={fmt.money(summary.expenses.totalMinor, summary.currency)} />
            <SummaryCard icon={Wallet} tone="net" label={u.summaryNetCash} hint={u.summaryNetCashHint} value={fmt.money(summary.cash.netMovementMinor, summary.currency)} />
            {owed > 0 && <SummaryCard icon={Clock} tone="owed" label={u.summaryOwed} value={fmt.money(owed, summary.currency)} />}
          </div>
        </section>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <button className={primaryButton} onClick={() => { setSaved(false); setCorrected(false); setCreating("sale"); }}><Plus size={15} />{u.addIncome}</button>
        <button className={secondaryButton} onClick={() => { setSaved(false); setCorrected(false); setCreating("expense"); }}><Plus size={15} />{u.addExpense}</button>
      </div>
      {saved && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">{u.saved}</p>}
      {corrected && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">{u.corrected}</p>}

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
      {loaded && !error && items.length === 0 && (
        <div className="flex flex-col items-start gap-1 rounded-2xl border border-dashed border-ringo-border p-5">
          <p className="font-display text-base font-medium text-ringo-text">{u.emptyTitle}</p>
          <p className="text-sm text-ringo-muted">{u.emptyBody}</p>
        </div>
      )}

      <ul className="flex flex-col gap-2">
        {items.map((e) => (
          <li key={e.id} className={`flex flex-col gap-2 rounded-card border border-ringo-border p-3 sm:flex-row sm:items-center sm:justify-between ${e.voided_at ? "opacity-60" : ""}`}>
            <div className="min-w-0">
              <p className="text-sm font-medium text-ringo-text">{u.kind[e.kind] ?? e.kind}{e.category ? <span className="font-normal text-ringo-muted"> · {categoryText(e.category)}</span> : null}</p>
              <p className="text-xs text-ringo-muted">{fmt.day(e.entry_date)}{e.description ? ` · ${e.description}` : ""}</p>
              <div className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
                {e.voided_at && <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-rose-700 dark:text-rose-400">{u.voided}</span>}
                {!e.cash_settled && !e.voided_at && <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-amber-700 dark:text-amber-400">{OUT_KINDS.includes(e.kind) ? u.notPaid : u.notReceived}</span>}
                {e.invoice_payment && <span title={`${u.invoicePaymentManaged} ${u.invoicePaymentCorrect}`} className="rounded-full bg-sky-500/10 px-2 py-0.5 text-sky-700 dark:text-sky-400">{u.fromInvoice}</span>}
                {e.replaced_by_id && <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-violet-700 dark:text-violet-400">{u.chainCorrected}</span>}
                {e.replaces_entry_id && <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-violet-700 dark:text-violet-400">{u.chainCorrection}</span>}
              </div>
              {e.replaced_by_id && <p className="mt-1 text-xs text-ringo-muted">{chainReplacedBy(e)}</p>}
              {e.replaces_entry_id && <p className="mt-1 text-xs text-ringo-muted">{chainReplaces(e)}</p>}
              {e.invoice_payment && !e.voided_at && <p className="mt-1 text-xs text-ringo-muted">{u.invoicePaymentCorrect}</p>}
              {e.voided_at && e.void_reason && !e.replaced_by_id && <p className="mt-1 text-xs text-ringo-muted">{u.voidReasonShown(e.void_reason)}</p>}
            </div>
            <div className="flex items-center gap-3 sm:flex-col sm:items-end">
              <span className={`whitespace-nowrap text-sm font-medium ${OUT_KINDS.includes(e.kind) ? "text-rose-700 dark:text-rose-400" : IN_KINDS.includes(e.kind) ? "text-emerald-700 dark:text-emerald-400" : "text-ringo-text"}`}>
                {e.amount_minor === null ? "?" : `${OUT_KINDS.includes(e.kind) ? "- " : IN_KINDS.includes(e.kind) ? "+ " : ""}${fmt.money(e.amount_minor, e.currency)}`}
              </span>
              {!e.voided_at && e.correctable && !e.invoice_payment && <button className={`${secondaryButton} !px-3 !py-1 text-xs`} onClick={() => { setSaved(false); setCorrected(false); setCorrecting(e); }}>{u.correct}</button>}
              {!e.voided_at && !e.invoice_payment && <button className={`${dangerButton} !px-3 !py-1 text-xs`} onClick={() => setVoiding(e)}>{u.voidAction}</button>}
            </div>
          </li>
        ))}
      </ul>
      {hasMore && <button className={secondaryButton} disabled={busy} onClick={() => load(items.length)}>{u.loadMore}</button>}

      {creating && <EntryForm initialKind={creating} currency={currency} onClose={() => setCreating(null)} onDone={() => { setCreating(null); setSaved(true); reload(); }} />}
      {correcting && <EntryCorrectionDialog entry={correcting} onClose={() => setCorrecting(null)} onDone={() => { setCorrecting(null); setCorrected(true); reload(); }} />}
      {voiding && <VoidDialog entry={voiding} onClose={() => setVoiding(null)} onDone={() => { setVoiding(null); reload(); }} />}
    </div>
  );
}

const TONES: Record<string, string> = {
  in: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  out: "bg-rose-500/10 text-rose-700 dark:text-rose-400",
  net: "bg-ringo-indigo/10 text-ringo-indigo",
  owed: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
};
// One figure from the server's own summary: what it is, and how much. Nothing is computed here.
function SummaryCard({ icon: Icon, tone, label, value, hint }: { icon: LucideIcon; tone: "in" | "out" | "net" | "owed"; label: string; value: string; hint?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-2xl border border-ringo-border/70 bg-ringo-surface p-4">
      <span aria-hidden="true" className={`flex h-8 w-8 items-center justify-center rounded-xl ${TONES[tone]}`}><Icon size={16} /></span>
      <p className="text-xs text-ringo-muted">{label}</p>
      <p className="text-base sm:text-lg font-semibold tabular-nums tracking-[-0.01em] text-ringo-text">{value}</p>
      {hint && <p className="text-[11px] leading-tight text-ringo-muted">{hint}</p>}
    </div>
  );
}

function EntryForm({ initialKind, currency, onClose, onDone }: { initialKind: string; currency: string; onClose: () => void; onDone: () => void }) {
  const { t } = useLanguage();
  const u = t.bookkeeping.ui;
  const errorText = useBookkeepingErrorText();
  const [kind, setKind] = useState(initialKind);
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
