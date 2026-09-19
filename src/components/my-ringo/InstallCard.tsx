"use client";

import { Check, Download, Info, Share, Smartphone } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { useInstallPrompt } from "./useInstallPrompt";

// "Install My Ringo" — the one central customer app. Every state is honest:
// a real install button only when the browser has actually offered
// installation, step-by-step text on iOS (where the browser offers no
// prompt), a confirmation when already installed, and a plain explanation
// otherwise — never a button that does nothing.
//
// `compact` (Home) renders nothing unless there is something actionable to
// offer; the full card (Me) always explains the current state.
export default function InstallCard({ compact = false }: { compact?: boolean }) {
  const { t } = useLanguage();
  const { state, install } = useInstallPrompt();
  const p = t.myRingo.pwa;

  if (compact && state !== "available" && state !== "ios") return null;

  const shell = "rounded-2xl border border-ringo-border/70 bg-ringo-surface p-4";
  const icon = "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl";

  if (state === "installed") {
    return (
      <div className={`${shell} flex items-start gap-3`}>
        <span className={`${icon} bg-emerald-500/10 text-emerald-600`}>
          <Check size={19} />
        </span>
        <div>
          <p className="text-sm font-semibold text-ringo-text">{p.installedTitle}</p>
          <p className="mt-0.5 text-xs text-ringo-muted">{p.installedBody}</p>
        </div>
      </div>
    );
  }

  if (state === "available") {
    return (
      <div className={`${shell} flex flex-col gap-3 sm:flex-row sm:items-center`}>
        <div className="flex flex-1 items-start gap-3">
          <span className={`${icon} bg-ringo-indigo/10 text-ringo-indigo`}>
            <Smartphone size={19} />
          </span>
          <div>
            <p className="text-sm font-semibold text-ringo-text">{p.installTitle}</p>
            <p className="mt-0.5 text-xs text-ringo-muted">{p.installBody}</p>
          </div>
        </div>
        <button
          onClick={install}
          className="flex items-center justify-center gap-2 rounded-xl bg-ringo-indigo px-4 py-2.5 text-sm font-semibold text-white transition active:scale-[0.98]"
        >
          <Download size={15} />
          {p.installButton}
        </button>
      </div>
    );
  }

  if (state === "ios") {
    return (
      <div className={`${shell} flex items-start gap-3`}>
        <span className={`${icon} bg-ringo-indigo/10 text-ringo-indigo`}>
          <Share size={18} />
        </span>
        <div>
          <p className="text-sm font-semibold text-ringo-text">{p.iosTitle}</p>
          <p className="mt-0.5 text-xs text-ringo-muted">{p.iosBody}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`${shell} flex items-start gap-3`}>
      <span className={`${icon} bg-ringo-muted/15 text-ringo-muted`}>
        <Info size={18} />
      </span>
      <div>
        <p className="text-sm font-semibold text-ringo-text">{state === "checking" ? p.installTitle : p.unavailableTitle}</p>
        <p className="mt-0.5 text-xs text-ringo-muted">{state === "checking" ? p.checking : p.unavailableBody}</p>
      </div>
    </div>
  );
}
