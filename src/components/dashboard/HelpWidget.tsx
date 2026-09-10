"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { LifeBuoy, X, Mail } from "lucide-react";
import { FaWhatsapp } from "react-icons/fa6";
import { useLanguage } from "@/components/LanguageProvider";

// Ringo Connect's own support line and inbox — not tied to any creator's
// profile data, so this is the one place those two contacts are allowed
// to be hardcoded. Update here if either ever changes.
const SUPPORT_WHATSAPP = "237694028846";
const SUPPORT_EMAIL = "info@ringoconnectltd.com";

// A floating help affordance on every dashboard page — for a creator stuck
// on something, a much shorter path to a real person than digging for a
// contact page. Doesn't touch any Ringo Connect data itself: it just
// hands off to WhatsApp or the creator's own email app with the message
// already filled in, so nothing here needs a backend or a database change.
export default function HelpWidget({ username, email }: { username: string; email: string }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [showError, setShowError] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const body = `Ringo Connect account: @${username} (${email})\n\n${message.trim()}`;
  const waHref = `https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(body)}`;
  const mailHref = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
    `Ringo Connect support — @${username}`
  )}&body=${encodeURIComponent(body)}`;

  const guard = (e: React.MouseEvent) => {
    if (!message.trim()) {
      e.preventDefault();
      setShowError(true);
    }
  };

  return (
    <div className="fixed bottom-36 right-4 lg:bottom-6 lg:right-6 z-40" ref={panelRef}>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-14 right-0 w-[calc(100vw-2rem)] max-w-[320px] rounded-2xl border border-ringo-border/70 bg-ringo-surface shadow-[0_20px_48px_-16px_rgba(15,23,42,0.35)] p-4 flex flex-col gap-3"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-ringo-text">{t.help.title}</p>
                <p className="text-xs text-ringo-muted mt-0.5">{t.help.subtitle}</p>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-ringo-muted hover:bg-ringo-muted/10 transition"
              >
                <X size={13} />
              </button>
            </div>

            <textarea
              value={message}
              onChange={(e) => {
                setMessage(e.target.value);
                if (e.target.value.trim()) setShowError(false);
              }}
              placeholder={t.help.placeholder}
              rows={3}
              className="w-full text-sm border border-ringo-border rounded-card px-3 py-2 bg-ringo-bg text-ringo-text resize-none"
            />
            {showError && <p className="text-xs text-ringo-coral -mt-1.5">{t.help.emptyError}</p>}

            <div className="flex flex-col gap-2">
              <a
                href={waHref}
                target="_blank"
                rel="noopener noreferrer"
                onClick={guard}
                className="flex items-center justify-center gap-2 text-sm font-semibold text-white bg-[#25D366] px-4 py-2.5 rounded-card transition hover:brightness-105 active:scale-[0.98]"
              >
                <FaWhatsapp size={16} />
                {t.help.whatsapp}
              </a>
              <a
                href={mailHref}
                onClick={guard}
                className="flex items-center justify-center gap-2 text-sm font-semibold text-ringo-text border border-ringo-border px-4 py-2.5 rounded-card transition hover:bg-ringo-muted/10 active:scale-[0.98]"
              >
                <Mail size={15} />
                {t.help.email}
              </a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={t.help.button}
        aria-expanded={open}
        className="w-12 h-12 rounded-full bg-ringo-indigo text-white flex items-center justify-center shadow-[0_10px_28px_-8px_rgba(79,70,229,0.55)] transition hover:-translate-y-0.5 active:scale-95"
      >
        {open ? <X size={19} /> : <LifeBuoy size={19} />}
      </button>
    </div>
  );
}
