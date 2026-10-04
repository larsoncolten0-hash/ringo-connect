"use client";

import { BarChart3, Share2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { useShareProfile } from "./useShareProfile";

// Shown on /dashboard/analytics before the profile has recorded any activity at all: says what the
// page is for, why it's empty, and the one thing to do about it. Presentation only.
export default function AnalyticsEmptyState({ profileUrl, shareTitle }: { profileUrl: string; shareTitle: string }) {
  const { t } = useLanguage();
  const g = t.guidance.home;
  const { share, status } = useShareProfile(profileUrl, shareTitle);

  return (
    <div className="rounded-card border border-dashed border-ringo-border p-6 flex flex-col items-center text-center gap-2">
      <span className="w-10 h-10 rounded-full bg-ringo-indigo/10 flex items-center justify-center" aria-hidden="true">
        <BarChart3 size={17} className="text-ringo-indigo" strokeWidth={2.25} />
      </span>
      <p className="text-sm font-medium text-ringo-text">{g.emptyTitle}</p>
      <p className="text-xs text-ringo-muted max-w-[300px] leading-relaxed">{g.emptyBody}</p>
      <button
        type="button"
        onClick={share}
        className="mt-1 inline-flex items-center justify-center gap-2 min-h-[44px] px-5 rounded-full text-sm font-semibold bg-ringo-indigo text-white hover:brightness-110 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/40"
      >
        <Share2 size={14} aria-hidden="true" />
        {g.emptyCta}
      </button>
      <span role="status" aria-live="polite" className="text-xs text-ringo-muted min-h-[1rem]">
        {status === "copied" ? g.linkCopied : status === "failed" ? g.shareFailed : ""}
      </span>
    </div>
  );
}
