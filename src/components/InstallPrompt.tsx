"use client";

import { useEffect, useState } from "react";
import { Download, X, Share } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";

// Chrome/Android fire `beforeinstallprompt` and let us trigger the native
// install dialog on demand. Safari/iOS never fire this event at all —
// there's no programmatic install API there, so the only option is
// detecting iOS and showing manual "Tap Share, then Add to Home Screen"
// instructions instead. Without this split, an install button would just
// silently do nothing for every iPhone user.
export default function InstallPrompt() {
  const { t } = useLanguage();
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [showIOSInstructions, setShowIOSInstructions] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem("install-prompt-dismissed")) {
      setDismissed(true);
      return;
    }

    // Already running as an installed app — nothing to prompt.
    if (window.matchMedia("(display-mode: standalone)").matches) {
      setDismissed(true);
      return;
    }

    const ua = window.navigator.userAgent;
    const iOS = /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream;
    setIsIOS(iOS);

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const dismiss = () => {
    setDismissed(true);
    sessionStorage.setItem("install-prompt-dismissed", "true");
  };

  const install = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    dismiss();
  };

  if (dismissed || (!deferredPrompt && !isIOS)) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:w-80 z-50 rounded-card border border-ringo-border bg-ringo-surface shadow-[0_8px_30px_-6px_rgba(15,23,42,0.2)] p-4">
      <button
        onClick={dismiss}
        aria-label={t.installPrompt.dismiss}
        className="absolute top-3 right-3 text-ringo-muted hover:text-ringo-text"
      >
        <X size={15} />
      </button>

      {!showIOSInstructions ? (
        <>
          <p className="text-sm font-medium text-ringo-text pr-5 mb-1">{t.installPrompt.title}</p>
          <p className="text-xs text-ringo-muted mb-3">{t.installPrompt.body}</p>
          <button
            onClick={isIOS ? () => setShowIOSInstructions(true) : install}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-card bg-ringo-indigo text-white text-xs font-medium"
          >
            <Download size={13} />
            {t.installPrompt.installButton}
          </button>
        </>
      ) : (
        <>
          <p className="text-sm font-medium text-ringo-text pr-5 mb-2">{t.installPrompt.title}</p>
          <ol className="text-xs text-ringo-muted flex flex-col gap-1.5">
            <li className="flex items-center gap-1.5">
              1. <Share size={13} className="text-ringo-indigo shrink-0" /> {t.installPrompt.iosStep1}
            </li>
            <li>2. {t.installPrompt.iosStep2}</li>
            <li>3. {t.installPrompt.iosStep3}</li>
          </ol>
        </>
      )}
    </div>
  );
}