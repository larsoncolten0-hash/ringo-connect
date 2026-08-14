"use client";

import { useState, useRef } from "react";
import { Reorder, useDragControls, AnimatePresence, motion } from "framer-motion";
import { GripVertical, ChevronDown } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import ImageUploadField from "./ImageUploadField";

export default function LinkRow({
  link,
  userId,
  onChange,
  onPersist,
  onDelete,
  startExpanded,
}: {
  link: any;
  userId: string;
  onChange: (patch: any) => void;
  onPersist: (patch: any) => void;
  onDelete: () => void;
  startExpanded?: boolean;
}) {
  const { t } = useLanguage();
  const controls = useDragControls();
  const [expanded, setExpanded] = useState(!!startExpanded);
  const titleRef = useRef<HTMLInputElement>(null);

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
          onChange={(url) => {
            onChange({ image_url: url });
            onPersist({ image_url: url });
          }}
          userId={userId}
          folder="links"
          size={38}
          errorText={t.editor.upload}
        />

        <button
          type="button"
          onClick={() => {
            const next = !expanded;
            setExpanded(next);
            if (next) setTimeout(() => titleRef.current?.focus(), 150);
          }}
          className="flex-1 min-w-0 text-left"
        >
          <p className="text-sm font-medium text-ringo-text truncate">
            {link.title || t.editor.untitledLink}
          </p>
          <p className="text-xs text-ringo-muted truncate">{link.description || link.url}</p>
        </button>

        <ChevronDown
          size={16}
          className={`shrink-0 text-ringo-muted transition-transform ${expanded ? "rotate-180" : ""}`}
          onClick={() => setExpanded((v) => !v)}
        />
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-2.5 pb-2.5 pt-1 border-t border-ringo-border flex flex-col gap-2">
              <input
                ref={titleRef}
                value={link.title}
                onChange={(e) => onChange({ title: e.target.value })}
                onBlur={(e) => onPersist({ title: e.target.value })}
                placeholder={t.editor.linkTitlePlaceholder}
                className="w-full text-sm border border-ringo-border rounded-card px-3 py-2 bg-ringo-surface text-ringo-text"
              />
              <input
                value={link.url}
                onChange={(e) => onChange({ url: e.target.value })}
                onBlur={(e) => onPersist({ url: e.target.value })}
                placeholder={t.editor.linkUrlPlaceholder}
                inputMode="url"
                className="w-full text-sm border border-ringo-border rounded-card px-3 py-2 bg-ringo-surface text-ringo-muted"
              />
              <input
                value={link.description ?? ""}
                onChange={(e) => onChange({ description: e.target.value })}
                onBlur={(e) => onPersist({ description: e.target.value })}
                placeholder={t.editor.linkDescriptionPlaceholder}
                className="w-full text-sm border border-ringo-border rounded-card px-3 py-2 bg-ringo-surface text-ringo-muted"
              />
              <button
                onClick={onDelete}
                className="self-start text-xs text-red-500 px-1 py-1"
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