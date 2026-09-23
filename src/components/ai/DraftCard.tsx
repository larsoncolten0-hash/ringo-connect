"use client";

import { useState } from "react";
import { AlertCircle, ArrowRight, CalendarDays, Check, Eye, Loader2, Music, ShoppingBag, Sparkles, UserRound, UtensilsCrossed } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { getCategory, getMusicRole, getRestaurantSubcategory } from "@/lib/categories";
import type { DraftView } from "@/lib/ai/drafts/view";
import type { DraftChange } from "@/lib/ai/drafts/types";

// The review card for one Ringo AI draft. Shows what Ringo AI understood and
// proposes (before → after), what will NOT change, and — for anything that
// goes public — says so plainly. Applying happens ONLY here, on the owner's
// explicit "Confirm & Apply" click (POST /api/ai/drafts/[id]/apply with the
// revision on screen); no chat message can do it.

const TYPE_ICON = {
  "profile.update": UserRound,
  "product.create": ShoppingBag,
  "event.create": CalendarDays,
  "product.update": ShoppingBag,
  "event.update": CalendarDays,
  "track.update": Music,
  "menu_item.update": UtensilsCrossed,
  "menu_item.create": UtensilsCrossed,
} as const;

export default function DraftCard({ draft, onChange }: { draft: DraftView; onChange: (next: DraftView) => void }) {
  const { t, locale } = useLanguage();
  const d = t.ringoAi.drafts;
  const [busy, setBusy] = useState<"apply" | "discard" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const Icon = TYPE_ICON[draft.type] ?? Sparkles;

  const format = (kind: DraftChange["kind"], value: unknown): string => {
    if (value === null || value === undefined || value === "") return kind === "price" ? d.noPrice : d.empty;
    switch (kind) {
      case "category":
        return getCategory(String(value))?.label[locale] ?? String(value);
      case "categories":
        return (Array.isArray(value) ? value : []).map((id) => getCategory(String(id))?.label[locale] ?? String(id)).join(", ") || d.empty;
      case "music_role":
        return getMusicRole(String(value))?.label[locale] ?? String(value);
      case "restaurant_subcategory":
        return getRestaurantSubcategory(String(value))?.label[locale] ?? String(value);
      case "phone":
        return /^\d+$/.test(String(value)) ? `+${value}` : String(value);
      case "price": {
        const { amount, currency } = value as { amount: number; currency: string };
        try {
          return new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "en-US", {
            style: "currency",
            currency,
            maximumFractionDigits: currency === "XAF" ? 0 : 2,
          }).format(amount);
        } catch {
          return `${amount} ${currency}`;
        }
      }
      case "date": {
        const date = new Date(`${value}T00:00:00Z`);
        return Number.isNaN(date.getTime())
          ? String(value)
          : date.toLocaleDateString(locale === "fr" ? "fr-FR" : "en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "long", year: "numeric" });
      }
      default:
        return String(value);
    }
  };

  const call = async (action: "apply" | "discard") => {
    setBusy(action);
    setError(null);
    try {
      const res =
        action === "apply"
          ? await fetch(`/api/ai/drafts/${draft.id}/apply`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ revision: draft.revision }),
            })
          : await fetch(`/api/ai/drafts/${draft.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (data?.draft) onChange(data.draft as DraftView);
      if (!res.ok) setError(typeof data?.error === "string" ? data.error : "internal");
    } catch {
      setError("internal");
    } finally {
      setBusy(null);
    }
  };

  const actionable = draft.status === "awaiting_confirmation" || draft.status === "failed";
  const statusTone =
    draft.status === "applied"
      ? "bg-emerald-500/10 text-emerald-600"
      : draft.status === "failed" || draft.status === "stale"
        ? "bg-ringo-coral/10 text-ringo-coral"
        : draft.status === "awaiting_confirmation" || draft.status === "applying"
          ? "bg-ringo-indigo/10 text-ringo-indigo"
          : "bg-ringo-muted/10 text-ringo-muted";
  const errorText = error ? d.errors[error] ?? d.errors.internal : draft.status === "failed" && draft.errorCode ? d.errors[draft.errorCode] ?? d.errors.internal : null;

  return (
    <div className="mt-2 rounded-2xl border border-ringo-indigo/25 bg-ringo-surface shadow-[0_8px_24px_-16px_rgba(79,70,229,0.45)] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-3.5 py-2.5 bg-gradient-to-r from-ringo-indigo/[0.08] via-fuchsia-500/[0.05] to-transparent border-b border-ringo-border/60">
        <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-ringo-indigo to-fuchsia-500 text-white flex items-center justify-center shrink-0">
          <Icon size={14} />
        </span>
        <p className="flex-1 min-w-0 text-sm font-semibold text-ringo-text truncate">{d.typeTitle[draft.type]}</p>
        <span className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-md ${statusTone}`}>{d.status[draft.status] ?? draft.status}</span>
      </div>

      <div className="px-3.5 py-3 flex flex-col gap-3">
        {actionable && <p className="text-[11px] text-ringo-muted">{d.preparedNote}</p>}

        {/* What will change */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ringo-muted mb-1.5">{d.willChangeTitle}</p>
          <ul className="flex flex-col gap-2">
            {draft.changes.map((c) => {
              const hasBefore = c.before !== null && c.before !== undefined && c.before !== "" && !(Array.isArray(c.before) && c.before.length === 0);
              return (
                <li key={c.field} className="rounded-xl bg-ringo-muted/[0.06] px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-medium text-ringo-muted">{d.fields[c.field] ?? c.field}</span>
                    {c.generated && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-fuchsia-600">
                        <Sparkles size={10} />
                        {d.generatedLabel}
                      </span>
                    )}
                  </div>
                  {c.kind === "image" ? (
                    <div className="flex items-center gap-2 mt-1">
                      {hasBefore && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={String(c.before)} alt="" className="w-12 h-12 rounded-lg object-cover opacity-50" />
                      )}
                      {hasBefore && <ArrowRight size={13} className="shrink-0 text-ringo-indigo" />}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={String(c.after)} alt="" className="w-12 h-12 rounded-lg object-cover" />
                    </div>
                  ) : (
                    <>
                      {hasBefore && (
                        <p className="text-xs text-ringo-muted line-through decoration-ringo-muted/50 break-words whitespace-pre-wrap mt-0.5">{format(c.kind, c.before)}</p>
                      )}
                      <p className="text-sm text-ringo-text break-words whitespace-pre-wrap mt-0.5 flex gap-1.5">
                        {hasBefore && <ArrowRight size={13} className="shrink-0 mt-1 text-ringo-indigo" />}
                        <span className="font-medium">{format(c.kind, c.after)}</span>
                      </p>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        {/* Public visibility — always explicit */}
        {actionable && (
          <div className={`flex items-start gap-2 rounded-xl px-3 py-2 text-xs ${draft.type === "event.create" ? "bg-ringo-indigo/[0.06] text-ringo-text" : "bg-amber-500/10 text-ringo-text"}`}>
            <Eye size={13} className="shrink-0 mt-px" />
            <span>{d.publicNote[draft.type]}</span>
          </div>
        )}

        {/* What won't change */}
        {actionable && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-ringo-muted mb-1">{d.wontChangeTitle}</p>
            <p className="text-xs text-ringo-muted leading-relaxed">{d.wontChange[draft.type]}</p>
          </div>
        )}

        {/* Outcome states */}
        {draft.status === "applied" && (
          <div className="flex items-center justify-between gap-2 rounded-xl bg-emerald-500/10 px-3 py-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
              <Check size={13} />
              {d.appliedNote[draft.type]}
            </span>
            {draft.reviewPath && (
              <a href={draft.reviewPath} className="text-xs font-semibold text-ringo-indigo hover:underline shrink-0">
                {d.openInDashboard}
              </a>
            )}
          </div>
        )}
        {draft.status === "stale" && <p className="text-xs text-ringo-coral">{d.staleNote}</p>}
        {draft.status === "expired" && <p className="text-xs text-ringo-muted">{d.expiredNote}</p>}
        {draft.status === "rejected" && <p className="text-xs text-ringo-muted">{d.rejectedNote}</p>}

        {errorText && (
          <p className="flex items-start gap-1.5 text-xs text-ringo-coral">
            <AlertCircle size={13} className="shrink-0 mt-px" />
            {errorText}
          </p>
        )}

        {/* Explicit confirmation */}
        {(actionable || draft.status === "applying") && (
          <div className="flex items-center gap-2 pt-0.5">
            <button
              type="button"
              onClick={() => call("apply")}
              disabled={busy !== null || draft.status === "applying"}
              className="flex-1 inline-flex items-center justify-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-xl bg-gradient-to-r from-ringo-indigo to-fuchsia-500 text-white transition active:scale-[0.98] disabled:opacity-60"
            >
              {busy === "apply" || draft.status === "applying" ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              {busy === "apply" || draft.status === "applying" ? d.applying : draft.status === "failed" ? d.retry : d.confirm}
            </button>
            {actionable && (
              <button
                type="button"
                onClick={() => call("discard")}
                disabled={busy !== null}
                className="text-sm font-medium px-3 py-2 rounded-xl border border-ringo-border text-ringo-muted hover:text-ringo-text transition disabled:opacity-60"
              >
                {busy === "discard" ? <Loader2 size={14} className="animate-spin" /> : d.discard}
              </button>
            )}
          </div>
        )}
        {draft.status === "stale" && (
          <button type="button" onClick={() => call("discard")} disabled={busy !== null} className="self-start text-xs font-medium text-ringo-muted hover:text-ringo-text">
            {d.discard}
          </button>
        )}
      </div>
    </div>
  );
}
