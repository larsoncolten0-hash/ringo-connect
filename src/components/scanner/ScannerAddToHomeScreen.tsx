"use client";

import { useEffect, useState } from "react";
import { Smartphone, Share, X } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";

// "Add to Home Screen" for one specific gate scanner — so a guard who
// accidentally closes the tab/app mid-event can reopen exactly their own
// gate's scanner from an icon instead of having to find the link again.
// Mirrors AddToHomeScreenMenuItem.tsx's install/iOS-detection logic
// (reusing its generic addToHomeScreen.* strings — nothing scanner-
// specific to translate beyond the gate name itself, already a runtime
// value). Kept as a small icon-only button in the scanner's own header
// rather than a dismissible card: "no unnecessary navigation... minimal
// buttons" applies here as much as to the rest of this screen, and unlike
// the profile's card this is never annoying on repeat visits — the same
// guard reopens this exact page for the length of one event.
export default function ScannerAddToHomeScreen({ gateName }: { gateName: string }) {
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
  };

  // Nothing to offer: already installed, or this browser supports neither
  // the native prompt nor iOS's manual flow — no dead button sitting over
  // the camera view.
  if (isStandalone || (!deferredPrompt && !isIOS)) return null;

  return (
    <>
      <button
        onClick={install}
        aria-label={t.addToHomeScreen.button}
        className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
        style={{ backgroundColor: "rgba(255,255,255,0.15)" }}
      >
        <Smartphone size={14} className="text-white" />
      </button>

      {showIOSInstructions && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowIOSInstructions(false)} />
          <div className="relative w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl bg-white p-5" style={{ color: "#14202B" }}>
            <button
              onClick={() => setShowIOSInstructions(false)}
              aria-label={t.addToHomeScreen.close}
              className="absolute right-4 top-4 w-8 h-8 rounded-full flex items-center justify-center"
              style={{ backgroundColor: "#F3F4F6", color: "#14202B" }}
            >
              <X size={15} />
            </button>
            <p className="font-display text-base font-bold pr-8 mb-4">{t.addToHomeScreen.iosTitle(gateName)}</p>
            <ol className="text-sm flex flex-col gap-2.5" style={{ opacity: 0.8 }}>
              <li className="flex items-center gap-2">
                <span className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-semibold text-white bg-black">1</span>
                <Share size={14} className="shrink-0" />
                {t.addToHomeScreen.iosStep1}
              </li>
              <li className="flex items-center gap-2">
                <span className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-semibold text-white bg-black">2</span>
                {t.addToHomeScreen.iosStep2}
              </li>
              <li className="flex items-center gap-2">
                <span className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-semibold text-white bg-black">3</span>
                {t.addToHomeScreen.iosStep3}
              </li>
            </ol>
            <button
              onClick={() => setShowIOSInstructions(false)}
              className="w-full mt-5 py-2.5 rounded-full text-sm font-semibold text-white bg-black"
            >
              {t.addToHomeScreen.gotIt}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
