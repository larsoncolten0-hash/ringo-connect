"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";

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

// Shared sub-navigation for a dashboard section (Music, Restaurant, Community, Bookings, Shop, Reports, Documents, Customers, ...).
// Every page of the section is ALWAYS visible, on every screen size: nothing is tucked behind a small arrow or a collapsed menu that a
// first-time owner has to discover. On desktop it is the familiar horizontal tab strip. On a phone the same pages are laid out as a
// grid of large, labelled tabs (two per row, so a name is never cut off), with the current page filled and announced as such
// (aria-current), so the owner always sees where they are and what else this section holds.
export default function SectionTabs({ tabs, isActive }: { tabs: SectionTab[]; isActive?: (href: string, exact?: boolean) => boolean }) {
  const { t } = useLanguage();
  const isTabActive = (tab: SectionTab) => tab.active ?? (tab.href && isActive ? isActive(tab.href, tab.exact) : false);
  if (tabs.length === 0) return null;
  const desktopClass = (active: boolean) =>
    `flex items-center gap-1.5 px-3.5 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/50 rounded-t-lg ${
      active ? "border-ringo-indigo text-ringo-indigo" : "border-transparent text-ringo-muted hover:text-ringo-text"
    }`;
  const mobileClass = (active: boolean) =>
    `flex min-h-[44px] w-full items-center gap-2 rounded-xl border px-3 py-2 text-sm leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/50 ${
      active ? "border-ringo-indigo/50 bg-ringo-indigo/10 font-semibold text-ringo-indigo" : "border-ringo-border text-ringo-text hover:bg-ringo-muted/10"
    }`;
  // an odd last tab takes the whole row, so the grid never leaves a lone half-width gap
  const spanLast = tabs.length > 2 && tabs.length % 2 === 1;

  return (
    <nav aria-label={t.nav.sectionPages}>
      {/* Desktop / tablet: horizontal tabs. */}
      <div className="hidden sm:flex gap-1 overflow-x-auto no-scrollbar border-b border-ringo-border pb-0.5">
        {tabs.map((tab) => {
          const active = isTabActive(tab);
          const inner = (
            <>
              {tab.icon && <tab.icon size={15} aria-hidden="true" />}
              {tab.label}
            </>
          );
          return tab.href ? (
            <Link key={tab.href} href={tab.href} aria-current={active ? "page" : undefined} className={desktopClass(active)}>
              {inner}
            </Link>
          ) : (
            <button key={tab.label} type="button" onClick={tab.onSelect} aria-current={active ? "true" : undefined} className={desktopClass(active)}>
              {inner}
            </button>
          );
        })}
      </div>

      {/* Phone: every page visible as a labelled tab; no hidden menu. */}
      <ul className={`sm:hidden grid gap-2 ${tabs.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
        {tabs.map((tab, i) => {
          const active = isTabActive(tab);
          const inner = (
            <>
              {tab.icon && <tab.icon size={16} aria-hidden="true" className="shrink-0" />}
              <span className="min-w-0 flex-1 break-words text-left">{tab.label}</span>
            </>
          );
          return (
            <li key={tab.href ?? tab.label} className={spanLast && i === tabs.length - 1 ? "col-span-2" : undefined}>
              {tab.href ? (
                <Link href={tab.href} aria-current={active ? "page" : undefined} className={mobileClass(active)}>
                  {inner}
                </Link>
              ) : (
                <button type="button" onClick={tab.onSelect} aria-current={active ? "true" : undefined} className={mobileClass(active)}>
                  {inner}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
