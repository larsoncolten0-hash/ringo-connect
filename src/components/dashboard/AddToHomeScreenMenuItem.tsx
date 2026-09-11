"use client";

import { useEffect, useState } from "react";
import { Smartphone, Share, X } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";

// Dashboard-side "Add to Home Screen" entry, surfaced from AvatarMenu so
// it's reachable from every /dashboard/** page on every breakpoint
// (mobile included — unlike the sidebar, which is desktop-only). Mirrors
// components/AddToHomeScreen.tsx's install/iOS-detection logic; kept as a
// separate component because the dashboard has no per-profile theme
// colors to style a button from and this lives inside a dropdown row
// instead of a standalone card. Renders nothing at all when installing
// isn't actually possible (already installed, or a browser that supports
// neither the native prompt nor iOS's manual flow) — no dead menu item,
// same reasoning that replaced the old dashboard-wide InstallPrompt.
export default function AddToHomeScreenMenuItem({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useLanguage();
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(true); // hidden until the mount effect below checks
  const [showIOSInstructions, setShowIOSInstructions] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches || (window.navigator as any).standalone === true;
    setIsStandalone(standalone);
    if (standalone) return;

    const ua = window.navigator.userAgent;
    setIsIOS(/iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream);

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const install = async () => {
    if (isIOS) {
      setShowIOSInstructions(true);
      return;
    }
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    onNavigate?.();
  };

  const closeInstructions = () => {
    setShowIOSInstructions(false);
    onNavigate?.();
  };

  if (isStandalone || (!deferredPrompt && !isIOS)) return null;

  return (
    <>
      <button
        onClick={install}
        className="flex items-center gap-2 w-full px-3.5 py-2.5 text-sm text-ringo-text hover:bg-ringo-muted/10 transition-colors text-left"
      >
        <Smartphone size={14} />
        {t.dashboardInstall.menuItem}
      </button>

      {showIOSInstructions && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={closeInstructions} />
          <div className="relative w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl bg-ringo-surface p-5 text-ringo-text">
            <button
              onClick={closeInstructions}
              aria-label={t.addToHomeScreen.close}
              className="absolute right-4 top-4 w-8 h-8 rounded-full flex items-center justify-center bg-ringo-muted/10 text-ringo-text"
            >
              <X size={15} />
            </button>
            <p className="font-display text-base font-bold pr-8 mb-4">{t.dashboardInstall.iosTitle}</p>
            <ol className="text-sm flex flex-col gap-2.5 text-ringo-muted">
              <li className="flex items-center gap-2">
                <span className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-semibold text-white bg-ringo-indigo">
                  1
                </span>
                <Share size={14} className="shrink-0 text-ringo-indigo" />
                {t.addToHomeScreen.iosStep1}
              </li>
              <li className="flex items-center gap-2">
                <span className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-semibold text-white bg-ringo-indigo">
                  2
                </span>
                {t.addToHomeScreen.iosStep2}
              </li>
              <li className="flex items-center gap-2">
                <span className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-semibold text-white bg-ringo-indigo">
                  3
                </span>
                {t.addToHomeScreen.iosStep3}
              </li>
            </ol>
            <button
              onClick={closeInstructions}
              className="w-full mt-5 py-2.5 rounded-full text-sm font-semibold text-white bg-ringo-indigo"
            >
              {t.addToHomeScreen.gotIt}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
