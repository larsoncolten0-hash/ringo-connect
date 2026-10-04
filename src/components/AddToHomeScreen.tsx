"use client";

import { useEffect, useState } from "react";
import { Smartphone, X, Share } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { hexToRgba } from "@/lib/color";
import { useModalA11y } from "@/components/ui/useModalA11y";

// The iOS instructions sheet as a real modal: named, focus moves in and is trapped, Escape closes, focus returns to the
// button that opened it. A component of its own so the shared hook mounts exactly when the sheet does.
function IosDialogShell({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useModalA11y<HTMLDivElement>(onClose);
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className="relative w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl bg-white p-5 outline-none"
        style={{ color: "#14202B" }}
      >
        {children}
      </div>
    </div>
  );
}

// Reusable "Add to Home Screen" card for a public profile — entirely
// separate from the Community "Stay Connected" section (no shared state,
// never collects email/phone, installing implies no marketing consent of
// any kind). Renders nothing at all unless installation is actually
// possible on this browser: no dead button, ever. See the implementation
// plan for the full reasoning (per-profile localStorage dismissal instead
// of the removed global InstallPrompt's sessionStorage banner, etc.).
export default function AddToHomeScreen({
  displayName,
  username,
  accent,
  radiusClass,
  buttonStyle,
  borderTint,
  textColor,
}: {
  displayName: string;
  username: string;
  accent: string;
  radiusClass: string;
  buttonStyle: React.CSSProperties;
  borderTint: string;
  textColor: string;
}) {
  const { t } = useLanguage();
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [dismissed, setDismissed] = useState(true); // defaults hidden until the mount effect below clears it
  const [showIOSInstructions, setShowIOSInstructions] = useState(false);

  const dismissKey = `ringo-a2hs-dismissed-${username}`;

  useEffect(() => {
    // Already running as the installed app — nothing to offer.
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches || (window.navigator as any).standalone === true;
    if (standalone) return;

    // Dismissal is per-profile and persisted in localStorage (not
    // sessionStorage) — deliberately different from the removed dashboard-
    // wide InstallPrompt, which reappeared every new tab and was removed
    // for exactly that reason. Here, dismissing Jay Kay's card never
    // hides a different profile's, and dismissing it once actually sticks.
    // Storage can be blocked (private mode, site data off): reading it must never break the page.
    try {
      if (localStorage.getItem(dismissKey)) return;
    } catch {
      // treated as "not dismissed before"
    }

    setDismissed(false);

    const ua = window.navigator.userAgent;
    setIsIOS(/iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream);

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username]);

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(dismissKey, "true");
    } catch {
      // localStorage can be unavailable (private mode, storage blocked) —
      // the card just won't remember the dismissal next visit; not worth
      // failing over.
    }
  };

  const install = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    dismiss();
  };

  // Nothing to offer on this browser at all (desktop Firefox, older
  // Safari, etc.) — no dead button.
  if (dismissed || (!deferredPrompt && !isIOS)) return null;

  return (
    <div
      className={`text-center p-5 ${radiusClass}`}
      style={{ border: `1px solid ${borderTint}`, backgroundColor: hexToRgba(textColor, 0.03) }}
    >
      <p className="text-[11px] uppercase tracking-wider font-semibold" style={{ opacity: 0.5 }}>
        {t.addToHomeScreen.title(displayName)}
      </p>
      <p className="text-sm mt-1.5 mb-4" style={{ opacity: 0.75 }}>
        {t.addToHomeScreen.subtitle}
      </p>
      <button
        onClick={isIOS ? () => setShowIOSInstructions(true) : install}
        className={`inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-medium transition hover:brightness-95 active:scale-[0.98] ${radiusClass}`}
        style={buttonStyle}
      >
        <Smartphone size={15} />
        {t.addToHomeScreen.button}
      </button>

      {showIOSInstructions && (
        <IosDialogShell label={t.addToHomeScreen.iosTitle(displayName)} onClose={() => setShowIOSInstructions(false)}>
            <button
              onClick={() => setShowIOSInstructions(false)}
              aria-label={t.addToHomeScreen.close}
              className="absolute right-2 top-2 w-11 h-11 rounded-full flex items-center justify-center"
              style={{ backgroundColor: "#F3F4F6", color: "#14202B" }}
            >
              <X size={15} />
            </button>
            <p className="font-display text-base font-bold pr-8 mb-4">{t.addToHomeScreen.iosTitle(displayName)}</p>
            <ol className="text-sm flex flex-col gap-2.5" style={{ opacity: 0.8 }}>
              <li className="flex items-center gap-2">
                <span
                  className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-semibold text-white"
                  style={{ backgroundColor: accent }}
                >
                  1
                </span>
                <Share size={14} className="shrink-0" style={{ color: accent }} />
                {t.addToHomeScreen.iosStep1}
              </li>
              <li className="flex items-center gap-2">
                <span
                  className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-semibold text-white"
                  style={{ backgroundColor: accent }}
                >
                  2
                </span>
                {t.addToHomeScreen.iosStep2}
              </li>
              <li className="flex items-center gap-2">
                <span
                  className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-semibold text-white"
                  style={{ backgroundColor: accent }}
                >
                  3
                </span>
                {t.addToHomeScreen.iosStep3}
              </li>
            </ol>
            <button
              onClick={() => {
                setShowIOSInstructions(false);
                dismiss();
              }}
              className="w-full mt-5 py-2.5 rounded-full text-sm font-semibold text-white"
              style={{ backgroundColor: accent }}
            >
              {t.addToHomeScreen.gotIt}
            </button>
        </IosDialogShell>
      )}
    </div>
  );
}
