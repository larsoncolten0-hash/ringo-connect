"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, X, ZoomIn, ZoomOut } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";

// A clean full-screen viewer for ONE image of a conversation. Escape or a click outside closes it, focus moves in and returns to the thumbnail, the page behind stops scrolling,
// and the image can be zoomed (buttons, or a click on the picture). The download link points at the same authenticated Ringo route as the thumbnail.
export default function ImageLightbox({ src, downloadHref, alt, onClose }: { src: string; downloadHref: string; alt: string; onClose: () => void }) {
  const { t } = useLanguage();
  const u = t.inbox;
  const [zoomed, setZoomed] = useState(false);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const returnTo = useRef<Element | null>(null);

  useEffect(() => {
    returnTo.current = document.activeElement;
    closeRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      (returnTo.current as HTMLElement | null)?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const btn = "inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white";
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={u.imageViewer} className="fixed inset-0 z-[100] flex flex-col bg-black/90" onClick={onClose} data-testid="image-lightbox">
      <div className="flex items-center justify-end gap-2 p-3" onClick={(e) => e.stopPropagation()}>
        <button type="button" className={btn} onClick={() => setZoomed((z) => !z)} aria-label={zoomed ? u.zoomOut : u.zoomIn} aria-pressed={zoomed}>
          {zoomed ? <ZoomOut size={18} aria-hidden="true" /> : <ZoomIn size={18} aria-hidden="true" />}
        </button>
        <a className={btn} href={downloadHref} download aria-label={u.mediaDownload}>
          <Download size={18} aria-hidden="true" />
        </a>
        <button ref={closeRef} type="button" className={btn} onClick={onClose} aria-label={u.closeViewer}>
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      <div className={`flex min-h-0 flex-1 items-center justify-center p-3 ${zoomed ? "overflow-auto" : "overflow-hidden"}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          onClick={(e) => {
            e.stopPropagation();
            setZoomed((z) => !z);
          }}
          className={zoomed ? "max-w-none cursor-zoom-out" : "max-h-full max-w-full cursor-zoom-in object-contain"}
          style={zoomed ? { width: "200%", height: "auto" } : undefined}
          draggable={false}
        />
      </div>
    </div>,
    document.body,
  );
}
