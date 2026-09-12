"use client";

import { useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { Menu, X, type LucideIcon } from "lucide-react";

// The mobile header's "More" hamburger — holds every dashboard nav item
// that isn't one of the bottom tab bar's 5 core ones (see DashboardShell's
// NAV_ITEMS/moreMenuItems). Desktop never renders this: the sidebar always
// shows the full list, since it has the room the mobile tab bar doesn't.
//
// Opens the same way the landing page's mobile nav does (see
// LandingView.tsx's mobileMenuOpen) — the toggle button itself swaps
// between the Menu/X icon (no separate close button), and the panel is a
// plain top-anchored dropdown that fades/slides down from the header,
// rather than a bottom sheet with its own backdrop.
export default function MobileMoreMenu({
  items,
  label,
  isActive,
}: {
  items: { href: string; label: string; icon: LucideIcon; exact?: boolean }[];
  label: string;
  isActive: (href: string, exact?: boolean) => boolean;
}) {
  const [open, setOpen] = useState(false);

  // Nothing to show (e.g. a plan/role with no gated items at all) — no
  // point rendering a hamburger that opens onto an empty panel.
  if (items.length === 0) return null;

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={label}
        aria-expanded={open}
        className="lg:hidden shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-ringo-text hover:bg-ringo-muted/10 transition-colors"
      >
        {open ? <X size={20} /> : <Menu size={20} />}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.16 }}
            className="lg:hidden absolute top-full inset-x-0 z-40 max-h-[calc(100vh-4rem)] overflow-y-auto bg-ringo-bg border-b border-ringo-border shadow-[0_20px_40px_-16px_rgba(15,23,42,0.2)]"
          >
            <nav className="flex flex-col px-5 py-3" aria-label={label}>
              {items.map(({ href, label: itemLabel, icon: Icon, exact }) => {
                const active = isActive(href, exact);
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setOpen(false)}
                    className={`flex items-center gap-3 py-3 text-sm font-medium border-b border-ringo-border/60 last:border-0 transition-colors ${
                      active ? "text-ringo-indigo" : "text-ringo-text"
                    }`}
                  >
                    <Icon size={17} strokeWidth={active ? 2.3 : 2} />
                    {itemLabel}
                  </Link>
                );
              })}
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
