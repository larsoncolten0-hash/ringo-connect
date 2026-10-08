"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, m, useReducedMotion } from "framer-motion";
import { Share, Link2, Check, Share2, QrCode, X, Download, Loader2 } from "lucide-react";
import { FaWhatsapp, FaFacebook, FaXTwitter } from "react-icons/fa6";
// The QR renderer (and the qrcode library behind it) is only needed when someone opens "Show QR code": it is loaded then, not with every public page.
const loadQr = () => import("@/lib/qrCode");
import { cleanShareUrl } from "@/lib/shareUrl";
import { useLanguage } from "@/components/LanguageProvider";
import MenuBackdrop from "@/components/ui/MenuBackdrop";
import { useModalA11y } from "@/components/ui/useModalA11y";
import { nextMenuIndex, TAP_AREA_36 } from "@/components/ui/menuNav";
import MotionScope from "@/components/ui/MotionScope";

// The QR sheet's dialog frame: a real modal (role, aria-modal, name, focus moves in and is trapped,
// Escape closes, focus returns when it goes away). A component of its own so useModalA11y mounts exactly
// when the sheet does.
function QrDialogShell({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useModalA11y<HTMLDivElement>(onClose);
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className="relative w-full sm:max-w-xs rounded-t-3xl sm:rounded-3xl bg-white p-5 flex flex-col items-center text-center outline-none"
        style={{ color: "#14202B" }}
      >
        {children}
      </div>
    </div>
  );
}

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
  // Keeps the open menu's backdrop off a sticky header above it, for
  // callers that have one — ItemDetailPage's compact ~60px sticky bar
  // passes "top-[60px]"; the default (full coverage) is correct for
  // ProfileView's own usage, which floats this over a hero image with no
  // header at all.
  backdropTop = "top-0",
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
  backdropTop?: string;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const { t } = useLanguage();
  const [canNativeShare, setCanNativeShare] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [qrStatus, setQrStatus] = useState<"idle" | "generating" | "ready" | "error">("idle");
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const reduceMotion = useReducedMotion();
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

  // Keyboard users land on the first option as soon as the menu opens, so the arrow keys work at once.
  useEffect(() => {
    if (open) panelRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);

  const closeMenu = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  const closeQr = () => {
    setShowQr(false);
    triggerRef.current?.focus();
  };

  // Escape closes and gives focus back to the Share button; the arrow keys, Home and End move between
  // options; Tab simply leaves the menu.
  const onMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeMenu(true);
      return;
    }
    if (e.key === "Tab") {
      setOpen(false);
      return;
    }
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    const next = nextMenuIndex(e.key, items.indexOf(document.activeElement as HTMLElement), items.length);
    if (next !== null) {
      e.preventDefault();
      items[next].focus();
    }
  };

  // The page's address without the visit's own advertising / analytics identifiers (see lib/shareUrl.ts).
  const getUrl = () => (typeof window !== "undefined" ? cleanShareUrl(window.location.href) : "");

  // The Clipboard API can be missing or refused (older browsers, non-HTTPS, a blocked permission): try the
  // long-standing select-and-copy route, and only if that fails too say so, instead of doing nothing.
  const legacyCopy = (text: string) => {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(area);
      return ok;
    } catch {
      return false;
    }
  };

  const copyLink = async () => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(getUrl());
      ok = true;
    } catch {
      ok = legacyCopy(getUrl());
    }
    setCopied(ok);
    setCopyFailed(!ok);
    setTimeout(() => {
      setCopied(false);
      setCopyFailed(false);
    }, ok ? 2000 : 3500);
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
    loadQr()
      .then(({ drawQrCodeWithLogo }) => drawQrCodeWithLogo(canvas, getUrl(), 512))
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
    loadQr().then(({ downloadCanvas }) => downloadCanvas(canvas, `${filename}-qr`, "png"));
  };

  return (
    <MotionScope>
    <div className="relative" ref={menuRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={strings.share}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        className={`w-11 h-11 rounded-full flex items-center justify-center transition z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current ${TAP_AREA_36}`}
        style={{ backgroundColor: "rgba(255,255,255,0.7)", color: accent }}
      >
        <Share size={15} />
      </button>

      <AnimatePresence>
        {open && (
          <>
            <MenuBackdrop key="backdrop" onClose={() => setOpen(false)} className="z-10" topClassName={backdropTop} />
            <m.div
              key="panel"
              ref={panelRef}
              id={menuId}
              role="menu"
              aria-label={strings.share}
              onKeyDown={onMenuKeyDown}
              initial={{ opacity: 0, y: -6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.97 }}
              transition={{ duration: reduceMotion ? 0 : 0.15 }}
              className="absolute top-11 right-0 w-56 rounded-2xl overflow-hidden z-20 text-sm"
              style={{ backgroundColor: "#FFFFFF", boxShadow: "0 16px 40px -12px rgba(0,0,0,0.3)" }}
            >
            <button
              role="menuitem"
              onClick={copyLink}
              className="w-full min-h-[44px] flex items-center gap-2.5 px-3.5 py-2.5 text-[#1F2937] hover:bg-black/[0.04] focus-visible:bg-black/[0.06] focus-visible:outline-none transition text-left"
            >
              {copied ? <Check size={15} className="text-emerald-500" /> : <Link2 size={15} className={copyFailed ? "text-[#991B1B]" : "text-[#6B7280]"} />}
              {copied ? strings.linkCopied : copyFailed ? t.profilePage.copyFailed : strings.copyLink}
            </button>
            <button
              role="menuitem"
              onClick={() => {
                setOpen(false);
                setShowQr(true);
              }}
              className="w-full min-h-[44px] flex items-center gap-2.5 px-3.5 py-2.5 text-[#1F2937] hover:bg-black/[0.04] focus-visible:bg-black/[0.06] focus-visible:outline-none transition text-left"
            >
              <QrCode size={15} className="text-[#6B7280]" />
              {strings.showQrCode}
            </button>
            <a
              role="menuitem"
              href={`https://wa.me/?text=${encodeURIComponent(`${title} — ${getUrl()}`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full min-h-[44px] flex items-center gap-2.5 px-3.5 py-2.5 text-[#1F2937] hover:bg-black/[0.04] focus-visible:bg-black/[0.06] focus-visible:outline-none transition"
            >
              <FaWhatsapp size={15} color="#25D366" />
              {strings.shareWhatsapp}
            </a>
            <a
              role="menuitem"
              href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(getUrl())}`}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full min-h-[44px] flex items-center gap-2.5 px-3.5 py-2.5 text-[#1F2937] hover:bg-black/[0.04] focus-visible:bg-black/[0.06] focus-visible:outline-none transition"
            >
              <FaFacebook size={15} color="#1877F2" />
              {strings.shareFacebook}
            </a>
            <a
              role="menuitem"
              href={`https://twitter.com/intent/tweet?url=${encodeURIComponent(getUrl())}&text=${encodeURIComponent(title)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full min-h-[44px] flex items-center gap-2.5 px-3.5 py-2.5 text-[#1F2937] hover:bg-black/[0.04] focus-visible:bg-black/[0.06] focus-visible:outline-none transition"
            >
              <FaXTwitter size={15} color="#000000" />
              {strings.shareX}
            </a>
            {canNativeShare && (
              <button
                role="menuitem"
                onClick={nativeShare}
                className="w-full min-h-[44px] flex items-center gap-2.5 px-3.5 py-2.5 text-[#1F2937] hover:bg-black/[0.04] focus-visible:bg-black/[0.06] focus-visible:outline-none transition text-left border-t border-black/5"
              >
                <Share2 size={15} className="text-[#6B7280]" />
                {strings.moreOptions}
              </button>
            )}
            </m.div>
          </>
        )}
      </AnimatePresence>

      {/* Announces the copy result to screen readers (the menu item's own text changes silently). */}
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? strings.linkCopied : copyFailed ? t.profilePage.copyFailed : ""}
      </span>

      {showQr && (
        <QrDialogShell label={strings.qrCodeTitle(title)} onClose={closeQr}>
            <button
              type="button"
              onClick={closeQr}
              aria-label={strings.close}
              className="absolute right-2 top-2 w-11 h-11 rounded-full flex items-center justify-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
              style={{ backgroundColor: "#F3F4F6", color: "#14202B" }}
            >
              <X size={15} />
            </button>

            <p className="font-display text-base font-bold pr-10">{strings.qrCodeTitle(title)}</p>
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

            <p className="mt-3 w-full break-all text-xs font-medium select-all" style={{ opacity: 0.7 }} dir="ltr">
              {getUrl().replace(/^https?:\/\//, "")}
            </p>

            <button
              onClick={downloadQr}
              disabled={qrStatus !== "ready"}
              className="w-full mt-4 flex items-center justify-center gap-2 py-3 min-h-[44px] rounded-full text-sm font-semibold text-white disabled:opacity-60"
              style={{ backgroundColor: accent }}
            >
              <Download size={15} />
              {strings.downloadQrCode}
            </button>
        </QrDialogShell>
      )}
    </div>
    </MotionScope>
  );
}
