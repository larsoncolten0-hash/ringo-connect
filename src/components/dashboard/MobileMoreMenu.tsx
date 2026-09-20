"use client";

import { useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { Menu, X, Check, Loader2, ChevronsUpDown, ChevronRight, type LucideIcon } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import MenuBackdrop from "@/components/ui/MenuBackdrop";
import { useOrgSwitch } from "@/lib/team/useOrgSwitch";
import { orgDisplayName, orgDisplaySubtitle, type OrgOption } from "@/lib/team/orgDisplay";

// The mobile header's "More" hamburger — holds every dashboard nav item
// that isn't one of the bottom tab bar's 5 core ones (see DashboardShell's
// NAV_ITEMS/moreMenuItems). Desktop never renders this: the sidebar always
// shows the full list, since it has the room the mobile tab bar doesn't.
//
// Opens the same way the landing page's mobile nav does (see
// LandingView.tsx's mobileMenuOpen) — the toggle button itself swaps
// between the Menu/X icon (no separate close button), and the panel is a
// plain top-anchored dropdown that fades/slides down from the header. A
// softly blurred backdrop (MenuBackdrop) sits behind it, over the body
// only — not the header this hamburger lives in — and doubles as the
// "tap outside to close" target, since the panel itself has no document
// click-outside listener of its own.
// How many of a section's own pages the menu previews before "See more".
const PREVIEW_COUNT = 2;

export default function MobileMoreMenu({
  items,
  label,
  isActive,
  organizations = [],
  currentOrgId,
}: {
  // `children` = the section's own pages: the first PREVIEW_COUNT show under
  // it in the menu, with a "See more" link to the section itself when there
  // are more than that.
  items: { href: string; label: string; icon: LucideIcon; exact?: boolean; children?: { href: string; label: string; icon: LucideIcon }[] }[];
  label: string;
  isActive: (href: string, exact?: boolean) => boolean;
  // The mobile equivalent of the desktop sidebar's OrgSwitcher — only
  // rendered (as a "Workspace" section at the top of this same panel)
  // when there's more than one to choose from. Reuses the exact same
  // switching logic (useOrgSwitch) and labeling rules (orgDisplay) as the
  // desktop version rather than a second mobile-only organization system.
  organizations?: OrgOption[];
  currentOrgId?: string;
}) {
  const [open, setOpen] = useState(false);
  const { t } = useLanguage();
  const { switchTo, switchingTo } = useOrgSwitch();
  const showSwitcher = organizations.length > 1 && !!currentOrgId;

  // Nothing to show (e.g. a plan/role with no gated items and no
  // switcher) — no point rendering a hamburger that opens onto an empty
  // panel.
  if (items.length === 0 && !showSwitcher) return null;

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
          <>
            <MenuBackdrop key="backdrop" onClose={() => setOpen(false)} className="z-20" topClassName="top-16" portal />
            <motion.div
              key="panel"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.16 }}
              className="lg:hidden absolute top-full inset-x-0 z-40 max-h-[calc(100vh-4rem)] overflow-y-auto bg-ringo-bg border-b border-ringo-border shadow-[0_20px_40px_-16px_rgba(15,23,42,0.2)]"
            >
              {showSwitcher && (
                <div className="px-5 pt-3 pb-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-ringo-muted/70 mb-1.5">Workspace</p>
                  <div className="flex flex-col gap-1 mb-1">
                    {organizations.map((org) => {
                      const active = org.profileId === currentOrgId;
                      const busy = switchingTo === org.profileId;
                      return (
                        <button
                          key={org.profileId}
                          onClick={() => {
                            if (!active) switchTo(org.profileId, currentOrgId!);
                          }}
                          disabled={busy}
                          className={`flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left transition ${
                            active ? "bg-ringo-indigo/10" : "hover:bg-ringo-muted/10"
                          }`}
                        >
                          <span className="min-w-0">
                            <span className={`block text-sm font-medium truncate ${active ? "text-ringo-indigo" : "text-ringo-text"}`}>{orgDisplayName(org)}</span>
                            <span className="block text-[11px] text-ringo-muted truncate">{orgDisplaySubtitle(org)}</span>
                          </span>
                          {busy ? (
                            <Loader2 size={14} className="animate-spin text-ringo-muted shrink-0" />
                          ) : active ? (
                            <Check size={14} className="text-ringo-indigo shrink-0" />
                          ) : (
                            <ChevronsUpDown size={13} className="text-ringo-muted/50 shrink-0" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                  {items.length > 0 && <div className="h-px bg-ringo-border/60 mt-1" />}
                </div>
              )}
              <nav className="flex flex-col px-5 py-3" aria-label={label}>
              {items.map(({ href, label: itemLabel, icon: Icon, exact, children }) => {
                const active = isActive(href, exact);
                const preview = (children || []).slice(0, PREVIEW_COUNT);
                const hasMore = (children || []).length > PREVIEW_COUNT;
                return (
                  <div key={href} className="border-b border-ringo-border/60 last:border-0">
                    <Link
                      href={href}
                      onClick={() => setOpen(false)}
                      className={`flex items-center gap-3 py-3 text-sm font-medium transition-colors ${
                        active ? "text-ringo-indigo" : "text-ringo-text"
                      }`}
                    >
                      <Icon size={17} strokeWidth={active ? 2.3 : 2} />
                      {itemLabel}
                    </Link>
                    {preview.length > 0 && (
                      <div className="flex flex-col pb-2 pl-[29px]">
                        {preview.map(({ href: childHref, label: childLabel, icon: ChildIcon }) => (
                          <Link
                            key={childHref}
                            href={childHref}
                            onClick={() => setOpen(false)}
                            className={`flex items-center gap-2.5 py-1.5 text-[13px] transition-colors ${
                              isActive(childHref) ? "text-ringo-indigo font-medium" : "text-ringo-muted hover:text-ringo-text"
                            }`}
                          >
                            <ChildIcon size={14} />
                            {childLabel}
                          </Link>
                        ))}
                        {hasMore && (
                          <Link
                            href={href}
                            onClick={() => setOpen(false)}
                            className="flex items-center gap-1 py-1.5 text-xs font-semibold text-ringo-indigo"
                          >
                            {t.nav.seeMore}
                            <ChevronRight size={13} />
                          </Link>
                        )}
                      </div>
                    )}
                  </div>
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
