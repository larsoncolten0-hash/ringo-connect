"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Loader2, Check } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";

export type SaveState = "idle" | "saving" | "success" | "error";

// A reusable "Save Changes" button with the four states EditorSection's
// save flow moves through — idle, saving, success, error.
export default function SaveButton({ state, onClick, disabled }: { state: SaveState; onClick: () => void; disabled?: boolean }) {
  const { t } = useLanguage();

  const label =
    state === "saving" ? t.editor.saving : state === "success" ? t.editor.savedSuccessfully : state === "error" ? t.editor.saveFailed : t.editor.saveChanges;

  return (
    // The button itself carries no framer-motion transform (an inline transform would override the press feedback): the success
    // confirmation is the check icon's own spring below. Idle is the elevated indigo CTA; success and error are flat, calm colours.
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || state === "saving"}
      aria-busy={state === "saving"}
      className={`ringo-tactile relative flex min-h-[44px] items-center justify-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold disabled:opacity-80 ${
        state === "success"
          ? "bg-emerald-600 text-white"
          : state === "error"
          ? "bg-red-600 text-white"
          : "ringo-cta"
      }`}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={state}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.15 }}
          className="flex items-center gap-2"
        >
          {state === "saving" && <Loader2 size={15} className="animate-spin motion-reduce:animate-none" />}
          {state === "success" && (
            <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 500, damping: 20 }}>
              <Check size={15} />
            </motion.span>
          )}
          {label}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}
