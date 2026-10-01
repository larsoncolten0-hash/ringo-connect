"use client";

import { useState } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import { currencyMinorDigits, parseMinor } from "@/lib/bookkeeping/money";
import { todayKeyOf } from "@/lib/reports/period";
import { Modal, callApi, inputClass, labelClass, newRequestId, primaryButton, secondaryButton, useBookkeepingErrorText, useFormat } from "@/components/reports/shared";

export type CorrectableEntry = {
  id: string; kind: string; amount_minor: number | null; currency: string; entry_date: string; category: string | null; description: string | null; cash_settled: boolean;
};
const PRESETS = ["rent", "transport", "salaries", "supplies", "utilities", "marketing", "stock_purchase"];
const OUT_KINDS = ["expense", "cash_out"];

/** Correct ONE entry. The server decides everything (kind and order link come from the original, invoice-payment and voided entries are refused, the
 * request id makes a double submit replay); this dialog only collects the editable fields, previews before/after, and asks for confirmation. */
export default function EntryCorrectionDialog({ entry, onClose, onDone }: { entry: CorrectableEntry; onClose: () => void; onDone: () => void }) {
  const { t } = useLanguage();
  const u = t.bookkeeping.ui;
  const errorText = useBookkeepingErrorText();
  const fmt = useFormat();
  const digits = currencyMinorDigits(entry.currency);
  const cashKind = entry.kind === "cash_in" || entry.kind === "cash_out";
  const out = OUT_KINDS.includes(entry.kind);
  const isPreset = !!entry.category && PRESETS.includes(entry.category);
  const [amount, setAmount] = useState(entry.amount_minor === null ? "" : (entry.amount_minor / 10 ** digits).toFixed(digits));
  const [date, setDate] = useState(entry.entry_date);
  const [preset, setPreset] = useState(entry.category ? (isPreset ? entry.category : "__other") : "");
  const [custom, setCustom] = useState(entry.category && !isPreset ? entry.category : "");
  const [description, setDescription] = useState(entry.description ?? "");
  const [settled, setSettled] = useState(entry.cash_settled);
  const [stage, setStage] = useState<"edit" | "confirm">("edit");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rid] = useState(newRequestId); // one id per open dialog: a double click or a retry replays the same correction instead of making a second one

  const newCategory = cashKind ? null : (preset === "__other" ? custom.trim() : preset) || null;
  const newMinor = parseMinor(amount.trim().replace(",", "."), digits);
  const catText = (c: string | null) => (c ? (u.categories[c] ?? c) : u.noCategory);
  const money = (minor: number | null) => (minor === null ? "?" : fmt.money(minor, entry.currency));
  const rows = [
    { label: u.amount, before: money(entry.amount_minor), after: newMinor === null ? "?" : money(newMinor), changed: newMinor !== entry.amount_minor },
    { label: u.date, before: fmt.day(entry.entry_date), after: fmt.day(date), changed: date !== entry.entry_date },
    ...(cashKind ? [] : [
      { label: u.category, before: catText(entry.category), after: catText(newCategory), changed: (newCategory ?? null) !== (entry.category ?? null) },
      { label: out ? u.settledOut : u.settledIn, before: u.settledValue(entry.cash_settled, out), after: u.settledValue(settled, out), changed: settled !== entry.cash_settled },
    ]),
    { label: u.description, before: entry.description || "-", after: description.trim() || "-", changed: (description.trim() || null) !== ((entry.description ?? "").trim() || null) },
  ];
  const anyChange = rows.some((r) => r.changed);

  const review = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!anyChange) return setError(u.correctNoChange);
    setStage("confirm");
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    const res = await callApi("POST", `/api/reports/entries/${encodeURIComponent(entry.id)}/correct`, {
      amount: amount.trim().replace(",", "."),
      entry_date: date,
      category: newCategory,
      description: description.trim() || null,
      ...(cashKind ? {} : { cash_settled: settled }),
      client_request_id: rid,
    });
    setBusy(false);
    if (!res.ok) { setStage("edit"); return setError(errorText(res.data)); }
    onDone();
  };

  return (
    <Modal title={stage === "edit" ? u.correctTitle : u.correctConfirmTitle} onClose={onClose}>
      {stage === "edit" ? (
        <form onSubmit={review} className="flex flex-col gap-3">
          <p className="rounded-card bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">{u.correctWarning}</p>
          <p className="text-xs text-ringo-muted">{u.correctKindFixed(u.kind[entry.kind] ?? entry.kind)}</p>
          <label className={labelClass}>{u.amount} ({entry.currency})<input className={inputClass} inputMode="decimal" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
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
                {out ? u.settledOut : u.settledIn}
              </label>
              <p className="text-xs text-ringo-muted">{u.settledNote}</p>
            </div>
          )}
          <p className="text-xs text-ringo-muted">{u.currencyNote(entry.currency)}</p>
          {error && <p role="alert" className="text-sm text-rose-700 dark:text-rose-400">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className={secondaryButton} onClick={onClose}>{u.cancel}</button>
            <button type="submit" className={primaryButton}>{u.correctReview}</button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-ringo-muted">{u.correctConfirmBody}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-ringo-muted"><th scope="col" className="py-1 pr-2 font-medium">&nbsp;</th><th scope="col" className="px-2 font-medium">{u.correctBefore}</th><th scope="col" className="pl-2 font-medium">{u.correctAfter}</th></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t border-ringo-border align-top">
                    <th scope="row" className="py-1.5 pr-2 text-left font-normal text-ringo-muted">{r.label}</th>
                    <td className="px-2">{r.before}</td>
                    <td className={`pl-2 ${r.changed ? "font-medium text-ringo-text" : "text-ringo-muted"}`}>{r.after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-ringo-muted">{u.correctWarning}</p>
          {error && <p role="alert" className="text-sm text-rose-700 dark:text-rose-400">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className={secondaryButton} disabled={busy} onClick={() => setStage("edit")}>{u.correctBack}</button>
            <button type="button" className={primaryButton} disabled={busy} onClick={submit}>{busy ? u.correctSaving : u.correctConfirm}</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
