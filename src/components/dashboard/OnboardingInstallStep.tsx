"use client";

import { Smartphone } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import AddToHomeScreenMenuItem from "./AddToHomeScreenMenuItem";

// The onboarding tour's "install the app" step — not a driver.js spotlight
// (there's no existing page element to point at; installing is a
// system-level action, not something already sitting on the page), so
// this is a plain, self-contained modal instead. The actual install
// mechanism is AddToHomeScreenMenuItem, reused completely unmodified: it
// already handles the native beforeinstallprompt flow (Chrome/Android) vs
// iOS Safari's manual "Share -> Add to Home Screen" instructions, and
// already renders nothing when neither is available — this file adds no
// install logic of its own at all, only the tour's own step chrome
// (title/body/step-count/skip/next) around it.
export default function OnboardingInstallStep({
  stepLabel,
  isLast,
  onSkip,
  onNext,
}: {
  stepLabel: string;
  isLast: boolean;
  onSkip: () => void;
  onNext: () => void;
}) {
  const { t } = useLanguage();
  const copy = t.onboarding.steps.installApp;

  return (
    <div className="fixed inset-0 z-[61] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-slate-950/55" onClick={(e) => e.stopPropagation()} />
      <div className="relative pointer-events-auto w-full max-w-sm rounded-[20px] border border-ringo-border/60 bg-ringo-surface p-6 shadow-[0_24px_48px_-16px_rgba(15,23,42,0.35)]">
        <span className="w-10 h-10 rounded-xl bg-ringo-indigo/10 flex items-center justify-center mb-4">
          <Smartphone size={18} className="text-ringo-indigo" strokeWidth={2.25} />
        </span>

        <h2 className="text-[17px] font-semibold text-ringo-text tracking-[-0.01em] mb-1.5">{copy.title}</h2>
        <p className="text-sm text-ringo-muted leading-relaxed mb-4">{copy.body}</p>

        <div className="rounded-card border border-ringo-border/60 mb-5 overflow-hidden">
          <AddToHomeScreenMenuItem onNavigate={onNext} />
        </div>

        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onSkip}
            className="text-xs font-medium text-ringo-muted hover:text-ringo-text transition-colors"
          >
            {t.onboarding.skip}
          </button>

          <div className="flex items-center gap-3">
            <span className="text-xs text-ringo-muted">{stepLabel}</span>
            <button
              type="button"
              onClick={onNext}
              className="text-sm font-medium px-4 py-2 rounded-full bg-ringo-indigo text-white hover:bg-ringo-indigo/90 transition-colors"
            >
              {isLast ? t.onboarding.finish : t.onboarding.next}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
