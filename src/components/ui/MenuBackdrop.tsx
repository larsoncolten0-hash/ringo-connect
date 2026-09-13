"use client";

import { motion } from "framer-motion";

// A soft blur layer shown behind an open menu/dropdown/panel — no dark
// tint, just backdrop-blur, so it reads as "focus," not "dimmed." Also
// doubles as the "click outside to close" target: it covers the body
// area at a lower z-index than the menu content itself, so a tap/click
// anywhere outside the menu lands here and calls `onClose`, while clicks
// inside the menu (which sits visually on top) never reach it. Every
// menu still owns its own open/closed state — this is purely the shared
// visual + outside-click chrome around it. Render it as a sibling placed
// right before the menu content, both inside the same AnimatePresence
// block, so they fade in/out together.
//
// `topClassName` keeps it off the page's own header bar — a menu that
// opens from inside a sticky/fixed header (the mobile hamburger, the
// avatar/notification dropdowns, the landing nav) should blur the body
// content below, never the header it's anchored in, so those callers
// pass "top-16" (this app's one consistent 64px header height, both in
// DashboardShell and LandingView). Defaults to "top-0" — full coverage —
// for callers with no header to protect (e.g. ShareButton floating over
// a profile's hero image).
export default function MenuBackdrop({
  onClose,
  className = "z-40",
  topClassName = "top-0",
}: {
  onClose: () => void;
  className?: string;
  topClassName?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      onClick={onClose}
      aria-hidden="true"
      className={`fixed inset-x-0 bottom-0 ${topClassName} backdrop-blur-sm ${className}`}
    />
  );
}
