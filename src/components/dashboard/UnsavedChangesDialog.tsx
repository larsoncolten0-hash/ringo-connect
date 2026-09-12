"use client";

import { AlertTriangle } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";

// Shown by EditorSection when a row with edited-but-not-yet-saved fields
// is about to close (its own header re-clicked, or a different row
// opened) — one reusable dialog rather than hand-rolled per row.
export default function UnsavedChangesDialog({
  onKeepEditing,
  onDiscard,
}: {
  onKeepEditing: () => void;
  onDiscard: () => void;
}) {
  const { t } = useLanguage();

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onKeepEditing} />
      <div className="relative w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl bg-ringo-surface p-5 text-center">
        <span className="w-11 h-11 rounded-full bg-amber-500/10 flex items-center justify-center mx-auto mb-3">
          <AlertTriangle size={20} className="text-amber-500" />
        </span>
        <p className="text-sm font-semibold text-ringo-text mb-1">{t.editor.unsavedChangesTitle}</p>
        <p className="text-sm text-ringo-muted mb-5">{t.editor.unsavedChangesBody}</p>
        <div className="flex flex-col gap-2">
          <button
            onClick={onKeepEditing}
            className="w-full py-2.5 rounded-full text-sm font-semibold bg-ringo-indigo text-white transition hover:brightness-110"
          >
            {t.editor.keepEditing}
          </button>
          <button onClick={onDiscard} className="w-full py-2.5 rounded-full text-sm font-medium text-red-500 transition hover:bg-red-500/10">
            {t.editor.discardChanges}
          </button>
        </div>
      </div>
    </div>
  );
}
