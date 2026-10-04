"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronRight, X } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { pickNextAction, sortRecommendations, type Recommendation } from "@/lib/profileHealth";
import { readDismissed, writeDismissed } from "@/lib/profileHealth/dismissals";
import { recTextFor } from "./guidanceText";
import { useShareProfile } from "./useShareProfile";

const MORE_IDEAS_SHOWN = 2;

// The ONE primary action, plus a short "more ideas" list. The list of recommendations comes from the
// server (src/lib/profileHealth); the only thing decided here is which of them this device has
// hidden with "Not now" (localStorage, per device, optional: see dismissals.ts).
export default function NextActionCard({
  profileId,
  recommendations,
  missingCount,
  profileUrl,
  shareTitle,
}: {
  profileId: string;
  recommendations: Recommendation[];
  missingCount: number;
  profileUrl: string;
  shareTitle: string;
}) {
  const { t, locale } = useLanguage();
  const g = t.guidance;
  const [dismissed, setDismissed] = useState<string[]>([]);
  const { share, status } = useShareProfile(profileUrl, shareTitle);

  useEffect(() => {
    setDismissed(readDismissed(profileId));
  }, [profileId]);

  const action = useMemo(() => pickNextAction(recommendations, { dismissed, missingCount }), [recommendations, dismissed, missingCount]);
  const more = useMemo(() => {
    const hidden = new Set(dismissed);
    return sortRecommendations(recommendations)
      .filter((r) => !hidden.has(r.id) && r.id !== action?.id)
      .slice(0, MORE_IDEAS_SHOWN);
  }, [recommendations, dismissed, action]);

  const dismiss = (id: string) => {
    const next = [...dismissed, id];
    setDismissed(next);
    writeDismissed(profileId, next);
  };

  const focus = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/40";
  const card = "rounded-[20px] border border-ringo-border/60 bg-ringo-surface p-5 sm:p-6";

  if (!action) {
    return (
      <section aria-labelledby="ringo-next-title" className={card}>
        <h2 id="ringo-next-title" className="text-xs font-medium uppercase tracking-wide text-ringo-muted mb-2">
          {g.nextStep.heading}
        </h2>
        <p className="text-[15px] font-semibold text-ringo-text">{g.nextStep.allCaughtUpTitle}</p>
        <p className="text-sm text-ringo-muted mt-1">{g.nextStep.allCaughtUpBody}</p>
      </section>
    );
  }

  const text = recTextFor(t, locale, action);
  // A very incomplete page gets one clear headline; the specific first step is the reason line.
  const title = action.overall ? g.nextStep.completeTitle : text.title;
  const lead = action.overall ? text.title : text.reason;
  const ctaClass = `inline-flex items-center justify-center gap-2 min-h-[44px] px-5 rounded-full text-sm font-semibold bg-ringo-indigo text-white transition hover:brightness-110 active:scale-[0.98] ${focus}`;

  return (
    <section aria-labelledby="ringo-next-title" className={card}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <h2 id="ringo-next-title" className="text-xs font-medium uppercase tracking-wide text-ringo-muted">
          {g.nextStep.heading}
        </h2>
        <button
          type="button"
          onClick={() => dismiss(action.id)}
          aria-label={g.nextStep.dismissLabel(text.title)}
          className={`-mr-2 -mt-2 inline-flex items-center gap-1 min-h-[44px] px-2.5 rounded-lg text-xs text-ringo-muted hover:text-ringo-text ${focus}`}
        >
          {g.nextStep.notNow}
          <X size={12} aria-hidden="true" />
        </button>
      </div>

      <p className="font-display text-lg font-medium text-ringo-text tracking-[-0.01em]">{title}</p>
      <p className="text-sm text-ringo-text/80 mt-1">{lead}</p>
      <p className="text-sm text-ringo-muted mt-2">
        <span className="font-medium text-ringo-text/80">{g.nextStep.whyLabel}: </span>
        {text.benefit}
      </p>

      <div className="mt-4 flex items-center gap-3 flex-wrap">
        {action.action === "share" ? (
          <button type="button" onClick={share} className={ctaClass}>
            {text.cta}
            <ArrowRight size={14} aria-hidden="true" />
          </button>
        ) : (
          <Link href={action.href} className={ctaClass}>
            {text.cta}
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
        )}
        <span role="status" aria-live="polite" className="text-xs text-ringo-muted">
          {status === "copied" ? g.home.linkCopied : status === "failed" ? g.home.shareFailed : ""}
        </span>
      </div>

      {more.length > 0 && (
        <div className="mt-5 pt-4 border-t border-ringo-border/60">
          <h3 className="text-xs font-medium uppercase tracking-wide text-ringo-muted mb-1.5">{g.nextStep.moreHeading}</h3>
          <ul className="flex flex-col">
            {more.map((rec) => {
              const rt = recTextFor(t, locale, rec);
              return (
                <li key={rec.id}>
                  {rec.action === "share" ? (
                    <button type="button" onClick={share} className={`w-full flex items-center gap-2 min-h-[44px] text-left rounded-lg text-sm text-ringo-text hover:bg-ringo-muted/[0.06] px-1.5 -mx-1.5 ${focus}`}>
                      <span className="flex-1 min-w-0">{rt.title}</span>
                      <ChevronRight size={14} className="text-ringo-muted shrink-0" aria-hidden="true" />
                    </button>
                  ) : (
                    <Link href={rec.href} className={`flex items-center gap-2 min-h-[44px] rounded-lg text-sm text-ringo-text hover:bg-ringo-muted/[0.06] px-1.5 -mx-1.5 ${focus}`}>
                      <span className="flex-1 min-w-0">{rt.title}</span>
                      <ChevronRight size={14} className="text-ringo-muted shrink-0" aria-hidden="true" />
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
