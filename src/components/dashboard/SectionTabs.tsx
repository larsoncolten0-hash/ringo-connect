"use client";

import { useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, ChevronRight, type LucideIcon } from "lucide-react";

// A tab is either a link to its own page (`href`) or, for views that swap
// content in place without navigating, a button (`onSelect` + `active`).
export type SectionTab = {
  href?: string;
  label: string;
  icon?: LucideIcon;
  exact?: boolean;
  active?: boolean;
  onSelect?: () => void;
};

// Shared sub-navigation for a dashboard section (Music, Restaurant,
// Community, Bookings). On desktop it stays the familiar horizontal tab
// strip. On mobile a row of 5-6 tabs doesn't fit, so instead of a sideways
// scroller (where the last tabs are easy to miss) it collapses into a
// button showing the current page; tapping it opens every page stacked
// top-to-bottom, each row with a right-pointing arrow, so nothing is hidden
// off-screen and no scrolling is needed to discover it.
export default function SectionTabs({ tabs, isActive }: { tabs: SectionTab[]; isActive?: (href: string, exact?: boolean) => boolean }) {
  const [open, setOpen] = useState(false);
  const isTabActive = (tab: SectionTab) => tab.active ?? (tab.href && isActive ? isActive(tab.href, tab.exact) : false);
  const current = tabs.find(isTabActive) ?? tabs[0];
  if (!current) return null;
  const desktopClass = (active: boolean) =>
    `flex items-center gap-1.5 px-3.5 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${
      active ? "border-ringo-indigo text-ringo-indigo" : "border-transparent text-ringo-muted hover:text-ringo-text"
    }`;
  const mobileClass = (active: boolean) =>
    `w-full flex items-center gap-3 px-3.5 py-3 text-sm font-medium border-b border-ringo-border/60 last:border-0 transition-colors ${
      active ? "bg-ringo-indigo/10 text-ringo-indigo" : "text-ringo-text hover:bg-ringo-muted/10"
    }`;

  return (
    <>
      {/* Desktop / tablet — unchanged horizontal tabs. */}
      <div className="hidden sm:flex gap-1 overflow-x-auto no-scrollbar border-b border-ringo-border pb-0.5">
        {tabs.map((tab) => {
          const active = isTabActive(tab);
          const inner = (
            <>
              {tab.icon && <tab.icon size={15} />}
              {tab.label}
            </>
          );
          return tab.href ? (
            <Link key={tab.href} href={tab.href} className={desktopClass(active)}>
              {inner}
            </Link>
          ) : (
            <button key={tab.label} onClick={tab.onSelect} className={desktopClass(active)}>
              {inner}
            </button>
          );
        })}
      </div>

      {/* Mobile — collapsible vertical list. */}
      <div className="sm:hidden rounded-xl border border-ringo-border bg-ringo-surface/60 overflow-hidden">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="w-full flex items-center gap-2.5 px-3.5 py-3 text-sm font-semibold text-ringo-indigo"
        >
          {current.icon && <current.icon size={16} />}
          <span className="flex-1 text-left truncate">{current.label}</span>
          <ChevronDown size={16} className={`text-ringo-muted transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
        </button>
        <AnimatePresence initial={false}>
          {open && (
            <motion.nav
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.16 }}
              className="flex flex-col border-t border-ringo-border/60 overflow-hidden"
            >
              {tabs.map((tab) => {
                const active = isTabActive(tab);
                const inner = (
                  <>
                    {tab.icon && <tab.icon size={16} />}
                    <span className="flex-1 truncate text-left">{tab.label}</span>
                    <ChevronRight size={16} className={active ? "text-ringo-indigo" : "text-ringo-muted/60"} />
                  </>
                );
                return tab.href ? (
                  <Link key={tab.href} href={tab.href} onClick={() => setOpen(false)} className={mobileClass(active)}>
                    {inner}
                  </Link>
                ) : (
                  <button
                    key={tab.label}
                    onClick={() => {
                      tab.onSelect?.();
                      setOpen(false);
                    }}
                    className={mobileClass(active)}
                  >
                    {inner}
                  </button>
                );
              })}
            </motion.nav>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}
