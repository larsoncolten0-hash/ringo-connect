"use client";

import { useState } from "react";
import { useLanguage } from "@/components/LanguageProvider";

// What appears when a Ringo AI usage limit is actually reached, instead of a running count of what is left. One calm explanation and two choices:
//   Increase limit  asks the Ringo team (the existing "Talk to Ringo Team" path) to raise it. There is no paid top-up yet: pricing and payment for extra
//                   usage would be its own piece of work, so nothing here charges anything or pretends otherwise.
//   Wait            acknowledges that the limit resets (tomorrow for a daily limit, next month for a monthly one) and folds the card into one quiet line.
// Both buttons are real, bordered, 44px buttons. Used for chat messages and, with kind "image", for image generation.
export default function AiLimitCard({
  kind,
  reason,
  onIncrease,
}: {
  kind: "chat" | "image";
  reason: "daily_limit" | "monthly_limit";
  onIncrease: () => void;
}) {
  const { t } = useLanguage();
  const [waiting, setWaiting] = useState(false);
  const L = t.ringoAi.limit;
  const daily = reason === "daily_limit";

  if (waiting) {
    return (
      <p role="status" className="mb-2 text-xs text-ringo-muted">
        {daily ? L.waitingDaily : L.waitingMonthly}
      </p>
    );
  }

  const title = kind === "image" ? (daily ? L.imageDailyTitle : L.imageMonthlyTitle) : daily ? L.dailyTitle : L.monthlyTitle;
  return (
    <div role="status" className="mb-2 flex flex-col gap-2.5 rounded-card border border-ringo-border bg-ringo-muted/[0.06] p-3">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold text-ringo-text">{title}</p>
        <p className="text-xs leading-relaxed text-ringo-muted">{daily ? L.dailyBody : L.monthlyBody}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onIncrease}
          className="ringo-tactile ringo-cta inline-flex min-h-[44px] items-center justify-center rounded-card border border-ringo-accent px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-accent/60 focus-visible:ring-offset-2"
        >
          {L.increase}
        </button>
        <button
          type="button"
          onClick={() => setWaiting(true)}
          className="ringo-tactile inline-flex min-h-[44px] items-center justify-center rounded-card border border-ringo-border px-4 text-sm font-semibold text-ringo-text hover:bg-ringo-muted/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/50"
        >
          {daily ? L.waitDaily : L.waitMonthly}
        </button>
      </div>
    </div>
  );
}
