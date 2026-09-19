"use client";

import { useRef, useState } from "react";
import { Check, Gift, Loader2, Minus, Package, Plus, ScanLine, Undo2, X } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import type { CustomerLoyaltyProfile, ProfileProgram } from "@/lib/loyalty/customerProfile";
import { actionText, api, codeOf, fmtDate, fmtDateTime, fmtMoney, fmtNumber, newKey, outcomeText } from "@/components/loyalty/format";

export interface TemplateOption {
  id: string;
  name: string;
  price: number | null;
  currency: string | null;
  durationDays: number;
  items: { actionKey: string; quantity: number }[];
}

type Notice = { kind: "ok" | "error"; text: string } | null;

const btnPrimary =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-ringo-indigo px-4 py-2.5 text-sm font-semibold text-white transition active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100";
const btnGhost =
  "inline-flex items-center justify-center gap-1.5 rounded-xl border border-ringo-border px-3 py-2 text-sm font-medium text-ringo-text transition hover:border-ringo-indigo/40 disabled:opacity-50";
const inputCls =
  "w-full rounded-xl border border-ringo-border bg-ringo-bg px-3 py-2.5 text-sm text-ringo-text focus:outline-none focus:ring-2 focus:ring-ringo-indigo/30";

export default function CustomerLoyaltyCard({
  profile,
  via,
  can,
  templates,
  onProfile,
  onDone,
}: {
  profile: CustomerLoyaltyProfile;
  via: "scan" | "search";
  can: { scan: boolean; manage: boolean; reverse: boolean };
  templates: TemplateOption[];
  onProfile: (p: CustomerLoyaltyProfile) => void;
  onDone: () => void;
}) {
  const { t, locale } = useLanguage();
  const L = t.loyalty;
  const connectionId = profile.connection.connectionId;

  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [tpl, setTpl] = useState("");
  const [payRef, setPayRef] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [reversing, setReversing] = useState<{ id: string; label: string; key: string } | null>(null);
  const [reason, setReason] = useState("");

  // One idempotency key per intended action. It is kept until the server has given a REAL
  // answer, so retrying after a dropped connection re-sends the same key (never double-records),
  // and a genuinely new action (different quantity / new progress) gets a fresh key.
  const keys = useRef(new Map<string, string>());
  const keyFor = (sig: string) => {
    let k = keys.current.get(sig);
    if (!k) {
      k = newKey();
      keys.current.set(sig, k);
    }
    return k;
  };

  const fail = (code: string | null) => setNotice({ kind: "error", text: code === "network" ? L.scan.network : outcomeText(L, code) });

  async function refresh() {
    const r = await api("/api/loyalty/customers/profile", { body: { connection_id: connectionId } });
    if (r.status === 200 && r.data?.profile) onProfile(r.data.profile);
  }

  async function guarded(id: string, fn: () => Promise<void>) {
    if (busy) return; // second line of defence behind the server's idempotency
    setBusy(id);
    setNotice(null);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  }

  const programQty = (p: ProfileProgram): number => {
    const raw = qty[p.programId] ?? (p.type === "visits" ? "1" : "");
    return /^\d+$/.test(raw) ? Number(raw) : 0;
  };

  const remainingOf = (p: ProfileProgram) => Math.max(p.target - p.progress, 0);

  function record(p: ProfileProgram) {
    const q = programQty(p);
    if (q < 1) return setNotice({ kind: "error", text: L.outcomes.invalid_quantity });
    return guarded(`rec:${p.programId}`, async () => {
      const sig = `rec:${p.programId}:${q}:${p.progress}:${p.cycle}`;
      const res = await api("/api/loyalty/activities", {
        body: { connection_id: connectionId, program_id: p.programId, quantity: q, idempotency_key: keyFor(sig), via },
      });
      if (res.status !== 0) keys.current.delete(sig);
      const code = codeOf(res);
      if (res.status === 200) {
        setNotice({ kind: "ok", text: res.data?.rewardUnlocked ? L.customer.rewardUnlocked : outcomeText(L, code) });
        setQty((s) => ({ ...s, [p.programId]: p.type === "visits" ? "1" : "" }));
      } else fail(code);
      await refresh();
    });
  }

  function redeem(rewardId: string) {
    return guarded(`redeem:${rewardId}`, async () => {
      const res = await api(`/api/loyalty/rewards/${rewardId}/redeem`, { body: { connection_id: connectionId } });
      const code = codeOf(res);
      if (res.status === 200) setNotice({ kind: "ok", text: outcomeText(L, code) });
      else fail(code);
      await refresh();
    });
  }

  function useCredit(creditId: string, remaining: number) {
    return guarded(`use:${creditId}`, async () => {
      const sig = `use:${creditId}:${remaining}`;
      const res = await api(`/api/loyalty/packages/credits/${creditId}/use`, {
        body: { connection_id: connectionId, quantity: 1, idempotency_key: keyFor(sig), via },
      });
      if (res.status !== 0) keys.current.delete(sig);
      const code = codeOf(res);
      if (res.status === 200) setNotice({ kind: "ok", text: outcomeText(L, code) });
      else fail(code);
      await refresh();
    });
  }

  function activate() {
    if (!tpl) return;
    return guarded("activate", async () => {
      const sig = `act:${tpl}:${payRef}:${startsAt}`;
      const body: Record<string, unknown> = { connection_id: connectionId, template_id: tpl, idempotency_key: keyFor(sig) };
      if (payRef.trim()) body.payment_reference = payRef.trim();
      if (startsAt) body.starts_at = new Date(startsAt).toISOString();
      const res = await api("/api/loyalty/packages/activate", { body });
      if (res.status !== 0) keys.current.delete(sig);
      const code = codeOf(res);
      if (res.status === 200) {
        setNotice({ kind: "ok", text: outcomeText(L, code) });
        setTpl("");
        setPayRef("");
        setStartsAt("");
      } else fail(code);
      await refresh();
    });
  }

  function confirmReverse() {
    if (!reversing) return;
    const trimmed = reason.trim();
    if (trimmed.length < 3) return;
    const target = reversing;
    return guarded(`rev:${target.id}`, async () => {
      const res = await api(`/api/loyalty/activities/${target.id}/reverse`, { body: { reason: trimmed, idempotency_key: target.key } });
      const code = codeOf(res);
      if (res.status === 200) {
        setNotice({ kind: "ok", text: outcomeText(L, code) });
        setReversing(null);
        setReason("");
      } else {
        // A real answer means the key is spent; give the next attempt a fresh one.
        if (res.status !== 0) setReversing({ ...target, key: newKey() });
        fail(code);
      }
      await refresh();
    });
  }

  const progressBar = (pct: number, done: boolean) => (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-ringo-muted/15" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full transition-all ${done ? "bg-ringo-teal" : "bg-ringo-indigo"}`} style={{ width: `${Math.min(Math.max(pct, 0), 100)}%` }} />
    </div>
  );

  const progressLabel = (p: ProfileProgram) => {
    const shown = Math.min(p.progress, p.target);
    if (p.type === "spend") return `${fmtMoney(shown, p.currency, locale)} / ${fmtMoney(p.target, p.currency, locale)}`;
    if (p.type === "points") return `${fmtNumber(shown, locale)} / ${fmtNumber(p.target, locale)} ${L.customer.points}`;
    return `${shown} / ${p.target} ${actionText(L, p.actionKey).many}`;
  };

  const remainingLabel = (p: ProfileProgram) => {
    const rem = remainingOf(p);
    if (p.type === "spend") return L.customer.remainingAmount(fmtMoney(rem, p.currency, locale));
    if (p.type === "points") return L.customer.remainingAmount(`${fmtNumber(rem, locale)} ${L.customer.points}`);
    return L.customer.remainingCount(rem, rem === 1 ? actionText(L, p.actionKey).one : actionText(L, p.actionKey).many);
  };

  const eligibleTemplates = templates.filter((x) => x.items.length > 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3 rounded-card border border-ringo-border/70 bg-ringo-surface p-4">
        <div className="min-w-0">
          <p className="truncate font-display text-lg font-bold text-ringo-text">{profile.connection.name}</p>
          <p className="text-xs text-ringo-muted">{L.customer.connectedSince(fmtDate(profile.connection.connectedAt, locale))}</p>
        </div>
        <button type="button" onClick={onDone} className={btnGhost}>
          <ScanLine size={15} /> {L.scan.scanAnother}
        </button>
      </div>

      <div aria-live="polite" role="status">
        {notice && (
          <p className={`rounded-xl px-4 py-3 text-sm font-medium ${notice.kind === "ok" ? "bg-emerald-500/10 text-emerald-600" : "bg-red-500/10 text-red-500"}`}>
            {notice.kind === "ok" && <Check size={14} className="mr-1.5 inline" />}
            {notice.text}
          </p>
        )}
      </div>

      {profile.rewards.length > 0 && (
        <section className="flex flex-col gap-2">
          {profile.rewards.map((r) => (
            <div key={r.id} className="flex flex-col gap-3 rounded-card border border-ringo-teal/40 bg-ringo-teal/[0.06] p-4 sm:flex-row sm:items-center">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ringo-teal/15 text-ringo-teal">
                <Gift size={20} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-ringo-teal">{L.customer.rewardReady}</p>
                <p className="truncate text-base font-bold text-ringo-text">{r.title}</p>
                <p className="text-xs text-ringo-muted">{r.expiresAt ? L.customer.expiresOn(fmtDate(r.expiresAt, locale)) : L.customer.noExpiry}</p>
              </div>
              <button type="button" disabled={!!busy || !can.scan} onClick={() => redeem(r.id)} className={btnPrimary}>
                {busy === `redeem:${r.id}` ? <><Loader2 size={15} className="animate-spin" /> {L.customer.redeeming}</> : L.customer.redeem}
              </button>
            </div>
          ))}
        </section>
      )}

      <section className="rounded-card border border-ringo-border/70 bg-ringo-surface p-4">
        <h2 className="mb-3 text-sm font-semibold text-ringo-text">{L.customer.loyaltyTitle}</h2>
        {profile.programs.length === 0 && <p className="text-sm text-ringo-muted">{L.customer.noPrograms}</p>}
        <div className="flex flex-col gap-4">
          {profile.programs.map((p) => {
            const done = p.status === "reward_ready";
            const q = programQty(p);
            const remaining = remainingOf(p);
            const maxVisits = Math.max(remaining, 1);
            const earned = p.type === "points" && p.unitAmount && p.pointsPerUnit ? Math.floor(q / p.unitAmount) * p.pointsPerUnit : 0;
            return (
              <div key={p.programId} className="flex flex-col gap-2 border-b border-ringo-border/50 pb-4 last:border-0 last:pb-0">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="truncate text-sm font-semibold text-ringo-text">{p.name}</p>
                  <p className="shrink-0 text-sm font-medium text-ringo-text">{progressLabel(p)}</p>
                </div>
                {progressBar((Math.min(p.progress, p.target) / p.target) * 100, done)}
                <p className="text-xs text-ringo-muted">{done ? L.customer.atTarget : remainingLabel(p)}</p>

                {!done && can.scan && (
                  <div className="mt-1 flex flex-wrap items-end gap-2">
                    {p.type === "visits" ? (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          aria-label="-"
                          disabled={!!busy || q <= 1}
                          onClick={() => setQty((s) => ({ ...s, [p.programId]: String(Math.max(q - 1, 1)) }))}
                          className={btnGhost}
                        >
                          <Minus size={15} />
                        </button>
                        <span className="w-10 text-center text-base font-bold text-ringo-text" aria-label={L.customer.quantityLabel}>
                          {q || 1}
                        </span>
                        <button
                          type="button"
                          aria-label="+"
                          disabled={!!busy || q >= maxVisits}
                          onClick={() => setQty((s) => ({ ...s, [p.programId]: String(Math.min((q || 1) + 1, maxVisits)) }))}
                          className={btnGhost}
                        >
                          <Plus size={15} />
                        </button>
                      </div>
                    ) : (
                      <label className="flex min-w-[9rem] flex-1 flex-col gap-1 text-xs text-ringo-muted">
                        {`${L.customer.amountLabel}${p.currency ? ` (${p.currency})` : ""}`}
                        <input
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={qty[p.programId] ?? ""}
                          onChange={(e) => setQty((s) => ({ ...s, [p.programId]: e.target.value.replace(/\D/g, "").slice(0, 9) }))}
                          className={inputCls}
                        />
                      </label>
                    )}
                    <button type="button" disabled={!!busy || q < 1} onClick={() => record(p)} className={btnPrimary}>
                      {busy === `rec:${p.programId}` ? (
                        <><Loader2 size={15} className="animate-spin" /> {L.customer.saving}</>
                      ) : (
                        <>{p.type === "points" ? actionText(L, "points").record : actionText(L, p.actionKey).record} · {L.customer.confirm}</>
                      )}
                    </button>
                    {p.type === "points" && q > 0 && <span className="pb-2 text-xs text-ringo-muted">{L.customer.pointsEarned(earned)}</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-card border border-ringo-border/70 bg-ringo-surface p-4">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ringo-text">
          <Package size={15} /> {L.customer.packagesTitle}
        </h2>
        {profile.packages.length === 0 && <p className="text-sm text-ringo-muted">{L.customer.noPackages}</p>}
        <div className="flex flex-col gap-3">
          {profile.packages.map((pk) => (
            <div key={pk.id} className="rounded-xl border border-ringo-border/60 p-3">
              <div className="flex items-baseline justify-between gap-2">
                <p className="truncate text-sm font-semibold text-ringo-text">{pk.name}</p>
                <p className="shrink-0 text-xs text-ringo-muted">
                  {L.customer.expires} {fmtDate(pk.endsAt, locale)}
                </p>
              </div>
              <div className="mt-2 flex flex-col gap-1.5">
                {pk.credits.map((c) => (
                  <div key={c.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate text-ringo-text">
                      {actionText(L, c.actionKey).many}
                      <span className="text-ringo-muted">
                        {" · "}
                        {L.customer.used} {c.used} · {L.customer.remaining} {c.remaining}
                      </span>
                    </span>
                    {can.scan && (
                      <button
                        type="button"
                        disabled={!!busy || c.remaining < 1 || new Date(pk.startsAt).getTime() > Date.now()}
                        onClick={() => useCredit(c.id, c.remaining)}
                        className={btnGhost}
                      >
                        {busy === `use:${c.id}` ? <Loader2 size={14} className="animate-spin" /> : `${L.customer.use} · 1`}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {can.manage && eligibleTemplates.length > 0 && (
          <div className="mt-4 flex flex-col gap-2 border-t border-ringo-border/50 pt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-ringo-muted">{L.customer.activatePackage}</p>
            <select value={tpl} onChange={(e) => setTpl(e.target.value)} className={inputCls} aria-label={L.customer.chooseTemplate}>
              <option value="">{L.customer.chooseTemplate}</option>
              {eligibleTemplates.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                  {x.price !== null ? ` — ${fmtMoney(x.price, x.currency, locale)}` : ""}
                </option>
              ))}
            </select>
            <div className="grid gap-2 sm:grid-cols-2">
              <input value={payRef} maxLength={120} onChange={(e) => setPayRef(e.target.value)} placeholder={L.customer.paymentRef} className={inputCls} aria-label={L.customer.paymentRef} />
              <input type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className={inputCls} aria-label={L.customer.startDate} title={L.customer.startDate} />
            </div>
            <button type="button" disabled={!!busy || !tpl} onClick={activate} className={`${btnPrimary} self-start`}>
              {busy === "activate" ? <Loader2 size={15} className="animate-spin" /> : L.customer.activate}
            </button>
          </div>
        )}
      </section>

      <section className="rounded-card border border-ringo-border/70 bg-ringo-surface p-4">
        <h2 className="mb-3 text-sm font-semibold text-ringo-text">{L.customer.recentTitle}</h2>
        {profile.recent.length === 0 && <p className="text-sm text-ringo-muted">{L.customer.noRecent}</p>}
        <div className="flex flex-col">
          {profile.recent.map((a) => {
            const label = actionText(L, a.actionKey);
            const sign = a.quantity > 0 ? "+" : "−";
            const canReverse = can.reverse && a.kind === "record" && !a.reversed && !a.carryOver;
            return (
              <div key={a.id} className="flex items-center justify-between gap-2 border-b border-ringo-border/50 py-2 text-sm last:border-0">
                <div className="min-w-0">
                  <p className={`truncate font-medium ${a.reversed ? "text-ringo-muted line-through" : "text-ringo-text"}`}>
                    {sign}
                    {Math.abs(a.quantity)} {Math.abs(a.quantity) === 1 ? label.one : label.many}
                    {a.programName ? <span className="font-normal text-ringo-muted"> · {a.programName}</span> : null}
                  </p>
                  <p className="text-xs text-ringo-muted">
                    {fmtDateTime(a.createdAt, locale)}
                    {a.reversed ? ` · ${L.customer.reversedTag}` : ""}
                    {a.carryOver ? ` · ${L.customer.carryOverTag}` : ""}
                  </p>
                </div>
                {canReverse && (
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => {
                      setReason("");
                      setReversing({ id: a.id, label: `${sign}${Math.abs(a.quantity)} ${label.many}`, key: newKey() });
                    }}
                    className={btnGhost}
                  >
                    <Undo2 size={14} /> {L.customer.reverse}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {reversing && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label={L.activity.reverseTitle}>
          <div className="w-full max-w-md rounded-2xl bg-ringo-surface p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-ringo-text">{L.activity.reverseTitle}</h3>
                <p className="mt-0.5 text-sm text-ringo-muted">{reversing.label}</p>
              </div>
              <button type="button" aria-label={L.activity.cancel} onClick={() => setReversing(null)} className="text-ringo-muted">
                <X size={18} />
              </button>
            </div>
            <p className="mt-2 text-xs text-ringo-muted">{L.activity.reverseBody}</p>
            <label className="mt-3 flex flex-col gap-1 text-xs font-medium text-ringo-muted">
              {L.activity.reasonLabel}
              <textarea value={reason} maxLength={300} rows={3} onChange={(e) => setReason(e.target.value)} placeholder={L.activity.reasonPlaceholder} className={inputCls} />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setReversing(null)} className={btnGhost}>
                {L.activity.cancel}
              </button>
              <button type="button" disabled={!!busy || reason.trim().length < 3} onClick={confirmReverse} className={btnPrimary}>
                {busy === `rev:${reversing.id}` ? <Loader2 size={15} className="animate-spin" /> : L.activity.confirmReverse}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
