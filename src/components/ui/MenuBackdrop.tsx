"use client";

import { motion } from "framer-motion";

// A subtle dim + blur layer shown behind an open menu/dropdown/panel —
// makes whatever's open read as clearly in focus against a softened
// background, and doubles as the "click outside to close" target: it
// covers the full viewport at a lower z-index than the menu content
// itself, so a tap/click anywhere outside the menu lands here and calls
// `onClose`, while clicks inside the menu (which sits visually on top)
// never reach it. Every menu still owns its own open/closed state — this
// is purely the shared visual + outside-click chrome around it. Render
// it as a sibling placed right before the menu content, both inside the
// same AnimatePresence block, so they fade in/out together.
export default function MenuBackdrop({
  onClose,
  className = "z-40",
}: {
  onClose: () => void;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      onClick={onClose}
      aria-hidden="true"
      className={`fixed inset-0 bg-slate-950/30 backdrop-blur-sm ${className}`}
    />
  );
}
