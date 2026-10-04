"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import MenuBackdrop from "@/components/ui/MenuBackdrop";

export type NavDropdownItem = {
  icon: any;
  title: string;
  description: string;
  href: string;
};

// Click-to-open (not hover-only — hover-only menus are a common
// accessibility/mobile-usability miss), closes on an outside click or Escape.
export default function NavDropdown({ label, items, columns = 2 }: { label: string; items: NavDropdownItem[]; columns?: 1 | 2 }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1 min-h-[44px] text-sm text-ringo-muted hover:text-ringo-text transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ringo-text"
      >
        {label}
        <ChevronDown size={14} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      <AnimatePresence>
        {open && (
          <>
            <MenuBackdrop key="backdrop" onClose={() => setOpen(false)} className="z-20" topClassName="top-16" portal />
            <motion.div
              key="panel"
              initial={reduceMotion ? { opacity: 1 } : { opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
              transition={{ duration: 0.16 }}
              className="absolute left-1/2 -translate-x-1/2 top-full mt-3 z-50 w-[380px] sm:w-[440px] rounded-ringo-md border border-ringo-line-warm bg-ringo-surface shadow-ringo-3 p-2.5"
            >
            <div className={`grid gap-1 ${columns === 2 ? "sm:grid-cols-2" : "grid-cols-1"}`}>
              {items.map((item) => (
                <Link
                  key={item.title}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="flex items-start gap-3 rounded-ringo-sm p-3 transition-colors hover:bg-ringo-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-ringo-text"
                >
                  <span className="w-9 h-9 rounded-ringo-sm flex items-center justify-center shrink-0 bg-ringo-gold/15 text-ringo-gold-text">
                    <item.icon size={16} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-ringo-text">{item.title}</span>
                    <span className="block text-xs text-ringo-muted leading-snug mt-0.5">{item.description}</span>
                  </span>
                </Link>
              ))}
            </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
