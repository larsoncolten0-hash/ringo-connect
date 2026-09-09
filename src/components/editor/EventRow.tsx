"use client";

import { useState, useRef } from "react";
import { Reorder, useDragControls, AnimatePresence, motion } from "framer-motion";
import { GripVertical, ChevronDown } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import ImageUploadField from "./ImageUploadField";

export default function EventRow({
  event,
  userId,
  onChange,
  onPersist,
  onDelete,
  startExpanded,
}: {
  event: any;
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
      value={event}
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
          value={event.cover_image_url}
          onChange={(url) => {
            onChange({ cover_image_url: url });
            onPersist({ cover_image_url: url });
          }}
          userId={userId}
          folder="events"
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
            {event.title || t.music.untitledEvent}
          </p>
          <p className="text-xs text-ringo-muted truncate">
            {[event.event_date, event.location].filter(Boolean).join(" · ")}
          </p>
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
                value={event.title}
                onChange={(e) => onChange({ title: e.target.value })}
                onBlur={(e) => onPersist({ title: e.target.value })}
                placeholder={t.music.eventTitlePlaceholder}
                className="w-full text-sm border border-ringo-border rounded-card px-3 py-2 bg-ringo-surface text-ringo-text"
              />
              <input
                value={event.location ?? ""}
                onChange={(e) => onChange({ location: e.target.value })}
                onBlur={(e) => onPersist({ location: e.target.value })}
                placeholder={t.music.locationPlaceholder}
                className="w-full text-sm border border-ringo-border rounded-card px-3 py-2 bg-ringo-surface text-ringo-text"
              />
              <div className="flex gap-2">
                <input
                  type="date"
                  value={event.event_date ?? ""}
                  onChange={(e) => onChange({ event_date: e.target.value })}
                  onBlur={(e) => onPersist({ event_date: e.target.value || null })}
                  className="flex-1 min-w-0 text-sm border border-ringo-border rounded-card px-3 py-2 bg-ringo-surface text-ringo-text"
                />
                <input
                  value={event.event_time ?? ""}
                  onChange={(e) => onChange({ event_time: e.target.value })}
                  onBlur={(e) => onPersist({ event_time: e.target.value })}
                  placeholder={t.music.timePlaceholder}
                  className="w-32 text-sm border border-ringo-border rounded-card px-3 py-2 bg-ringo-surface text-ringo-text"
                />
              </div>
              <input
                value={event.ticket_url ?? ""}
                onChange={(e) => onChange({ ticket_url: e.target.value })}
                onBlur={(e) => onPersist({ ticket_url: e.target.value })}
                placeholder={t.music.ticketUrlPlaceholder}
                inputMode="url"
                className="w-full text-sm border border-ringo-border rounded-card px-3 py-2 bg-ringo-surface text-ringo-text"
              />
              <button onClick={onDelete} className="self-start text-xs text-red-500 px-1 py-1">
                {t.editor.delete}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Reorder.Item>
  );
}
