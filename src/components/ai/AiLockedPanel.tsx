"use client";

import { Check, Lock, Sparkles, X } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { useModalA11y } from "@/components/ui/useModalA11y";
import PlanCta from "@/components/ui/PlanCta";

// What a plan WITHOUT Ringo AI sees when it opens the assistant: not a hidden feature and not an error, but an explanation of what it does and one clear
// way to get it. Same promise as every locked tool: it explains and offers an upgrade, it shows no data, and the chat API still refuses this plan.
// A real dialog: focus moves in, Tab stays inside, Escape closes, focus returns to the launcher.
export default function AiLockedPanel({ onClose }: { onClose: () => void }) {
  const { t } = useLanguage();
  const ref = useModalA11y<HTMLDivElement>(onClose);
  const L = t.ringoAi.locked;
  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label={L.title}
      tabIndex={-1}
      className="fixed inset-x-3 bottom-3 z-50 flex max-h-[85vh] flex-col gap-4 overflow-y-auto rounded-card border border-ringo-border bg-ringo-surface p-5 shadow-[0_20px_50px_-16px_rgba(15,23,42,0.35)] focus:outline-none sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-[380px]"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sm font-semibold text-ringo-text">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-ringo-indigo/10 text-ringo-indigo">
            <Sparkles size={17} aria-hidden="true" />
          </span>
          {L.title}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={L.close}
          className="-mr-2 flex h-11 w-11 items-center justify-center rounded-full text-ringo-muted transition hover:bg-ringo-muted/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/50"
        >
          <X size={17} aria-hidden="true" />
        </button>
      </div>
      <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-ringo-indigo/10 px-3 py-1 text-xs font-semibold text-ringo-indigo">
        <Lock size={12} aria-hidden="true" />
        {L.badge}
      </span>
      <div className="flex flex-col gap-2">
        <h2 className="font-display text-xl font-bold leading-tight text-ringo-text">{L.headline}</h2>
        <p className="text-sm leading-relaxed text-ringo-muted">{L.body}</p>
      </div>
      <ul className="flex flex-col gap-2.5">
        {L.points.map((point: string) => (
          <li key={point} className="flex items-start gap-2.5 text-sm text-ringo-text">
            <Check size={16} className="mt-0.5 shrink-0 text-ringo-indigo" aria-hidden="true" />
            <span>{point}</span>
          </li>
        ))}
      </ul>
      <PlanCta variant="primary" className="w-full">
        {t.sidebar.upgradePlan}
      </PlanCta>
      <p className="text-xs leading-relaxed text-ringo-muted">{L.note}</p>
    </div>
  );
}
