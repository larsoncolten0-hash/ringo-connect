"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { LayoutGrid, BarChart3, CreditCard, Handshake, ClipboardCheck, QrCode, UtensilsCrossed, Music2, CalendarCheck, Users, ExternalLink, Ticket, Nfc } from "lucide-react";
import ThemeToggle from "@/components/ThemeToggle";
import LanguageToggle from "@/components/LanguageToggle";
import NotificationBell from "@/components/NotificationBell";
import AvatarMenu from "@/components/dashboard/AvatarMenu";
import HelpWidget from "@/components/dashboard/HelpWidget";
import MobileMoreMenu from "@/components/dashboard/MobileMoreMenu";
import RegisterServiceWorker from "@/components/RegisterServiceWorker";
import { useLanguage } from "@/components/LanguageProvider";

export default function DashboardShell({
  email,
  username,
  avatarUrl,
  planName,
  isFreePlan,
  canApproveRequests = false,
  isRestaurant = false,
  isMusic = false,
  hasTicketing = false,
  children,
}: {
  email: string;
  username: string;
  avatarUrl?: string | null;
  planName: string;
  isFreePlan: boolean;
  // "Super creator" permission — an admin-granted, narrower-than-admin
  // ability to review signup requests. See src/lib/assertAdmin.ts
  // (assertCanApproveRequests) and src/app/dashboard/requests/.
  canApproveRequests?: boolean;
  // One nav entry, not five — Orders/Kitchen/Tables/Sales/Customers live
  // behind it as tabs in /dashboard/restaurant's own layout, so the global
  // nav (and the space-constrained mobile tab bar) doesn't have to grow a
  // whole category's worth of pages for every restaurant owner.
  isRestaurant?: boolean;
  // Same pattern as isRestaurant — Orders/Sales/Customers live behind this
  // one entry as tabs in /dashboard/music's own layout.
  isMusic?: boolean;
  // Music & Entertainment or Events & Experiences (see
  // profileHasTicketing) — its own top-level section, same reasoning as
  // Bookings' own button: events, ticket types, Gate Access, and Check-in
  // all live at /dashboard/tickets/*, not tucked inside the main editor.
  hasTicketing?: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { t } = useLanguage();

  // `core: true` marks the small set of items the mobile bottom tab bar
  // actually shows (Editor, Community, Ringo Card, Analytics,
  // Subscription) — kept deliberately short so the space-constrained tab
  // bar never has to scroll. Everything else defaults to living in the
  // mobile header's "More" hamburger menu (see MobileMoreMenu.tsx) instead
  // — including any category-specific item added here in the future — so
  // a new nav entry never has to also update the tab bar's item count.
  // The desktop sidebar is unaffected by this split: it always renders
  // every item below, core or not, since it has the room for it.
  const NAV_ITEMS = [
    { href: "/dashboard", label: t.nav.editor, icon: LayoutGrid, exact: true, core: true },
    ...(isRestaurant ? [{ href: "/dashboard/restaurant", label: t.nav.restaurant, icon: UtensilsCrossed, core: false }] : []),
    ...(isMusic ? [{ href: "/dashboard/music", label: t.nav.music, icon: Music2, core: false }] : []),
    // Its own section, not nested inside Music's editor — Events &
    // Experiences profiles get this without needing Music's other tools.
    ...(hasTicketing ? [{ href: "/dashboard/tickets", label: t.nav.tickets, icon: Ticket, core: false }] : []),
    // Universal, unlike Restaurant/Music above — every category can turn
    // bookings on, so this is never gated by category. Always visible (not
    // hidden until enabled) so an owner can actually find Settings to turn
    // it on in the first place.
    { href: "/dashboard/bookings", label: t.nav.bookings, icon: CalendarCheck, core: false },
    // Same "always visible" reasoning as Bookings above — every category
    // can build a community, so this isn't gated either.
    { href: "/dashboard/community", label: t.nav.community, icon: Users, core: true },
    // Ringo Card Writer — every creator can own a physical Ringo Card
    // regardless of category, so (like Bookings/Community) this is never
    // gated. See src/app/dashboard/ringo-card/page.tsx.
    { href: "/dashboard/ringo-card", label: t.nav.ringoCard, icon: Nfc, core: true },
    { href: "/dashboard/analytics", label: t.nav.analytics, icon: BarChart3, core: true },
    { href: "/dashboard/affiliate", label: t.nav.affiliate, icon: Handshake, core: false },
    { href: "/dashboard/subscription", label: t.nav.subscription, icon: CreditCard, core: true },
    ...(canApproveRequests
      ? [
          { href: "/dashboard/requests", label: t.nav.requests, icon: ClipboardCheck, core: false },
          { href: "/dashboard/qr-code", label: t.nav.qrCode, icon: QrCode, core: false },
        ]
      : []),
  ];

  const mobileTabItems = NAV_ITEMS.filter((item) => item.core);
  const moreMenuItems = NAV_ITEMS.filter((item) => !item.core);

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname.startsWith(href);

  const currentLabel = [...NAV_ITEMS].reverse().find(({ href, exact }) => isActive(href, exact))?.label;

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[264px_1fr]">
      {/* Registers the "Add to Home Screen" service worker for the whole
          dashboard — see RegisterServiceWorker.tsx and
          AddToHomeScreenMenuItem.tsx (surfaced from AvatarMenu below). */}
      <RegisterServiceWorker />

      {/* Desktop sidebar — the persistent nav. Every dashboard page renders
          inside this layout, so this never re-mounts between pages. */}
      <aside className="hidden lg:flex flex-col justify-between border-r border-ringo-border/70 bg-ringo-surface/40 p-5 h-screen sticky top-0">
        <div>
          <Link href="/" className="flex items-center gap-2.5 px-1">
            <Image src="/logo.png" alt="Ringo Connect" width={30} height={30} className="rounded-[9px] shadow-[0_2px_8px_-2px_rgba(79,70,229,0.4)]" />
            <span className="font-display font-semibold text-[15px] text-ringo-text tracking-[-0.01em]">Ringo Connect</span>
          </Link>
          {/* Signature: a quiet gradient line — same brand signal as the
              animated rings on the auth pages, at rest for a daily-use screen. */}
          <div className="h-[2px] w-full mt-4 mb-6 rounded-full bg-gradient-to-r from-ringo-indigo via-ringo-coral to-ringo-teal opacity-70" />

          <p className="px-3.5 mb-2 text-[10px] font-semibold uppercase tracking-wider text-ringo-muted/70">
            {t.nav.menu}
          </p>
          <nav className="flex flex-col gap-0.5">
            {NAV_ITEMS.map(({ href, label, icon: Icon, exact }) => {
              const active = isActive(href, exact);
              return (
                <Link
                  key={href}
                  href={href}
                  className={`group relative flex items-center gap-3 pl-3.5 pr-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 ${
                    active
                      ? "bg-ringo-indigo/10 text-ringo-indigo"
                      : "text-ringo-muted hover:bg-ringo-muted/10 hover:text-ringo-text hover:translate-x-0.5"
                  }`}
                >
                  {active && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[3px] rounded-full bg-ringo-indigo" />
                  )}
                  <Icon size={17} strokeWidth={active ? 2.3 : 2} />
                  {label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex flex-col gap-3">
          {isFreePlan && (
            <Link
              href="/dashboard/subscription"
              className="block rounded-2xl p-3.5 bg-gradient-to-br from-ringo-indigo to-ringo-indigo/85 text-white shadow-[0_8px_20px_-6px_rgba(79,70,229,0.45)] transition-transform hover:-translate-y-0.5"
            >
              <p className="text-xs font-medium opacity-80 mb-0.5">{t.sidebar.freeBadge}</p>
              <p className="text-sm font-medium mb-2.5 leading-snug">{t.sidebar.unlockFeatures}</p>
              <span className="text-xs font-medium underline underline-offset-2">{t.sidebar.upgradePlan}</span>
            </Link>
          )}

          {/* Compact identity card — quick "who am I" + a shortcut to the
              live page, without duplicating what AvatarMenu already does. */}
          <Link
            href={`/${username}`}
            target="_blank"
            className="flex items-center gap-2.5 rounded-xl border border-ringo-border/70 px-3 py-2.5 transition hover:bg-ringo-muted/10"
          >
            <span className="w-8 h-8 rounded-full overflow-hidden flex items-center justify-center bg-ringo-indigo text-white text-xs font-medium shrink-0">
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarUrl} alt={username} className="w-full h-full object-cover" />
              ) : (
                username?.[0]?.toUpperCase() || "?"
              )}
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-xs font-medium text-ringo-text truncate">@{username}</span>
              <span className="block text-[11px] text-ringo-muted truncate">{t.account.viewPage}</span>
            </span>
            <ExternalLink size={13} className="text-ringo-muted shrink-0" />
          </Link>
        </div>
      </aside>

      <div className="relative flex flex-col min-h-screen">
        {/* Quiet depth cue behind every page's content — a large, very low
            opacity brand-colored glow, fixed so it doesn't scroll or shift
            page to page. Never above 8% opacity: a signature, not a design
            element anyone should consciously notice. */}
        <div
          className="pointer-events-none fixed inset-x-0 top-0 h-[480px] -z-10 opacity-[0.06] dark:opacity-[0.1]"
          style={{ background: "radial-gradient(640px circle at 15% -10%, #4F46E5, transparent 65%)" }}
          aria-hidden
        />

        {/* Top header — page title on the left (desktop/tablet), account
            controls on the right, everywhere. */}
        <div className="flex items-center justify-between gap-2 px-4 lg:px-10 py-3.5 sticky top-0 z-30 bg-ringo-bg/85 backdrop-blur border-b border-ringo-border/70">
          <div className="flex items-center gap-2 min-w-0">
            {/* Hamburger menu — mobile only, holds every nav item that
                isn't one of the tab bar's 5 core ones (see moreMenuItems
                above). Sits before the logo, the conventional hamburger
                position. */}
            <MobileMoreMenu items={moreMenuItems} label={t.nav.more} isActive={isActive} />
            <Link href="/" className="flex items-center gap-2 lg:hidden shrink-0">
              <Image src="/logo.png" alt="Ringo Connect" width={26} height={26} className="rounded-lg" />
            </Link>
            {currentLabel && (
              <h1 className="hidden sm:block text-[15px] font-semibold text-ringo-text truncate">{currentLabel}</h1>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <LanguageToggle />
            <NotificationBell />
            <ThemeToggle iconOnly />
            <span className="w-px h-5 bg-ringo-border mx-1 hidden sm:block" />
            <AvatarMenu email={email} username={username} avatarUrl={avatarUrl} planName={planName} />
          </div>
        </div>

        <main className="flex-1 px-4 sm:px-6 lg:px-10 py-6 lg:py-8 pb-28 lg:pb-10">{children}</main>

        {/* Mobile bottom tab bar — replaces the sidebar on small screens.
            Built to read as a native app tab bar, not a shrunk sidebar:
            the active tab's pill background is one shared element (via
            framer-motion's layoutId) that slides between tabs instead of
            just toggling per-item, and every tab gets a spring-y press
            scale — the same "physical" feedback iOS/Android tab bars
            give on tap. Purely mobile (lg:hidden): desktop's sidebar
            above already has an always-visible active state and doesn't
            need this treatment. */}
        <nav
          className="lg:hidden fixed bottom-3 inset-x-3 z-40 bg-ringo-surface/95 backdrop-blur border border-ringo-border/70 rounded-2xl shadow-[0_12px_32px_-12px_rgba(15,23,42,0.25)] flex justify-around gap-0.5 py-1.5 px-1 overflow-x-auto no-scrollbar"
          style={{ marginBottom: "env(safe-area-inset-bottom)" }}
        >
          {mobileTabItems.map(({ href, label, icon: Icon, exact }) => {
            const active = isActive(href, exact);
            return (
              <Link key={href} href={href} className="relative shrink-0">
                <motion.span
                  whileTap={{ scale: 0.88 }}
                  transition={{ type: "spring", stiffness: 500, damping: 30 }}
                  className="relative flex flex-col items-center gap-0.5 px-3.5 py-1.5 rounded-xl text-[11px] font-medium"
                >
                  {active && (
                    <motion.span
                      layoutId="mobile-tab-active"
                      className="absolute inset-0 rounded-xl bg-ringo-indigo/10"
                      transition={{ type: "spring", stiffness: 500, damping: 35 }}
                    />
                  )}
                  <span className="relative flex flex-col items-center gap-0.5">
                    <Icon
                      size={19}
                      strokeWidth={active ? 2.4 : 2}
                      className={`transition-transform duration-200 ${active ? "text-ringo-indigo scale-110" : "text-ringo-muted"}`}
                    />
                    <span className={active ? "text-ringo-indigo" : "text-ringo-muted"}>{label}</span>
                  </span>
                </motion.span>
              </Link>
            );
          })}
        </nav>
      </div>

      <HelpWidget username={username} email={email} />
    </div>
  );
}