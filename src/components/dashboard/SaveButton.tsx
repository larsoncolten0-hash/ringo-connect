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
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled || state === "saving"}
      animate={state === "success" ? { scale: [1, 1.04, 1] } : { scale: 1 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className={`relative flex items-center justify-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold overflow-hidden transition-colors duration-200 disabled:opacity-80 ${
        state === "success"
          ? "bg-emerald-500 text-white"
          : state === "error"
          ? "bg-red-500 text-white"
          : "bg-ringo-indigo text-white hover:brightness-110 active:scale-[0.97]"
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
          {state === "saving" && <Loader2 size={15} className="animate-spin" />}
          {state === "success" && (
            <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 500, damping: 20 }}>
              <Check size={15} />
            </motion.span>
          )}
          {label}
        </motion.span>
      </AnimatePresence>
    </motion.button>
  );
}
