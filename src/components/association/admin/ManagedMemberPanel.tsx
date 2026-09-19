"use client";

import { useEffect, useState } from "react";
import { X, Loader2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { formatPrice } from "@/lib/currency";
import { availableActions, type ManagedMemberInfo, type MembershipAction, type MembershipState, type PlanRow } from "@/lib/association/membershipTypes";

const BADGE_STYLES: Record<MembershipState, string> = {
  active: "bg-ringo-teal/10 text-ringo-teal",
  pending: "bg-amber-500/10 text-amber-600",
  suspended: "bg-amber-500/10 text-amber-600",
  expired: "bg-ringo-muted/10 text-ringo-muted",
  cancelled: "bg-red-500/10 text-red-500",
};

/** Membership state badge. `state` should be the DATABASE-computed effective state. */
export function MembershipBadge({ state }: { state: MembershipState }) {
  const { t } = useLanguage();
  return (
    <span className={`text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded-full shrink-0 ${BADGE_STYLES[state] || ""}`}>
      {t.association.membership.states[state] || state}
    </span>
  );
}

interface TermRow {
  id: string;
  membership_number: string;
  state: MembershipState;
  effective_state: MembershipState;
  starts_at: string;
  expires_at: string | null;
  ended_reason: string | null;
  created_at: string;
}

export default function ManagedMemberPanel({
  associationId,
  memberId,
  memberName,
  info,
  canManage,
  onClose,
  onChanged,
}: {
  associationId: string;
  memberId: string;
  memberName: string;
  info: ManagedMemberInfo | null;
  canManage: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t, locale } = useLanguage();
  const a = t.association;
  const m = a.membership;
  const [action, setAction] = useState<MembershipAction | null>(info ? null : "enroll");
  const [plans, setPlans] = useState<PlanRow[] | null>(null);
  const [planId, setPlanId] = useState("");
  const [reason, setReason] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [terms, setTerms] = useState<TermRow[] | null>(null);

  const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" }) : m.noExpiry);
  const base = `/api/associations/${associationId}`;
  const planName = (p: { name_en: string; name_fr: string }) => (locale === "fr" ? p.name_fr : p.name_en);

  useEffect(() => {
    if (!info) return;
    fetch(`${base}/memberships?memberId=${memberId}`)
      .then((r) => (r.ok ? r.json() : { memberships: [] }))
      .then((d) => setTerms(d.memberships || []))
      .catch(() => setTerms([]));
  }, [base, memberId, info]);

  useEffect(() => {
    if (action !== "enroll" && action !== "renew") return;
    fetch(`${base}/membership-plans`)
      .then((r) => (r.ok ? r.json() : { plans: [] }))
      .then((d) => {
        const active = ((d.plans || []) as PlanRow[]).filter((p) => p.active);
        setPlans(active);
        setPlanId((cur) => cur || (action === "renew" && info && active.some((p) => p.id === info.planId) ? info.planId : active[0]?.id || ""));
      })
      .catch(() => setPlans([]));
  }, [action, base, info]);

  const errorText = (code?: string) => (code && m.errors[code]) || a.genericError;

  const run = async () => {
    if (!action) return;
    setBusy(true);
    setError("");
    try {
      let res: Response;
      if (action === "enroll") {
        const chosen = startsAt ? new Date(`${startsAt}T00:00:00`) : null;
        res = await fetch(`${base}/memberships`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ memberId, planId, startsAt: chosen && chosen.getTime() > Date.now() ? chosen.toISOString() : null }),
        });
      } else {
        res = await fetch(`${base}/memberships/${info!.membershipId}/${action}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: reason || undefined, planId: action === "renew" ? planId || undefined : undefined }),
        });
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(errorText(data.code));
        if (data.code === "term_ended" || data.code === "already_renewed" || data.code === "invalid_state") onChanged();
        return;
      }
      onChanged();
      onClose();
    } catch {
      setError(a.genericError);
    } finally {
      setBusy(false);
    }
  };

  const actionLabel: Record<MembershipAction, string> = {
    enroll: info ? m.actionEnrollAgain : m.actionEnroll,
    activate: m.actionActivate,
    suspend: m.actionSuspend,
    reinstate: m.actionReinstate,
    renew: m.actionRenew,
    cancel: m.actionCancel,
  };
  const confirmText: Partial<Record<MembershipAction, string>> = {
    activate: m.confirmActivate,
    suspend: m.confirmSuspend,
    reinstate: m.confirmReinstate,
    renew: m.confirmRenew,
    cancel: m.confirmCancel,
  };
  const needsPlan = action === "enroll" || action === "renew";
  const needsReason = action === "suspend" || action === "cancel";
  const inputClass = "w-full border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg";

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={onClose} role="dialog" aria-modal="true">
      <div className="w-full sm:max-w-md max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-ringo-surface border border-ringo-border p-5 flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-display text-base font-semibold text-ringo-text">{info ? m.manageTitle(memberName) : m.enrollTitle(memberName)}</h2>
          <button onClick={onClose} aria-label={a.cancelAction} className="w-8 h-8 rounded-full flex items-center justify-center text-ringo-muted hover:bg-ringo-muted/10 shrink-0">
            <X size={16} />
          </button>
        </div>

        {info && (
          <div className="rounded-2xl border border-ringo-border/70 p-3.5 flex flex-col gap-1.5 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-ringo-text">{info.membershipNumber}</span>
              <MembershipBadge state={info.effectiveState} />
            </div>
            <p className="text-ringo-muted text-xs">
              {m.planLabel}: {planName({ name_en: info.planNameEn || "—", name_fr: info.planNameFr || "—" })}
            </p>
            <p className="text-ringo-muted text-xs">
              {m.startsLabel}: {fmtDate(info.startsAt)} · {m.expiresLabel}: {fmtDate(info.expiresAt)}
            </p>
            {info.graceDays > 0 && <p className="text-ringo-muted text-xs">{m.graceDays(info.graceDays)}</p>}
            {info.effectiveState === "pending" && new Date(info.startsAt).getTime() > Date.now() && (
              <p className="text-amber-600 text-xs">{m.pendingUntil(fmtDate(info.startsAt))}</p>
            )}
            {info.effectiveState !== info.state && <p className="text-ringo-muted text-[11px]">{m.effectiveNote}</p>}
          </div>
        )}

        {!action && info && canManage && (
          <div className="flex flex-wrap gap-2">
            {availableActions(info).map((act) => (
              <button
                key={act}
                onClick={() => {
                  setError("");
                  setAction(act);
                }}
                className={`px-3.5 py-2 rounded-full text-sm font-medium border transition ${act === "cancel" ? "border-red-500/40 text-red-500" : "border-ringo-border text-ringo-text hover:border-ringo-indigo"}`}
              >
                {actionLabel[act]}
              </button>
            ))}
          </div>
        )}

        {action && (
          <div className="flex flex-col gap-3">
            {confirmText[action] && <p className="text-sm text-ringo-text">{confirmText[action]}</p>}
            {needsPlan && (
              <label className="flex flex-col gap-1 text-xs text-ringo-muted">
                {action === "renew" ? m.renewOnPlan : m.pickPlan}
                {plans === null ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : plans.length === 0 ? (
                  <span className="text-ringo-coral">{m.noActivePlans}</span>
                ) : (
                  <select value={planId} onChange={(e) => setPlanId(e.target.value)} className={inputClass}>
                    {plans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {planName(p)} · {formatPrice(p.price_amount, p.currency, locale)}
                      </option>
                    ))}
                  </select>
                )}
                <span className="text-[11px]">{m.priceNote}</span>
              </label>
            )}
            {action === "enroll" && (
              <label className="flex flex-col gap-1 text-xs text-ringo-muted">
                {m.startDateLabel}
                <input type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className={inputClass} />
                <span className="text-[11px]">{m.futureStartNote}</span>
              </label>
            )}
            {needsReason && (
              <label className="flex flex-col gap-1 text-xs text-ringo-muted">
                {m.reasonLabel}
                <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} className={inputClass} />
              </label>
            )}
            {error && <p className="text-xs text-ringo-coral">{error}</p>}
            <div className="flex gap-2 justify-end">
              {info && (
                <button onClick={() => setAction(null)} disabled={busy} className="px-4 py-2 rounded-full text-sm text-ringo-muted hover:bg-ringo-muted/10">
                  {a.backAction}
                </button>
              )}
              <button
                onClick={run}
                disabled={busy || (needsPlan && !planId)}
                className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold bg-ringo-indigo text-white disabled:opacity-60"
              >
                {busy && <Loader2 size={14} className="animate-spin" />}
                {action === "enroll" ? actionLabel.enroll : a.confirmAction}
              </button>
            </div>
          </div>
        )}

        {info && (
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-ringo-muted">{m.historyTitle}</p>
            {terms === null ? (
              <Loader2 size={16} className="animate-spin text-ringo-muted" />
            ) : terms.length === 0 ? (
              <p className="text-xs text-ringo-muted">{m.noHistory}</p>
            ) : (
              terms.map((tm) => (
                <div key={tm.id} className="flex items-center justify-between gap-2 text-xs rounded-xl border border-ringo-border/60 px-3 py-2">
                  <span className="text-ringo-muted">
                    {fmtDate(tm.starts_at)} → {fmtDate(tm.expires_at)}
                  </span>
                  <MembershipBadge state={tm.effective_state} />
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
