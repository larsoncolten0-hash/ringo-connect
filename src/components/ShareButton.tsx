"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Share, Link2, Check, Share2 } from "lucide-react";
import { FaWhatsapp, FaFacebook, FaXTwitter } from "react-icons/fa6";

// The public page's own share control — replaces what used to be a plain
// "copy link" button with the familiar share icon (an arrow out of a box,
// same glyph as iOS/Android's native share button) that opens a small menu
// of the usual options: copy link, WhatsApp, Facebook, X, and — where the
// browser supports it — the device's own native share sheet for "more".
// Colors are hardcoded (not the ringo-* design tokens) on purpose: this
// renders on the creator's own themed public page, over a photo, so it
// needs to read on any background regardless of that page's theme.
export default function ShareButton({
  accent,
  title,
  strings,
}: {
  accent: string;
  title: string;
  strings: {
    share: string;
    copyLink: string;
    linkCopied: string;
    shareWhatsapp: string;
    shareFacebook: string;
    shareX: string;
    moreOptions: string;
  };
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [canNativeShare, setCanNativeShare] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCanNativeShare(typeof navigator !== "undefined" && !!navigator.share);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const getUrl = () => (typeof window !== "undefined" ? window.location.href : "");

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(getUrl());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can fail (older browsers, non-HTTPS) — fail silently
      // rather than showing an error for a non-critical convenience feature.
    }
  };

  const nativeShare = async () => {
    try {
      await navigator.share({ title, url: getUrl() });
      setOpen(false);
    } catch {
      // User cancelled, or the call isn't actually supported despite the
      // feature check — leave the menu open with the fallback links intact.
    }
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={strings.share}
        aria-expanded={open}
        className="w-9 h-9 rounded-full flex items-center justify-center transition z-10"
        style={{ backgroundColor: "rgba(255,255,255,0.7)", color: accent }}
      >
        <Share size={15} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className="absolute top-11 right-0 w-56 rounded-2xl overflow-hidden z-20 text-sm"
            style={{ backgroundColor: "#FFFFFF", boxShadow: "0 16px 40px -12px rgba(0,0,0,0.3)" }}
          >
            <button
              onClick={copyLink}
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[#1F2937] hover:bg-black/[0.04] transition text-left"
            >
              {copied ? <Check size={15} className="text-emerald-500" /> : <Link2 size={15} className="text-[#6B7280]" />}
              {copied ? strings.linkCopied : strings.copyLink}
            </button>
            <a
              href={`https://wa.me/?text=${encodeURIComponent(`${title} — ${getUrl()}`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[#1F2937] hover:bg-black/[0.04] transition"
            >
              <FaWhatsapp size={15} color="#25D366" />
              {strings.shareWhatsapp}
            </a>
            <a
              href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(getUrl())}`}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[#1F2937] hover:bg-black/[0.04] transition"
            >
              <FaFacebook size={15} color="#1877F2" />
              {strings.shareFacebook}
            </a>
            <a
              href={`https://twitter.com/intent/tweet?url=${encodeURIComponent(getUrl())}&text=${encodeURIComponent(title)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[#1F2937] hover:bg-black/[0.04] transition"
            >
              <FaXTwitter size={15} color="#000000" />
              {strings.shareX}
            </a>
            {canNativeShare && (
              <button
                onClick={nativeShare}
                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[#1F2937] hover:bg-black/[0.04] transition text-left border-t border-black/5"
              >
                <Share2 size={15} className="text-[#6B7280]" />
                {strings.moreOptions}
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
