"use client";

import { createPortal } from "react-dom";
import { motion } from "framer-motion";

// A dimmed + blurred layer shown behind an open menu/dropdown/panel —
// darkens and softly blurs the body content so the open menu reads as
// clearly in focus, and doubles as the "click outside to close" target:
// it covers the body area at a lower z-index than the menu content
// itself, so a tap/click anywhere outside the menu lands here and calls
// `onClose`, while clicks inside the menu (which sits visually on top)
// never reach it.
//
// `topClassName` keeps it off the page's own header bar — a menu that
// opens from inside a sticky/fixed header (the mobile hamburger, the
// avatar/notification dropdowns, the landing nav) should darken/blur the
// body content below, never the header it's anchored in, so those
// callers pass "top-16" (this app's one consistent 64px header height,
// both in DashboardShell and LandingView). Defaults to "top-0" — full
// coverage — for callers with no header to protect (e.g. ShareButton
// floating over a profile's hero image).
//
// `portal`: renders into document.body instead of in place. Required
// for any menu anchored inside an element that itself has
// backdrop-filter/backdrop-blur (both dashboard and landing headers do,
// for their own glass effect) — CSS makes such an element the containing
// block for `position: fixed` descendants, so a same-place `top-16`
// backdrop would be sized against the ~64px header box instead of the
// viewport and collapse to nothing. Portaling escapes that entirely, so
// it's always sized against the real viewport regardless of where in the
// tree it's rendered from.
export default function MenuBackdrop({
  onClose,
  className = "z-20",
  topClassName = "top-0",
  portal = false,
}: {
  onClose: () => void;
  className?: string;
  topClassName?: string;
  portal?: boolean;
}) {
  const node = (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      onClick={onClose}
      aria-hidden="true"
      className={`fixed inset-x-0 bottom-0 ${topClassName} bg-slate-950/35 backdrop-blur-sm ${className}`}
    />
  );

  return portal ? createPortal(node, document.body) : node;
}
