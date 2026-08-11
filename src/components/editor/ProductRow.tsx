"use client";

import { useState, useRef } from "react";
import { Reorder, useDragControls, AnimatePresence, motion } from "framer-motion";
import { GripVertical, ChevronDown } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { formatPrice } from "@/lib/currency";
import ImageUploadField from "./ImageUploadField";

export default function ProductRow({
  product,
  userId,
  currency,
  onChange,
  onPersist,
  onDelete,
  startExpanded,
}: {
  product: any;
  userId: string;
  currency: string;
  onChange: (patch: any) => void;
  onPersist: (patch: any) => void;
  onDelete: () => void;
  startExpanded?: boolean;
}) {
  const { t } = useLanguage();
  const controls = useDragControls();
  const [expanded, setExpanded] = useState(!!startExpanded);
  const nameRef = useRef<HTMLInputElement>(null);

  return (
    <Reorder.Item
      value={product}
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
          value={product.image_url}
          onChange={(url) => {
            onChange({ image_url: url });
            onPersist({ image_url: url });
          }}
          userId={userId}
          folder="products"
          size={38}
          errorText={t.editor.upload}
        />

        <button
          type="button"
          onClick={() => {
            const next = !expanded;
            setExpanded(next);
            if (next) setTimeout(() => nameRef.current?.focus(), 150);
          }}
          className="flex-1 min-w-0 text-left"
        >
          <p className="text-sm font-medium text-ringo-text truncate">
            {product.name || t.editor.untitledProduct}
          </p>
          <p className="text-xs text-ringo-muted truncate">{product.price ? formatPrice(product.price, currency) : ""}</p>
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
              <div className="flex gap-2">
                <input
                  ref={nameRef}
                  value={product.name}
                  onChange={(e) => onChange({ name: e.target.value })}
                  onBlur={(e) => onPersist({ name: e.target.value })}
                  placeholder={t.editor.productName}
                  className="flex-1 min-w-0 text-sm border border-ringo-border rounded-card px-3 py-2 bg-ringo-surface text-ringo-text"
                />
                <input
                  value={product.price ?? ""}
                  onChange={(e) => onChange({ price: e.target.value })}
                  onBlur={(e) => onPersist({ price: e.target.value })}
                  placeholder={t.editor.price}
                  inputMode="decimal"
                  className="w-24 text-sm border border-ringo-border rounded-card px-3 py-2 bg-ringo-surface text-ringo-text"
                />
              </div>
              <textarea
                value={product.description ?? ""}
                onChange={(e) => onChange({ description: e.target.value })}
                onBlur={(e) => onPersist({ description: e.target.value })}
                placeholder={t.editor.productDescription}
                rows={2}
                className="w-full text-sm border border-ringo-border rounded-card px-3 py-2 bg-ringo-surface text-ringo-text resize-none"
              />
              <input
                value={product.landing_url ?? ""}
                onChange={(e) => onChange({ landing_url: e.target.value })}
                onBlur={(e) => onPersist({ landing_url: e.target.value })}
                placeholder={t.editor.productLandingUrl}
                inputMode="url"
                className="w-full text-sm border border-ringo-border rounded-card px-3 py-2 bg-ringo-surface text-ringo-text"
              />
              <input
                value={product.whatsapp_message ?? ""}
                onChange={(e) => onChange({ whatsapp_message: e.target.value })}
                onBlur={(e) => onPersist({ whatsapp_message: e.target.value })}
                placeholder={t.editor.productWhatsappMessage}
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