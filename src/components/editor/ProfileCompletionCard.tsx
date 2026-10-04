"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle2, Circle, Sparkles } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { useEditorPreview } from "./EditorPreviewContext";
import { computeProfileHealth, type HealthPlan, type ProfileHealth } from "@/lib/profileHealth";
import { doneText, recText } from "@/components/guidance/guidanceText";

// "Your Ringo presence": the one completion card, used in two places.
//
// * In the Editor (no `health` prop) it is derived from the same live draft LivePreviewPanel
//   already reads (see EditorPreviewContext), so the percentage and checklist update the instant a
//   field changes, with no state or persistence of its own.
// * On Ringo Home the server passes `health` in, computed from the saved profile.
//
// ALL the rules (what counts for which category, what a plan locks) live in src/lib/profileHealth.
// This component only presents the result, so it can never disagree with the Home page.
//
// Each unmet item links to its editor section. In the Editor those are plain <a> (a real hard
// navigation to `/dashboard?section=<id>`, which remounts the editor so Accordion's `defaultOpenId`
// opens it, without any change to Accordion.tsx/EditorSection.tsx). From Home the editor is a fresh
// route, so next/link is fine there. At 100% the Editor shows a slim status row instead of the full
// card, so a finished profile never carries a big permanent card.
export default function ProfileCompletionCard({ plan, health: provided }: { plan?: HealthPlan | null; health?: ProfileHealth }) {
  const { t, locale } = useLanguage();
  const { draft } = useEditorPreview();
  const g = t.guidance;

  const health = provided ?? computeProfileHealth({ profile: draft, plan });
  const fromHome = !!provided;

  if (!fromHome && health.isComplete) {
    return (
      <div className="animate-fade-up flex items-center gap-2.5 rounded-[16px] border border-ringo-border/60 bg-ringo-surface px-4 py-3">
        <CheckCircle2 size={16} className="text-emerald-500 shrink-0" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <p className="text-sm text-ringo-text">{g.status[health.status]}</p>
          {!health.published && <p className="text-xs text-ringo-muted mt-0.5">{g.unpublishedNote}</p>}
        </div>
        <Link
          href="/dashboard/home"
          className="shrink-0 inline-flex items-center gap-1 rounded-lg text-xs font-medium text-ringo-indigo hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/40 py-1 px-1.5"
        >
          {g.openHome}
          <ArrowRight size={12} aria-hidden="true" />
        </Link>
      </div>
    );
  }

  const rowClass = "flex items-center gap-2.5 min-h-[44px] py-1.5 -mx-1.5 px-1.5 rounded-lg";

  return (
    <section
      aria-labelledby="ringo-presence-title"
      className="animate-fade-up rounded-[20px] border border-ringo-border/60 bg-ringo-surface p-5 sm:p-6 shadow-[0_1px_2px_rgba(15,23,42,0.03),0_10px_24px_-18px_rgba(15,23,42,0.12)]"
    >
      <div className="flex items-start gap-3 mb-4">
        <span className="w-8 h-8 rounded-xl bg-ringo-indigo/10 flex items-center justify-center shrink-0" aria-hidden="true">
          <Sparkles size={15} className="text-ringo-indigo" strokeWidth={2.25} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="ringo-presence-title" className="text-[15px] font-semibold text-ringo-text tracking-[-0.01em]">
            {g.presenceTitle}
          </h2>
          <p className="text-xs text-ringo-muted mt-0.5">{g.status[health.status]}</p>
          {!health.published && <p className="text-xs text-ringo-muted mt-0.5">{g.unpublishedNote}</p>}
        </div>
        <p className="font-display text-2xl font-medium text-ringo-text tabular-nums leading-none" aria-hidden="true">
          {health.percentage}%
        </p>
      </div>

      <div
        role="progressbar"
        aria-label={g.progressLabel}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={health.percentage}
        aria-valuetext={g.percentComplete(health.percentage)}
        className="h-1.5 w-full rounded-full bg-ringo-indigo/10 overflow-hidden mb-3"
      >
        <div
          className="h-full rounded-full bg-ringo-indigo transition-[width] duration-500 ease-out motion-reduce:transition-none"
          style={{ width: `${health.percentage}%` }}
        />
      </div>
      <p className="text-sm text-ringo-muted mb-4">{g.headline[health.status]}</p>

      <ul className="flex flex-col gap-0.5">
        {health.items.map((item) => {
          const label = item.met
            ? doneText(t, locale, item.id, item.catalogLabel)
            : recText(t, locale, item.id, item.catalogLabel).title;
          const row = (
            <>
              {item.met ? (
                <CheckCircle2 size={16} className="text-emerald-500 shrink-0" aria-hidden="true" />
              ) : (
                <Circle size={16} className="text-ringo-muted/60 shrink-0" aria-hidden="true" />
              )}
              <span className={`text-sm flex-1 min-w-0 ${item.met ? "text-ringo-muted" : "text-ringo-text"}`}>{label}</span>
              <span className="sr-only">{item.met ? g.itemDone : g.itemTodo}</span>
              {!item.met && item.href !== "/dashboard" && (
                <span className="text-xs font-medium text-ringo-indigo shrink-0">{g.addCta}</span>
              )}
            </>
          );

          // In the Editor the profile header (photo, name, description) is already on screen, so
          // those items are not links there; from Home they take you to the Editor.
          const linkable = !item.met && (fromHome || item.href !== "/dashboard");
          const focus = "hover:bg-ringo-muted/[0.06] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/40";
          return (
            <li key={item.id}>
              {linkable ? (
                fromHome ? (
                  <Link href={item.href} className={`${rowClass} ${focus}`}>
                    {row}
                  </Link>
                ) : (
                  <a href={item.href} className={`${rowClass} ${focus}`}>
                    {row}
                  </a>
                )
              ) : (
                <div className={rowClass}>{row}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
