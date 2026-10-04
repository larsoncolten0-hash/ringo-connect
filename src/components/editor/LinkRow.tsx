"use client";

import { useId, useState, useRef } from "react";
import { Reorder, useDragControls, AnimatePresence, motion } from "framer-motion";
import { GripVertical, ChevronDown } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { useMotionDuration } from "@/components/ui/useMotionDuration";
import ImageUploadField from "./ImageUploadField";

// Field edits here only update local state (via onChange, which also
// feeds the live preview) — nothing is written to Supabase until the
// creator clicks the section's "Save Changes" (see LinksCard). A link
// added with "Add link" exists on screen only until then ("Not saved yet"),
// so abandoning it leaves no empty row behind. Delete and drag-reorder
// still happen immediately for links that are already saved.
export default function LinkRow({
  link,
  userId,
  onChange,
  onDelete,
  startExpanded,
  error,
}: {
  link: any;
  userId: string;
  onChange: (patch: any) => void;
  onDelete: () => void;
  startExpanded?: boolean;
  /** Why the last Save did not accept this link (shown under the address). */
  error?: string;
}) {
  const { t } = useLanguage();
  const dur = useMotionDuration();
  const controls = useDragControls();
  const [expanded, setExpanded] = useState(!!startExpanded || !!error);
  const titleRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const isNew = typeof link.id === "string" && link.id.startsWith("new:");
  const open = expanded || !!error;

  return (
    <Reorder.Item
      value={link}
      dragListener={false}
      dragControls={controls}
      className="border border-ringo-border rounded-card bg-ringo-bg overflow-hidden"
      whileDrag={{ scale: 1.02, boxShadow: "0 12px 28px -8px rgba(0,0,0,0.25)", zIndex: 10 }}
    >
      <div className="flex items-center gap-2 p-2.5">
        <div
          onPointerDown={(e) => controls.start(e)}
          className="touch-none cursor-grab active:cursor-grabbing text-ringo-muted p-1.5 -m-1.5 shrink-0"
          aria-label={t.editor.dragHint}
        >
          <GripVertical size={16} />
        </div>

        <ImageUploadField
          value={link.image_url}
          onChange={(url) => onChange({ image_url: url })}
          userId={userId}
          folder="links"
          size={38}
          errorText={t.editor.upload}
        />

        <button
          type="button"
          aria-expanded={open}
          onClick={() => {
            const next = !expanded;
            setExpanded(next);
            if (next) setTimeout(() => titleRef.current?.focus(), 150);
          }}
          className="flex-1 min-w-0 min-h-[44px] text-left rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/50"
        >
          <p className="text-sm font-medium text-ringo-text truncate">
            {link.title || t.editor.untitledLink}
          </p>
          <p className="text-xs text-ringo-muted truncate">
            {isNew && <span className="font-medium text-ringo-indigo">{t.editor.validation.notSavedYet} · </span>}
            {link.description || (link.url && link.url !== "https://" ? link.url : "")}
          </p>
        </button>

        <ChevronDown
          size={16}
          aria-hidden="true"
          className={`shrink-0 text-ringo-muted transition-transform ${open ? "rotate-180" : ""}`}
          onClick={() => setExpanded((v) => !v)}
        />
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: dur(0.2) }}
            className="overflow-hidden"
          >
            <div className="px-2.5 pb-2.5 pt-1 border-t border-ringo-border flex flex-col gap-2">
              <input
                ref={titleRef}
                value={link.title}
                onChange={(e) => onChange({ title: e.target.value })}
                placeholder={t.editor.linkTitlePlaceholder}
                aria-label={t.editor.linkTitlePlaceholder}
                className="w-full text-sm border border-ringo-border rounded-card px-3 py-2 bg-ringo-surface text-ringo-text"
              />
              <div>
                <input
                  value={link.url}
                  onChange={(e) => onChange({ url: e.target.value })}
                  placeholder={t.editor.linkUrlPlaceholder}
                  aria-label={`${t.editor.linkUrlPlaceholder} (${t.editor.validation.required})`}
                  aria-required="true"
                  aria-invalid={!!error}
                  aria-describedby={hintId}
                  inputMode="url"
                  autoCapitalize="none"
                  className={`w-full text-sm border rounded-card px-3 py-2 bg-ringo-surface text-ringo-text ${
                    error ? "border-red-500" : "border-ringo-border"
                  }`}
                />
                <p id={hintId} role={error ? "alert" : undefined} className={`text-xs mt-1 ${error ? "text-red-500" : "text-ringo-muted"}`}>
                  {error || t.editor.validation.urlHint}
                </p>
              </div>
              <input
                value={link.description ?? ""}
                onChange={(e) => onChange({ description: e.target.value })}
                placeholder={t.editor.linkDescriptionPlaceholder}
                aria-label={t.editor.linkDescriptionPlaceholder}
                className="w-full text-sm border border-ringo-border rounded-card px-3 py-2 bg-ringo-surface text-ringo-text"
              />
              <button
                type="button"
                onClick={onDelete}
                className="self-start min-h-[44px] text-xs text-red-500 px-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
              >
                {t.editor.delete}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Reorder.Item>
  );
}
