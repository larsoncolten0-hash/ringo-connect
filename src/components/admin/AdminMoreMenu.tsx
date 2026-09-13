"use client";

import { useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { Menu, X, type LucideIcon } from "lucide-react";
import MenuBackdrop from "@/components/ui/MenuBackdrop";
import CountBadge from "@/components/admin/CountBadge";

// The admin mobile header's "More" hamburger — same pattern as the
// creator dashboard's MobileMoreMenu (hamburger toggles the Menu/X icon,
// a top-anchored panel fades/slides down, a blurred backdrop over the
// body only), but a dedicated dark-themed component rather than a reuse
// of that one: AdminShell's chrome is deliberately NOT theme-toggle-aware
// (see its own comment — it stays the same dark "control panel"
// regardless of the admin's light/dark preference), and MobileMoreMenu's
// panel is hardcoded to the light dashboard palette, which would look
// visibly wrong dropped into this dark header.
export default function AdminMoreMenu({
  items,
  isActive,
}: {
  items: { href: string; label: string; icon: LucideIcon; exact?: boolean; count?: number }[];
  isActive: (href: string, exact?: boolean) => boolean;
}) {
  const [open, setOpen] = useState(false);

  if (items.length === 0) return null;

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="More"
        aria-expanded={open}
        className="lg:hidden shrink-0 w-9 h-9 flex items-center justify-center rounded-full text-white/70 hover:bg-white/10 transition-colors"
      >
        {open ? <X size={19} /> : <Menu size={19} />}
      </button>

      <AnimatePresence>
        {open && (
          <>
            {/* top-[60px] matches this header's actual rendered height
                (py-3 + a 36px icon row) — see AdminShell.tsx's mobile top
                bar markup. */}
            <MenuBackdrop key="backdrop" onClose={() => setOpen(false)} className="z-20" topClassName="top-[60px]" portal />
            <motion.div
              key="panel"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.16 }}
              className="lg:hidden absolute top-full inset-x-0 z-40 max-h-[calc(100vh-60px)] overflow-y-auto bg-[#0B1023] border-b border-white/10 shadow-[0_20px_40px_-16px_rgba(0,0,0,0.5)]"
            >
              <nav className="flex flex-col px-4 py-2" aria-label="More">
                {items.map(({ href, label, icon: Icon, exact, count }) => {
                  const active = isActive(href, exact);
                  return (
                    <Link
                      key={href}
                      href={href}
                      onClick={() => setOpen(false)}
                      className={`flex items-center gap-3 py-3 text-sm font-medium border-b border-white/10 last:border-0 transition-colors ${
                        active ? "text-white" : "text-white/60"
                      }`}
                    >
                      <Icon size={17} strokeWidth={active ? 2.3 : 2} />
                      <span className="flex-1">{label}</span>
                      <CountBadge count={count} />
                    </Link>
                  );
                })}
              </nav>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
