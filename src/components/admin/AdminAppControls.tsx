"use client";

import { useEffect, useState } from "react";
import { Smartphone, Share, X } from "lucide-react";

// "Add to Home Screen" install button for the admin console. Deliberately
// self-contained (hardcoded English, no useLanguage()) — AdminShell is
// English-only chrome, unlike the creator-facing dashboard, so this
// doesn't reuse AddToHomeScreenMenuItem.tsx/translations.ts.
//
// Push-notification opt-in used to live here too (as AdminPushToggle),
// but is now handled by NotificationBell.tsx (in-app feed) and
// PushPermissionPrompt.tsx (the proactive OS-push prompt) — both mounted
// directly from AdminShell. Installability and push are separate
// concerns; this component only ever does the former.
//
// Rendered twice from AdminShell: a compact icon-only button in the
// mobile top bar, and a labeled row in the desktop sidebar — `variant`
// switches between the two.

function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(true); // hidden until checked

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches || (window.navigator as any).standalone === true;
    setIsStandalone(standalone);
    if (standalone) return;

    setIsIOS(/iPad|iPhone|iPod/.test(window.navigator.userAgent) && !(window as any).MSStream);

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  return { deferredPrompt, isIOS, isStandalone, clearPrompt: () => setDeferredPrompt(null) };
}

function IOSInstructionsModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl bg-white p-5" style={{ color: "#14202B" }}>
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 w-8 h-8 rounded-full flex items-center justify-center"
          style={{ backgroundColor: "#F3F4F6", color: "#14202B" }}
        >
          <X size={15} />
        </button>
        <p className="font-display text-base font-bold pr-8 mb-4">Add Ringo Connect Admin to Your Home Screen</p>
        <ol className="text-sm flex flex-col gap-2.5" style={{ opacity: 0.8 }}>
          <li className="flex items-center gap-2">
            <span className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-semibold text-white bg-ringo-indigo">
              1
            </span>
            <Share size={14} className="shrink-0 text-ringo-indigo" />
            Tap the Share button in Safari's toolbar.
          </li>
          <li className="flex items-center gap-2">
            <span className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-semibold text-white bg-ringo-indigo">
              2
            </span>
            Select &quot;Add to Home Screen.&quot;
          </li>
          <li className="flex items-center gap-2">
            <span className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-semibold text-white bg-ringo-indigo">
              3
            </span>
            Tap &quot;Add.&quot;
          </li>
        </ol>
        <button onClick={onClose} className="w-full mt-5 py-2.5 rounded-full text-sm font-semibold text-white bg-ringo-indigo">
          Got it
        </button>
      </div>
    </div>
  );
}

export function AdminInstallButton({ variant }: { variant: "icon" | "row" }) {
  const { deferredPrompt, isIOS, isStandalone, clearPrompt } = useInstallPrompt();
  const [showIOSInstructions, setShowIOSInstructions] = useState(false);

  // No dead button, ever — same rule AddToHomeScreen.tsx and
  // AddToHomeScreenMenuItem.tsx follow.
  if (isStandalone || (!deferredPrompt && !isIOS)) return null;

  const install = async () => {
    if (isIOS) {
      setShowIOSInstructions(true);
      return;
    }
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    clearPrompt();
  };

  return (
    <>
      {variant === "icon" ? (
        <button
          onClick={install}
          aria-label="Install app"
          className="w-9 h-9 flex items-center justify-center rounded-full text-white/50 hover:text-white hover:bg-white/10 transition-colors"
        >
          <Smartphone size={16} />
        </button>
      ) : (
        <button
          onClick={install}
          className="flex items-center gap-2 w-full px-1 py-1.5 text-sm text-white/70 hover:text-white transition-colors text-left"
        >
          <Smartphone size={15} />
          Install app
        </button>
      )}
      {showIOSInstructions && <IOSInstructionsModal onClose={() => setShowIOSInstructions(false)} />}
    </>
  );
}
