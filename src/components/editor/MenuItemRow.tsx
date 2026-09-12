"use client";

import { useState, useRef } from "react";
import { Reorder, useDragControls, AnimatePresence, motion } from "framer-motion";
import { GripVertical, ChevronDown, Star, ImagePlus } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { formatPrice } from "@/lib/currency";
import ImageGalleryUploadField from "./ImageGalleryUploadField";

// Field edits here only update local state (via onChange, which also
// feeds the live preview) — nothing is written to Supabase until the
// creator clicks the "Save" button at the bottom of MenuCard. Only
// structural actions (delete, drag-reorder) still happen immediately.
export default function MenuItemRow({
  item,
  userId,
  currency,
  onChange,
  onDelete,
  startExpanded,
}: {
  item: any;
  userId: string;
  currency: string;
  onChange: (patch: any) => void;
  onDelete: () => void;
  startExpanded?: boolean;
}) {
  const { t } = useLanguage();
  const controls = useDragControls();
  const [expanded, setExpanded] = useState(!!startExpanded);
  const nameRef = useRef<HTMLInputElement>(null);

  return (
    <Reorder.Item
      value={item}
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

        <button
          type="button"
          onClick={() => {
            const next = !expanded;
            setExpanded(next);
            if (next) setTimeout(() => nameRef.current?.focus(), 150);
          }}
          style={{ width: 38, height: 38 }}
          className="relative shrink-0 overflow-hidden rounded-card border border-ringo-border bg-ringo-muted/5 flex items-center justify-center"
        >
          {item.image_urls?.[0] || item.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.image_urls?.[0] || item.image_url} alt="" className="w-full h-full object-cover" />
          ) : (
            <ImagePlus size={16} className="text-ringo-muted" />
          )}
        </button>

        <button
          type="button"
          onClick={() => {
            const next = !expanded;
            setExpanded(next);
            if (next) setTimeout(() => nameRef.current?.focus(), 150);
          }}
          className="flex-1 min-w-0 text-left"
        >
          <p className="text-sm font-medium text-ringo-text truncate flex items-center gap-1.5">
            {item.name || t.restaurant.untitledItem}
            {item.featured && <Star size={11} className="text-ringo-indigo shrink-0" fill="currentColor" />}
            {!item.available && (
              <span className="text-[10px] text-ringo-muted border border-ringo-border rounded-full px-1.5 py-0.5 shrink-0">
                {t.restaurant.currentlyUnavailable}
              </span>
            )}
          </p>
          <p className="text-xs text-ringo-muted truncate">{item.price ? formatPrice(item.price, currency) : ""}</p>
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
              <div>
                <p className="text-xs text-ringo-muted mb-1.5">{t.editor.photosLabel}</p>
                <ImageGalleryUploadField
                  value={item.image_urls?.length ? item.image_urls : item.image_url ? [item.image_url] : []}
                  onChange={(urls) => onChange({ image_urls: urls, image_url: urls[0] || null })}
                  userId={userId}
                  folder="menu-items"
                  errorText={t.editor.upload}
                />
              </div>
              <div className="flex gap-2">
                <input
                  ref={nameRef}
                  value={item.name}
                  onChange={(e) => onChange({ name: e.target.value })}
                  placeholder={t.restaurant.itemNamePlaceholder}
                  className="flex-1 min-w-0 text-sm border border-ringo-border rounded-card px-3 py-2 bg-ringo-surface text-ringo-text"
                />
                <input
                  value={item.price ?? ""}
                  onChange={(e) => onChange({ price: e.target.value })}
                  placeholder={t.restaurant.itemPricePlaceholder}
                  inputMode="decimal"
                  className="w-24 text-sm border border-ringo-border rounded-card px-3 py-2 bg-ringo-surface text-ringo-text"
                />
              </div>
              <textarea
                value={item.description ?? ""}
                onChange={(e) => onChange({ description: e.target.value })}
                placeholder={t.restaurant.itemDescriptionPlaceholder}
                rows={2}
                className="w-full text-sm border border-ringo-border rounded-card px-3 py-2 bg-ringo-surface text-ringo-text resize-none"
              />
              <input
                value={item.prep_time_minutes ?? ""}
                onChange={(e) => onChange({ prep_time_minutes: e.target.value.replace(/[^0-9]/g, "") })}
                placeholder={t.restaurant.prepTimePlaceholder}
                inputMode="numeric"
                className="w-full text-sm border border-ringo-border rounded-card px-3 py-2 bg-ringo-surface text-ringo-text"
              />
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-1.5 text-xs text-ringo-text cursor-pointer">
                  <input
                    type="checkbox"
                    checked={item.available !== false}
                    onChange={(e) => onChange({ available: e.target.checked })}
                    className="accent-ringo-indigo"
                  />
                  {t.restaurant.availableLabel}
                </label>
                <label className="flex items-center gap-1.5 text-xs text-ringo-text cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!item.featured}
                    onChange={(e) => onChange({ featured: e.target.checked })}
                    className="accent-ringo-indigo"
                  />
                  {t.restaurant.featuredLabel}
                </label>
              </div>
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
