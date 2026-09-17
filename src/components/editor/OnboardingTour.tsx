"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { LayoutDashboard, Sparkles, LayoutGrid, MonitorSmartphone, Share2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import MenuBackdrop from "@/components/ui/MenuBackdrop";

const STEPS = [
  { key: "welcome", icon: Sparkles },
  { key: "profile", icon: LayoutDashboard },
  { key: "sections", icon: LayoutGrid },
  { key: "preview", icon: MonitorSmartphone },
  { key: "share", icon: Share2 },
] as const;

// Shown exactly once per account — on the very first dashboard load after
// signup, never again on any later login (see 2026-09-18_onboarding_tour.sql
// and /api/onboarding/complete). Editor.tsx only mounts this at all when
// the server already determined `onboarding_completed_at` is null, so
// there's nothing to check client-side beyond that one prop.
export default function OnboardingTour() {
  const { t } = useLanguage();
  const [dismissed, setDismissed] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  const finish = () => {
    setDismissed(true);
    fetch("/api/onboarding/complete", { method: "POST" }).catch(() => {
      // Best-effort — worst case the tour shows once more next login,
      // which is far better than blocking dismissal on a network call.
    });
  };

  if (dismissed) return null;

  const step = STEPS[stepIndex];
  const Icon = step.icon;
  const isLast = stepIndex === STEPS.length - 1;
  const copy = t.onboarding.steps[step.key];

  return (
    <>
      <MenuBackdrop onClose={() => {}} className="z-[60]" portal />
      <div className="fixed inset-0 z-[61] flex items-center justify-center p-4 pointer-events-none">
        <AnimatePresence mode="wait">
          <motion.div
            key={step.key}
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="pointer-events-auto w-full max-w-sm rounded-[20px] border border-ringo-border/60 bg-ringo-surface p-6 shadow-[0_24px_48px_-16px_rgba(15,23,42,0.35)]"
          >
            <span className="w-10 h-10 rounded-xl bg-ringo-indigo/10 flex items-center justify-center mb-4">
              <Icon size={18} className="text-ringo-indigo" strokeWidth={2.25} />
            </span>

            <h2 className="text-[17px] font-semibold text-ringo-text tracking-[-0.01em] mb-1.5">{copy.title}</h2>
            <p className="text-sm text-ringo-muted leading-relaxed mb-5">{copy.body}</p>

            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={finish}
                className="text-xs font-medium text-ringo-muted hover:text-ringo-text transition-colors"
              >
                {t.onboarding.skip}
              </button>

              <div className="flex items-center gap-3">
                <span className="text-xs text-ringo-muted">{t.onboarding.step(stepIndex + 1, STEPS.length)}</span>
                {stepIndex > 0 && (
                  <button
                    type="button"
                    onClick={() => setStepIndex((i) => i - 1)}
                    className="text-sm font-medium px-3.5 py-2 rounded-full text-ringo-text hover:bg-ringo-muted/[0.06] transition-colors"
                  >
                    {t.onboarding.back}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => (isLast ? finish() : setStepIndex((i) => i + 1))}
                  className="text-sm font-medium px-4 py-2 rounded-full bg-ringo-indigo text-white hover:bg-ringo-indigo/90 transition-colors"
                >
                  {isLast ? t.onboarding.finish : t.onboarding.next}
                </button>
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </>
  );
}
