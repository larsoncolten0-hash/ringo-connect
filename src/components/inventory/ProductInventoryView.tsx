"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { currencyMinorDigits } from "@/lib/bookkeeping/money";
import { useLanguage } from "@/components/LanguageProvider";
import { ADJUST_KINDS, DEFAULT_LOW_STOCK_THRESHOLD, REASON_REQUIRED_KINDS, STOCK_LIMITS } from "@/lib/inventory/constants";
import { Modal, StateBadge, callApi, dangerButton, inputClass, labelClass, newRequestId, primaryButton, secondaryButton, useInvErrorText, useMoney } from "./shared";

type Detail = any;
type Dialog = null | "start" | "adjust" | "count" | "stop" | "restock";
const PAGE = 50;

/** One product: stock, Reserved vs Sold, settings, every movement, Shop order holds, and the manual operations. Every operation is one atomic
 * call to /api/inventory/products/[id]/**; this screen never computes or sends a stored quantity. */
export default function ProductInventoryView({ productId }: { productId: string }) {
  const { t } = useLanguage();
  const u = t.inventory.ui;
  const errorText = useInvErrorText();
  const fmt = useMoney();
  const [d, setD] = useState<Detail | null>(null);
  const [movements, setMovements] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [savedNote, setSavedNote] = useState(false);
  const api = `/api/inventory/products/${productId}`;

  const load = useCallback(async (offset = 0) => {
    const res = await callApi("GET", `${api}?limit=${PAGE}&offset=${offset}`);
    if (!res.ok) {
      if (res.status === 404) return setNotFound(true);
      return setError(errorText(res.data));
    }
    setError("");
    setD(res.data);
    setMovements((prev) => (offset === 0 ? res.data.movements : [...prev, ...res.data.movements]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);
  useEffect(() => { load(0); }, [load]);

  const back = <Link href="/dashboard/inventory" className="inline-flex items-center gap-1.5 text-sm text-ringo-muted hover:text-ringo-text"><ArrowLeft size={14} />{u.back}</Link>;
  if (notFound) return <div className="flex flex-col gap-4">{back}<p className="text-sm text-ringo-muted">{u.notFound}</p></div>;
  if (!d) return <div className="flex flex-col gap-4">{back}{error ? <p role="alert" className="text-sm text-rose-700">{error}</p> : <p className="flex items-center gap-2 text-sm text-ringo-muted"><Loader2 size={14} className="animate-spin" />{u.loading}</p>}</div>;

  const p = d.product;
  const cur: string = d.profile_currency;
  const tracked: boolean = d.tracked;
  const deleted = !p;
  const state = !tracked ? (d.legacy_count ? "legacy" : "untracked") : p && p.count === 0 ? "out" : p && d.settings && p.count <= d.settings.low_stock_threshold ? "low" : "ok";
  const done = () => { setDialog(null); setSavedNote(true); load(0); };

  return (
    <div className="flex flex-col gap-5">
      {back}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="truncate font-display text-xl font-medium text-ringo-text">{p ? p.name : u.deletedProduct}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2"><StateBadge state={state} />{d.settings?.sku && <span className="text-xs text-ringo-muted">{u.sku}: {d.settings.sku}</span>}</div>
        </div>
        {!deleted && (
          <div className="flex flex-wrap gap-2">
            {!tracked && <button className={primaryButton} onClick={() => setDialog("start")}>{d.legacy_count ? u.adoptTracking : u.startTracking}</button>}
            {tracked && <button className={primaryButton} onClick={() => setDialog("adjust")}>{u.adjust}</button>}
            {tracked && <button className={secondaryButton} onClick={() => setDialog("count")}>{u.correct}</button>}
            {tracked && <button className={secondaryButton} onClick={() => setDialog("restock")}>{u.restockTitle}</button>}
            {tracked && <button className={dangerButton} onClick={() => setDialog("stop")}>{u.stopTracking}</button>}
          </div>
        )}
      </div>
      {error && <p role="alert" className="rounded-card bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-400">{error}</p>}
      {savedNote && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">{u.saved}</p>}
      {deleted && <p className="text-sm text-ringo-muted">{u.deletedProduct}</p>}

      {p && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label={u.onHand} value={p.count === null ? u.unlimited : String(p.count)} />
          {tracked && <Stat label={u.reserved} value={String(d.reserved)} help={u.reservedHelp} />}
          {tracked && <Stat label={u.sold} value={String(d.sold_units)} help={u.soldHelp} />}
          {tracked && d.estimated_value_minor !== null && <Stat label={u.value} value={fmt.money(d.estimated_value_minor, cur)} help={u.estimateNote(cur)} />}
        </div>
      )}
      {tracked && d.drift !== 0 && <p className="rounded-card bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">{u.drift(d.drift)}</p>}
      {!tracked && d.legacy_count && p && <p className="text-sm text-ringo-muted">{u.startLegacy(p.count)}</p>}

      {tracked && d.settings && <SettingsForm api={api} settings={d.settings} cur={cur} onSaved={done} />}

      <section className="flex flex-col gap-2">
        <h2 className="font-display text-base font-medium text-ringo-text">{u.historyTitle}</h2>
        {movements.length === 0 && <p className="text-sm text-ringo-muted">{u.historyEmpty}</p>}
        <ul className="flex flex-col gap-2">
          {movements.map((m) => (
            <li key={m.id} className="rounded-card border border-ringo-border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-ringo-text">{u.kind[m.kind] ?? m.kind}</span>
                <span className={m.qty_delta < 0 ? "text-rose-700 dark:text-rose-400" : "text-emerald-700 dark:text-emerald-400"}>{m.qty_delta > 0 ? "+" : ""}{m.qty_delta}</span>
              </div>
              <p className="text-xs text-ringo-muted">{u.balanceChange(m.balance_before, m.balance_after)} · {fmt.when(m.created_at)}</p>
              {(m.reason || m.note) && <p className="mt-1 text-xs text-ringo-muted">{[m.reason, m.note].filter(Boolean).join(" — ")}</p>}
            </li>
          ))}
        </ul>
        {d.movement_total > movements.length && <button className={secondaryButton} onClick={() => load(movements.length)}>{u.loadMore}</button>}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-display text-base font-medium text-ringo-text">{u.ordersTitle}</h2>
        {(d.order_events || []).length === 0 && <p className="text-sm text-ringo-muted">{u.ordersEmpty}</p>}
        <ul className="flex flex-col gap-2">
          {(d.order_events || []).map((o: any) => (
            <li key={`${o.order_number}`} className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-ringo-border p-3 text-sm">
              <span className="text-ringo-text">#{o.order_number} · ×{o.quantity}</span>
              <span className="text-xs text-ringo-muted">{u.orderStatus[o.status] ?? o.status}{o.holding ? ` · ${u.holding}` : o.released_at ? ` · ${u.released}` : ""}</span>
            </li>
          ))}
        </ul>
      </section>

      {dialog === "start" && <StartDialog api={api} legacy={d.legacy_count ? p.count : null} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === "adjust" && <AdjustDialog api={api} cur={cur} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === "count" && <CountDialog api={api} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === "stop" && <StopDialog api={api} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === "restock" && <RestockDialog api={api} onClose={() => setDialog(null)} onDone={done} />}
    </div>
  );
}

function Stat({ label, value, help }: { label: string; value: string; help?: string }) {
  return (
    <div className="rounded-card border border-ringo-border p-3">
      <p className="text-xs text-ringo-muted">{label}</p>
      <p className="mt-1 text-lg font-medium text-ringo-text">{value}</p>
      {help && <p className="mt-1 text-[11px] leading-snug text-ringo-muted">{help}</p>}
    </div>
  );
}

/** Shared submit plumbing: one request id per dialog (so a double click or a retry replays instead of repeating), busy flag, error text. */
function useSubmit(onDone: () => void) {
  const errorText = useInvErrorText();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rid] = useState(newRequestId);
  const run = async (method: string, url: string, body: Record<string, unknown>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    const res = await callApi(method, url, { ...body, client_request_id: rid });
    setBusy(false);
    if (!res.ok) return setError(errorText(res.data));
    onDone();
  };
  return { busy, error, run };
}

const toInt = (v: string): number | null => (/^\d{1,10}$/.test(v.trim()) ? Number(v.trim()) : null);
const Err = ({ text }: { text: string }) => (text ? <p role="alert" className="text-sm text-rose-700 dark:text-rose-400">{text}</p> : null);

function SettingsForm({ api, settings, cur, onSaved }: { api: string; settings: any; cur: string; onSaved: () => void }) {
  const { t } = useLanguage();
  const u = t.inventory.ui;
  const errorText = useInvErrorText();
  const [thr, setThr] = useState(String(settings.low_stock_threshold));
  const [sku, setSku] = useState(settings.sku ?? "");
  const costCur: string = settings.cost_currency || cur;
  const existing: string | null = settings.unit_cost_minor === null ? null : minorToDecimal(settings.unit_cost_minor, costCur);
  const [cost, setCost] = useState(existing ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setBusy(true);
    setError("");
    const res = await callApi("PUT", `${api}/settings`, { low_stock_threshold: toInt(thr) ?? -1, sku: sku.trim() || null, unit_cost: cost.trim() || null });
    setBusy(false);
    if (!res.ok) return setError(errorText(res.data));
    onSaved();
  };
  return (
    <section className="flex flex-col gap-3 rounded-card border border-ringo-border p-4">
      <h2 className="font-display text-base font-medium text-ringo-text">{u.settingsTitle}</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className={labelClass}>{u.lowLevel}<input className={inputClass} inputMode="numeric" value={thr} onChange={(e) => setThr(e.target.value)} /></label>
        <label className={labelClass}>{u.sku}<input className={inputClass} maxLength={STOCK_LIMITS.sku} value={sku} onChange={(e) => setSku(e.target.value)} /></label>
        <label className={labelClass}>{u.unitCostOptional} ({costCur})
          <input className={inputClass} inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} />
        </label>
      </div>
      <p className="text-xs text-ringo-muted">{u.lowLevelHelp}</p>
      <Err text={error} />
      <div><button className={primaryButton} disabled={busy} onClick={save}>{busy ? u.saving : u.saveSettings}</button></div>
    </section>
  );
}

/** Integer minor units back to an exact decimal string, using the currency's own digits (no floats). */
function minorToDecimal(minor: number, cur: string): string {
  const digits = currencyMinorDigits(cur);
  const str = String(Math.abs(minor)).padStart(digits + 1, "0");
  return digits === 0 ? str : `${str.slice(0, -digits)}.${str.slice(-digits)}`;
}

function Actions({ busy, onClose, label }: { busy: boolean; onClose: () => void; label?: string }) {
  const { t } = useLanguage();
  return (
    <div className="flex justify-end gap-2">
      <button type="button" className={secondaryButton} onClick={onClose}>{t.inventory.ui.cancel}</button>
      <button type="submit" className={primaryButton} disabled={busy}>{busy ? t.inventory.ui.saving : label ?? t.inventory.ui.submit}</button>
    </div>
  );
}

function StartDialog({ api, legacy, onClose, onDone }: { api: string; legacy: number | null; onClose: () => void; onDone: () => void }) {
  const { t } = useLanguage();
  const u = t.inventory.ui;
  const { busy, error, run } = useSubmit(onDone);
  const [qty, setQty] = useState("");
  const [thr, setThr] = useState(String(DEFAULT_LOW_STOCK_THRESHOLD));
  const [local, setLocal] = useState("");
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const opening = legacy === null ? toInt(qty) : null;
    const threshold = toInt(thr);
    if ((legacy === null && opening === null) || threshold === null) return setLocal(legacy === null && opening === null ? t.inventory.errors.openingRequired : t.inventory.errors.invalidThreshold);
    setLocal("");
    run("POST", `${api}/start`, { opening_quantity: opening, low_stock_threshold: threshold });
  };
  return (
    <Modal title={u.startTitle} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <p className="text-sm text-ringo-muted">{legacy === null ? u.startNew : u.startLegacy(legacy)}</p>
        {legacy === null && <label className={labelClass}>{u.openingQuantity}<input className={inputClass} inputMode="numeric" autoFocus value={qty} onChange={(e) => setQty(e.target.value)} /></label>}
        <label className={labelClass}>{u.lowLevel}<input className={inputClass} inputMode="numeric" value={thr} onChange={(e) => setThr(e.target.value)} /></label>
        <p className="text-xs text-ringo-muted">{u.lowLevelHelp}</p>
        <Err text={local || error} />
        <Actions busy={busy} onClose={onClose} label={legacy === null ? u.startTracking : u.adoptTracking} />
      </form>
    </Modal>
  );
}

function AdjustDialog({ api, cur, onClose, onDone }: { api: string; cur: string; onClose: () => void; onDone: () => void }) {
  const { t } = useLanguage();
  const u = t.inventory.ui;
  const { busy, error, run } = useSubmit(onDone);
  const [kind, setKind] = useState<string>("stock_in");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [cost, setCost] = useState("");
  const [local, setLocal] = useState("");
  const needsReason = REASON_REQUIRED_KINDS.includes(kind);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const n = toInt(qty);
    if (n === null || n < 1) return setLocal(t.inventory.errors.invalidQuantity);
    if (needsReason && !reason.trim()) return setLocal(t.inventory.errors.reasonRequired);
    setLocal("");
    run("POST", `${api}/adjust`, { kind, quantity: n, reason: reason.trim() || null, note: note.trim() || null, unit_cost: kind === "stock_in" && cost.trim() ? cost.trim() : null });
  };
  return (
    <Modal title={u.adjust} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label className={labelClass}>{u.adjust}
          <select className={inputClass} value={kind} onChange={(e) => setKind(e.target.value)}>
            {ADJUST_KINDS.map((k) => <option key={k} value={k}>{u.kind[k]}</option>)}
          </select>
        </label>
        {kind === "sold_elsewhere" && <p className="text-xs text-ringo-muted">{u.soldElsewhereHelp}</p>}
        <label className={labelClass}>{u.quantity}<input className={inputClass} inputMode="numeric" autoFocus value={qty} onChange={(e) => setQty(e.target.value)} /></label>
        <label className={labelClass}>{needsReason ? u.reason : u.reasonOptional}<input className={inputClass} maxLength={STOCK_LIMITS.reason} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        {kind === "stock_in" && <label className={labelClass}>{u.unitCostOptional} ({cur})<input className={inputClass} inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} /></label>}
        <label className={labelClass}>{u.note}<input className={inputClass} maxLength={STOCK_LIMITS.note} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <Err text={local || error} />
        <Actions busy={busy} onClose={onClose} />
      </form>
    </Modal>
  );
}

function CountDialog({ api, onClose, onDone }: { api: string; onClose: () => void; onDone: () => void }) {
  const { t } = useLanguage();
  const u = t.inventory.ui;
  const { busy, error, run } = useSubmit(onDone);
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [local, setLocal] = useState("");
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const n = toInt(target);
    if (n === null) return setLocal(t.inventory.errors.invalidQuantity);
    if (!reason.trim()) return setLocal(t.inventory.errors.reasonRequired);
    setLocal("");
    run("POST", `${api}/count`, { target: n, reason: reason.trim(), note: note.trim() || null });
  };
  return (
    <Modal title={u.correct} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label className={labelClass}>{u.countedQuantity}<input className={inputClass} inputMode="numeric" autoFocus value={target} onChange={(e) => setTarget(e.target.value)} /></label>
        <label className={labelClass}>{u.reason}<input className={inputClass} maxLength={STOCK_LIMITS.reason} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        <label className={labelClass}>{u.note}<input className={inputClass} maxLength={STOCK_LIMITS.note} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <Err text={local || error} />
        <Actions busy={busy} onClose={onClose} />
      </form>
    </Modal>
  );
}

function StopDialog({ api, onClose, onDone }: { api: string; onClose: () => void; onDone: () => void }) {
  const { t } = useLanguage();
  const u = t.inventory.ui;
  const { busy, error, run } = useSubmit(onDone);
  return (
    <Modal title={u.stopTitle} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); run("POST", `${api}/stop`, {}); }} className="flex flex-col gap-3">
        <p className="text-sm text-ringo-muted">{u.stopBody}</p>
        <Err text={error} />
        <div className="flex justify-end gap-2">
          <button type="button" className={secondaryButton} onClick={onClose}>{u.cancel}</button>
          <button type="submit" className={dangerButton} disabled={busy}>{busy ? u.saving : u.stopConfirm}</button>
        </div>
      </form>
    </Modal>
  );
}

function RestockDialog({ api, onClose, onDone }: { api: string; onClose: () => void; onDone: () => void }) {
  const { t } = useLanguage();
  const u = t.inventory.ui;
  const errorText = useInvErrorText();
  const fmt = useMoney();
  const [orders, setOrders] = useState<any[] | null>(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [qty, setQty] = useState<Record<string, string>>({});
  const [rids, setRids] = useState<Record<string, string>>({});
  useEffect(() => {
    callApi("GET", `${api}/refunded-orders`).then((res) => (res.ok ? setOrders(res.data.items) : setError(errorText(res.data))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);
  const restock = async (o: any) => {
    const n = toInt(qty[o.order_id] ?? "");
    if (n === null || n < 1 || n > o.returnable) return setError(t.inventory.errors.exceedsReturnable);
    const rid = rids[o.order_id] ?? newRequestId();
    setRids((r) => ({ ...r, [o.order_id]: rid }));
    setBusyId(o.order_id);
    setError("");
    const res = await callApi("POST", `${api}/restock`, { order_id: o.order_id, quantity: n, client_request_id: rid });
    setBusyId("");
    if (!res.ok) return setError(errorText(res.data));
    onDone();
  };
  return (
    <Modal title={u.restockTitle} onClose={onClose}>
      <p className="text-sm text-ringo-muted">{u.restockIntro}</p>
      {!orders && !error && <p className="text-sm text-ringo-muted">{u.loading}</p>}
      {orders && orders.length === 0 && <p className="text-sm text-ringo-muted">{u.noRefunded}</p>}
      <ul className="flex flex-col gap-3">
        {(orders || []).map((o) => (
          <li key={o.order_id} className="flex flex-col gap-2 rounded-card border border-ringo-border p-3 text-sm">
            <p className="font-medium text-ringo-text">#{o.order_number} · {fmt.when(o.created_at)}</p>
            <p className="text-xs text-ringo-muted">{u.ordered}: {o.ordered} · {u.restocked}: {o.restocked} · {u.returnable}: {o.returnable}</p>
            {o.returnable > 0 && (
              <div className="flex gap-2">
                <input aria-label={u.quantity} className={inputClass} inputMode="numeric" placeholder={u.quantity} value={qty[o.order_id] ?? ""} onChange={(e) => setQty((q) => ({ ...q, [o.order_id]: e.target.value }))} />
                <button className={primaryButton} disabled={busyId === o.order_id} onClick={() => restock(o)}>{busyId === o.order_id ? u.saving : u.restock}</button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <Err text={error} />
    </Modal>
  );
}
