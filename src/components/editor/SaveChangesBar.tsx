"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Loader2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { useEditorPreview } from "./EditorPreviewContext";

// Every card in the editor already writes its own changes to Supabase the
// moment they happen (on blur, on click, debounced for lists/reordering —
// see each card's own onPersist/persist). This bar doesn't add a second
// save path or change when anything actually gets written; it gives the
// creator one clear, deliberate action to confirm a change "took" —
// clicking it blurs whatever field is still focused (so a value just
// typed commits immediately instead of waiting for the next click
// elsewhere) and then shows a short, honest confirmation.
export default function SaveChangesBar() {
  const { t } = useLanguage();
  const { dirty, markSaved } = useEditorPreview();
  const [saving, setSaving] = useState(false);

  const handleSave = () => {
    setSaving(true);
    (document.activeElement as HTMLElement | null)?.blur?.();
    setTimeout(() => {
      setSaving(false);
      markSaved();
    }, 500);
  };

  return (
    <AnimatePresence>
      {(dirty || saving) && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="fixed bottom-20 lg:bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 pl-4 pr-2 py-2 rounded-full bg-ringo-text text-ringo-bg shadow-[0_16px_40px_-12px_rgba(15,23,42,0.45)]"
        >
          <span className="text-xs font-medium whitespace-nowrap">{t.editor.unsavedChanges}</span>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 text-xs font-semibold bg-ringo-bg text-ringo-text pl-3 pr-3.5 py-1.5 rounded-full transition hover:opacity-85 active:scale-95 disabled:opacity-70 whitespace-nowrap"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
            {saving ? t.editor.saving : t.editor.saveChanges}
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
