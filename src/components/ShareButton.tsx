"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Share, Link2, Check, Share2, QrCode, X, Download, Loader2 } from "lucide-react";
import { FaWhatsapp, FaFacebook, FaXTwitter } from "react-icons/fa6";
import { drawQrCodeWithLogo, downloadCanvas } from "@/lib/qrCode";

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
    showQrCode: string;
    qrCodeTitle: (name: string) => string;
    qrCodeSubtitle: string;
    qrCodeError: string;
    downloadQrCode: string;
    close: string;
  };
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [canNativeShare, setCanNativeShare] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [qrStatus, setQrStatus] = useState<"idle" | "generating" | "ready" | "error">("idle");
  const menuRef = useRef<HTMLDivElement>(null);
  const qrCanvasRef = useRef<HTMLCanvasElement>(null);

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

  // Draws once the modal opens — same shared logo-on-code renderer the
  // dashboard's QR code builder and the admin approval screen already use
  // (src/lib/qrCode.ts), so the look and download behavior never drift
  // between all three.
  useEffect(() => {
    if (!showQr) return;
    const canvas = qrCanvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    setQrStatus("generating");
    drawQrCodeWithLogo(canvas, getUrl(), 512)
      .then(() => {
        if (!cancelled) setQrStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setQrStatus("error");
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showQr]);

  const downloadQr = () => {
    const canvas = qrCanvasRef.current;
    if (!canvas || qrStatus !== "ready") return;
    const filename = title.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") || "ringo-connect";
    downloadCanvas(canvas, `${filename}-qr`, "png");
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
            <button
              onClick={() => {
                setOpen(false);
                setShowQr(true);
              }}
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[#1F2937] hover:bg-black/[0.04] transition text-left"
            >
              <QrCode size={15} className="text-[#6B7280]" />
              {strings.showQrCode}
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

      {showQr && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowQr(false)} />
          <div
            className="relative w-full sm:max-w-xs rounded-t-3xl sm:rounded-3xl bg-white p-5 flex flex-col items-center text-center"
            style={{ color: "#14202B" }}
          >
            <button
              onClick={() => setShowQr(false)}
              aria-label={strings.close}
              className="absolute right-4 top-4 w-8 h-8 rounded-full flex items-center justify-center"
              style={{ backgroundColor: "#F3F4F6", color: "#14202B" }}
            >
              <X size={15} />
            </button>

            <p className="font-display text-base font-bold pr-8">{strings.qrCodeTitle(title)}</p>
            <p className="text-xs mt-1 mb-4" style={{ opacity: 0.6 }}>
              {strings.qrCodeSubtitle}
            </p>

            <div
              className="rounded-2xl border flex items-center justify-center shrink-0"
              style={{ width: 240, height: 240, borderColor: "#E5E7EB" }}
            >
              {qrStatus === "generating" && <Loader2 size={22} className="animate-spin" style={{ color: "#9CA3AF" }} />}
              <canvas ref={qrCanvasRef} className={`max-w-full max-h-full ${qrStatus === "ready" ? "" : "hidden"}`} />
              {qrStatus === "error" && (
                <p className="text-xs px-4" style={{ color: "#991B1B" }}>
                  {strings.qrCodeError}
                </p>
              )}
            </div>

            <button
              onClick={downloadQr}
              disabled={qrStatus !== "ready"}
              className="w-full mt-5 flex items-center justify-center gap-2 py-3 rounded-full text-sm font-semibold text-white disabled:opacity-60"
              style={{ backgroundColor: accent }}
            >
              <Download size={15} />
              {strings.downloadQrCode}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
