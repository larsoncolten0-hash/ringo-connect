"use client";

import { useId } from "react";
import { AlertTriangle } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { useModalA11y } from "@/components/ui/useModalA11y";

// Shown by EditorSection when a row with edited-but-not-yet-saved fields
// is about to close (its own header re-clicked, or a different row
// opened) — one reusable dialog rather than hand-rolled per row. Also used by
// UnsavedNavigationGuard when leaving the editor would lose unsaved work.
//
// A real modal dialog: role="dialog" + aria-modal, labelled by its title, focus moves in and is
// trapped, Escape = "keep editing" (the safe choice), and focus returns to where it was.
export default function UnsavedChangesDialog({
  onKeepEditing,
  onDiscard,
  body,
  discardLabel,
}: {
  onKeepEditing: () => void;
  onDiscard: () => void;
  /** Overrides the default explanation (for example when an auto-save failed, or when leaving the page). */
  body?: string;
  /** Overrides the destructive button's label (for example "Leave anyway"). */
  discardLabel?: string;
}) {
  const { t } = useLanguage();
  const titleId = useId();
  const bodyId = useId();
  const ref = useModalA11y<HTMLDivElement>(onKeepEditing);

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" aria-hidden="true" onClick={onKeepEditing} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        className="relative w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl bg-ringo-surface p-5 text-center focus:outline-none"
      >
        <span className="w-11 h-11 rounded-full bg-amber-500/10 flex items-center justify-center mx-auto mb-3" aria-hidden="true">
          <AlertTriangle size={20} className="text-amber-500" />
        </span>
        <p id={titleId} className="text-sm font-semibold text-ringo-text mb-1">
          {t.editor.unsavedChangesTitle}
        </p>
        <p id={bodyId} className="text-sm text-ringo-muted mb-5">
          {body ?? t.editor.unsavedChangesBody}
        </p>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={onKeepEditing}
            className="w-full min-h-[44px] py-2.5 rounded-full text-sm font-semibold bg-ringo-indigo text-white transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/50 focus-visible:ring-offset-2"
          >
            {t.editor.keepEditing}
          </button>
          <button
            type="button"
            onClick={onDiscard}
            className="w-full min-h-[44px] py-2.5 rounded-full text-sm font-medium text-red-500 transition hover:bg-red-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
          >
            {discardLabel ?? t.editor.discardChanges}
          </button>
        </div>
      </div>
    </div>
  );
}
