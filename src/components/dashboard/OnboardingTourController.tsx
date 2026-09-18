"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { driver, type Driver } from "driver.js";
import "driver.js/dist/driver.css";
import { useLanguage } from "@/components/LanguageProvider";
import {
  buildOnboardingSteps,
  buildStepUrl,
  clearStoredStepIndex,
  getStoredStepIndex,
  setStoredStepIndex,
  type OnboardingStepConfig,
  type ProfileForTour,
} from "@/lib/onboardingTour";
import OnboardingInstallStep from "./OnboardingInstallStep";

// Mounted in DashboardShell.tsx (every /dashboard/** page), not just the
// Editor page — several steps' targets (Community/Booking toggles) live on
// entirely separate pages, and an Editor accordion section isn't even in
// the DOM until opened (Accordion.tsx conditionally renders its children).
// A real spotlight tour for those targets has to survive real page
// navigations and resume at the right step afterward — see
// src/lib/onboardingTour.ts for the step model this reads.
//
// Renders NOTHING at all unless there is a genuine reason to: either the
// account hasn't completed/dismissed the tour AND is on its designated
// entry page (/dashboard) with no tour in progress yet, or a tour is
// already in progress (sessionStorage) AND its current step's target
// actually lives on the page currently being viewed. A returning user who
// hasn't finished the tour but browses straight to some unrelated page
// never sees it pop up out of nowhere — it only ever appears where it's
// actually relevant.
export default function OnboardingTourController({
  showOnboardingTour,
  profile,
  username,
}: {
  showOnboardingTour: boolean;
  profile: ProfileForTour;
  username: string;
}) {
  const { t } = useLanguage();
  const pathname = usePathname();
  const router = useRouter();
  const driverRef = useRef<Driver | null>(null);

  const [canInstallApp, setCanInstallApp] = useState(false);
  const [steps, setSteps] = useState<OnboardingStepConfig[] | null>(null);
  const [stepIndex, setStepIndex] = useState<number | null>(null);

  // Same install-ability signals AddToHomeScreenMenuItem.tsx already uses
  // — this is the one, trivial "is this even possible" boolean the step
  // list needs ahead of time; the actual install mechanism itself is that
  // exact existing component, reused unmodified in OnboardingInstallStep.
  useEffect(() => {
    if (!showOnboardingTour) return;
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (window.navigator as any).standalone === true;
    if (standalone) return;
    const isIOS = /iPad|iPhone|iPod/.test(window.navigator.userAgent) && !(window as any).MSStream;
    if (isIOS) {
      setCanInstallApp(true);
      return;
    }
    const handler = (e: Event) => {
      e.preventDefault();
      setCanInstallApp(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, [showOnboardingTour]);

  useEffect(() => {
    if (!showOnboardingTour) return;
    setSteps(buildOnboardingSteps(profile, canInstallApp));
    // profile is a plain object from the server, stable per page load —
    // category/community_enabled/bookings_enabled are the only fields
    // that actually affect this, safe to depend on the whole object here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showOnboardingTour, canInstallApp]);

  // Resolve which step is active: resume from sessionStorage if this is a
  // navigation the tour itself triggered, otherwise this is only a
  // legitimate fresh start on /dashboard (the designated entry page) —
  // never auto-starting because someone happened to land on, say,
  // /dashboard/analytics first.
  useEffect(() => {
    if (!showOnboardingTour || !steps) return;
    const stored = getStoredStepIndex();
    if (stored != null && stored < steps.length) {
      setStepIndex(stored);
    } else if (pathname === "/dashboard") {
      setStoredStepIndex(0);
      setStepIndex(0);
    } else {
      setStepIndex(null);
    }
  }, [showOnboardingTour, steps, pathname]);

  const finish = async (outcome: "completed" | "dismissed") => {
    clearStoredStepIndex();
    setStepIndex(null);
    try {
      const res = await fetch("/api/onboarding/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        console.error(`OnboardingTour: failed to persist "${outcome}" —`, body?.error || res.status);
      }
    } catch (err) {
      console.error(`OnboardingTour: network error persisting "${outcome}" —`, err);
    }
  };

  const goToStep = (index: number, currentSteps: OnboardingStepConfig[]) => {
    const step = currentSteps[index];
    setStoredStepIndex(index);
    if (step.page === pathname && !step.section) {
      // Same page, nothing hidden needs opening — just move the spotlight.
      setStepIndex(index);
    } else if (step.section) {
      // A collapsed Accordion section (Editor.tsx) only ever opens via its
      // defaultOpenId, read once on mount — a client-side transition can't
      // reopen it, so this reuses the exact same hard-navigation mechanism
      // ProfileCompletionCard.tsx already relies on for the same reason.
      window.location.href = buildStepUrl(step);
    } else {
      router.push(step.page);
    }
  };

  // Drive the actual spotlight for whichever step is both active and on
  // the current page.
  useEffect(() => {
    if (stepIndex == null || !steps) return undefined;
    const step = steps[stepIndex];
    if (step.page !== pathname) return undefined; // dormant — wrong page for this step
    if (step.key === "installApp") return undefined; // handled by the plain modal below instead

    const isLast = stepIndex === steps.length - 1;
    const copy = t.onboarding.steps[step.key];
    const progressLabel = t.onboarding.step(stepIndex + 1, steps.length);

    const instance = driver({
      allowClose: false,
      overlayColor: "#0f172a",
      overlayOpacity: 0.55,
      stagePadding: 6,
      stageRadius: 10,
      popoverClass: "ringo-onboarding-popover",
      steps: [
        {
          element: step.selector || undefined,
          popover: {
            title: copy.title,
            description: `${copy.body}<div class="ringo-onboarding-progress">${progressLabel}</div>`,
            showButtons: stepIndex > 0 ? ["previous", "next"] : ["next"],
            nextBtnText: isLast ? t.onboarding.finish : t.onboarding.next,
            prevBtnText: t.onboarding.back,
            onNextClick: () => {
              if (isLast) {
                finish("completed");
                return;
              }
              goToStep(stepIndex + 1, steps);
            },
            onPrevClick: () => goToStep(stepIndex - 1, steps),
          },
        },
      ],
    });
    driverRef.current = instance;
    instance.drive();

    return () => instance.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex, steps, pathname]);

  if (!showOnboardingTour || stepIndex == null || !steps || steps[stepIndex].page !== pathname) return null;

  const currentStep = steps[stepIndex];
  const isLast = stepIndex === steps.length - 1;

  return (
    <>
      {currentStep.key === "installApp" ? (
        <OnboardingInstallStep
          stepLabel={t.onboarding.step(stepIndex + 1, steps.length)}
          isLast={isLast}
          onSkip={() => finish("dismissed")}
          onNext={() => (isLast ? finish("completed") : goToStep(stepIndex + 1, steps))}
        />
      ) : (
        // driver.js's own popover has no natural slot for a 4th action
        // distinct from "close" (allowClose is off — closing the overlay
        // must never silently count as either outcome) — this small fixed
        // control is the tour's real "Skip" action for every spotlight step.
        <button
          onClick={() => finish("dismissed")}
          className="fixed bottom-5 right-5 z-[100000] text-xs font-medium text-white/90 bg-black/60 hover:bg-black/75 px-3 py-1.5 rounded-full backdrop-blur transition-colors"
        >
          {t.onboarding.skip}
        </button>
      )}

      <style jsx global>{`
        .ringo-onboarding-popover {
          border-radius: 16px !important;
          font-family: inherit !important;
        }
        .ringo-onboarding-popover .driver-popover-title {
          font-size: 16px !important;
          font-weight: 600 !important;
        }
        .ringo-onboarding-popover .driver-popover-next-btn,
        .ringo-onboarding-popover .driver-popover-prev-btn {
          background: #4f46e5 !important;
          color: #fff !important;
          text-shadow: none !important;
          border-radius: 999px !important;
          border: none !important;
        }
        .ringo-onboarding-popover .driver-popover-prev-btn {
          background: transparent !important;
          color: #4f46e5 !important;
        }
        .ringo-onboarding-progress {
          margin-top: 10px;
          font-size: 12px;
          opacity: 0.6;
        }
      `}</style>
    </>
  );
}
