"use client";

import Link from "next/link";
import { AlertCircle, ArrowRight, Loader2, X } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import type { SectionStatus } from "./sectionSaveState";

// The one place an editor section tells the user, in words, what state it is in. Rendered directly under
// the section so it stays visible after the section collapses (a Save closes it after a moment, and a
// late auto-save failure must not vanish with it).
//
//  - a polite status region (always mounted so screen readers announce changes): saving / saved / unsaved
//  - an alert region for failures, which stays until the user acts (retry, dismiss, or it succeeds)
//  - an optional "next step" after a successful Save
// Messages are generic by design: no backend error text is ever shown.
export interface NextHint {
  title: string;
  href: string;
  cta: string;
}

export default function SectionFeedback({
  status,
  saveFailedNote,
  onRetry,
  onDismissUndone,
  nextHint,
  onDismissHint,
}: {
  status: SectionStatus;
  /** A section Save failed; the edits are still in place. Persists until the next attempt. */
  saveFailedNote: boolean;
  onRetry: () => void;
  onDismissUndone: () => void;
  nextHint?: NextHint | null;
  onDismissHint?: () => void;
}) {
  const { t } = useLanguage();
  const a = t.editor.autosave;

  const polite =
    status === "saving" || status === "autosaving"
      ? a.saving
      : status === "saved"
      ? a.saved
      : status === "dirty"
      ? a.unsaved
      : "";

  const alert =
    status === "autosave_failed" ? a.failed : status === "autosave_undone" ? a.undone : saveFailedNote ? a.saveFailedKept : "";

  const btn =
    "inline-flex items-center justify-center min-h-[44px] px-3 rounded-full text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/50";
  const hintLink =
    "flex-1 min-w-0 min-h-[44px] flex items-center gap-1.5 text-xs text-ringo-text rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/50";

  return (
    <div className="px-1">
      <p
        role="status"
        aria-live="polite"
        className={polite ? "flex items-center gap-1.5 text-xs text-ringo-muted py-2" : "sr-only"}
      >
        {(status === "saving" || status === "autosaving") && <Loader2 size={12} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
        {polite}
      </p>

      {alert && (
        <div role="alert" className="flex items-start gap-2 rounded-card border border-red-500/30 bg-red-500/5 px-3 py-2.5 mb-2">
          <AlertCircle size={15} className="text-red-500 mt-0.5 shrink-0" aria-hidden="true" />
          <p className="flex-1 min-w-0 text-xs text-ringo-text leading-relaxed">{alert}</p>
          {status === "autosave_failed" && (
            <button type="button" onClick={onRetry} className={`${btn} -my-1.5 bg-red-500 text-white hover:brightness-110`}>
              {a.retry}
            </button>
          )}
          {status === "autosave_undone" && (
            <button type="button" onClick={onDismissUndone} aria-label={a.dismiss} className={`${btn} -my-1.5 -mr-2 text-ringo-muted hover:text-ringo-text`}>
              <X size={14} aria-hidden="true" />
            </button>
          )}
        </div>
      )}

      {nextHint && (
        <div role="status" className="flex items-center gap-2 rounded-card bg-ringo-indigo/[0.06] px-3 py-1.5 mb-2">
          {/* An editor section link (?section=…) must be a real page load: the accordion only reads which
              section to open when it first appears. Other destinations use normal navigation. */}
          {nextHint.href.startsWith("/dashboard?section=") ? (
            <a href={nextHint.href} className={hintLink}>
              <span className="min-w-0">
                <span className="font-semibold text-ringo-indigo">{nextHint.cta} </span>
                <span>{nextHint.title}</span>
              </span>
              <ArrowRight size={13} className="shrink-0 text-ringo-indigo" aria-hidden="true" />
            </a>
          ) : (
            <Link href={nextHint.href} className={hintLink}>
              <span className="min-w-0">
                <span className="font-semibold text-ringo-indigo">{nextHint.cta} </span>
                <span>{nextHint.title}</span>
              </span>
              <ArrowRight size={13} className="shrink-0 text-ringo-indigo" aria-hidden="true" />
            </Link>
          )}
          {onDismissHint && (
            <button type="button" onClick={onDismissHint} aria-label={a.dismiss} className={`${btn} text-ringo-muted hover:text-ringo-text`}>
              <X size={14} aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
