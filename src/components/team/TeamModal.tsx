"use client";

import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { X } from "lucide-react";

// Shared modal shell for the Team section — same shape as
// VerificationRequestModal (portal to document.body, dimmed/blurred
// backdrop, spring-in sheet that's bottom-anchored on mobile and centered
// on desktop) so Team's modals feel identical to the rest of the
// dashboard rather than inventing a second modal style.
export default function TeamModal({
  title,
  subtitle,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm"
        aria-hidden="true"
      />
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 24 }}
        transition={{ type: "spring", stiffness: 420, damping: 38 }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative w-full ${wide ? "sm:max-w-lg" : "sm:max-w-sm"} rounded-t-3xl sm:rounded-3xl bg-ringo-surface p-5 sm:p-6 flex flex-col gap-4 max-h-[88vh] overflow-y-auto`}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 w-8 h-8 rounded-full flex items-center justify-center text-ringo-muted hover:bg-ringo-muted/10 transition"
        >
          <X size={15} />
        </button>

        <div>
          <h2 className="font-display text-lg font-semibold text-ringo-text pr-8">{title}</h2>
          {subtitle && <p className="text-sm text-ringo-muted mt-1 leading-relaxed">{subtitle}</p>}
        </div>

        {children}
      </motion.div>
    </div>,
    document.body
  );
}
