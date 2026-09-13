"use client";

import { useEffect } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";

// Error boundary for every /dashboard/** route (same "one fallback for
// the whole segment" approach as loading.tsx) — catches a failed data
// fetch or render in any page under DashboardShell, so a broken section
// shows a clean message + Retry instead of Next's default error screen
// or an indefinite spinner. DashboardShell itself (sidebar, header, tab
// bar) stays mounted throughout: like loading.tsx, this only replaces
// the content area. Visually mirrors EmptyState.tsx's dashed-card
// language (same shape, red instead of indigo) so an error still reads
// as "on-brand", not a generic crash page.
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useLanguage();

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div
      role="alert"
      className="flex flex-col items-center text-center gap-3 py-16 px-4 rounded-2xl border border-dashed border-ringo-border bg-ringo-muted/[0.04]"
    >
      <span className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center">
        <AlertCircle size={17} className="text-red-500" strokeWidth={2.25} />
      </span>
      <p className="text-sm font-medium text-ringo-text">{t.dashboardError.title}</p>
      <p className="text-xs text-ringo-muted max-w-[280px] leading-relaxed">{t.dashboardError.hint}</p>
      <button
        type="button"
        onClick={reset}
        className="flex items-center gap-1.5 text-xs font-medium px-4 py-2 mt-1 rounded-full bg-ringo-indigo text-white hover:brightness-110 active:scale-[0.97] transition"
      >
        <RefreshCw size={13} />
        {t.dashboardError.retry}
      </button>
    </div>
  );
}
