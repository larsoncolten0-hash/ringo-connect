"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import BrandLogo from "@/components/BrandLogo";
import { hasCustomLogo } from "@/lib/brandingDefaults";
import { usePathname } from "next/navigation";
import { Users, Layers, SlidersHorizontal, BarChart3, Inbox, Package, LogOut, Handshake, QrCode, Banknote, DollarSign, Radio, MessageCircle, BadgeCheck, Palette, FlaskConical, UserCheck, type LucideIcon } from "lucide-react";
import ThemeToggle from "@/components/ThemeToggle";
import NotificationBell from "@/components/NotificationBell";
import PushPermissionPrompt from "@/components/PushPermissionPrompt";
import RegisterServiceWorker from "@/components/RegisterServiceWorker";
import AppBadgeReset from "@/components/AppBadgeReset";
import { AdminInstallButton } from "@/components/admin/AdminAppControls";
import AdminMoreMenu from "@/components/admin/AdminMoreMenu";
import CountBadge from "@/components/admin/CountBadge";
import type { AdminNavCounts } from "@/lib/adminNavCounts";

// `core: true` marks the 4 items the mobile bottom tab bar shows — kept
// short on purpose, same reasoning as the creator dashboard's own
// mobile tab bar (see DashboardShell.tsx's NAV_ITEMS comment). Everything
// else lives behind the mobile header's hamburger (AdminMoreMenu). The
// desktop sidebar is unaffected by this split: it always renders every
// item, core or not, since it has the room mobile doesn't.
//
// `countKey`, when present, looks up a live "needs your attention" count
// from AdminNavCounts (see src/lib/adminNavCounts.ts) to show as a
// CountBadge next to that item everywhere it appears — sidebar, hamburger
// panel, and (for the 4 core ones) the bottom tab bar itself.
const NAV_ITEMS: {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
  core: boolean;
  countKey?: keyof AdminNavCounts;
}[] = [
  { href: "/admin", label: "Users", icon: Users, exact: true, core: true },
  { href: "/admin/requests", label: "Requests", icon: Inbox, core: true, countKey: "requests" },
  { href: "/admin/support", label: "Support", icon: MessageCircle, core: true, countKey: "support" },
  { href: "/admin/verification", label: "Verification", icon: BadgeCheck, core: false, countKey: "verification" },
  { href: "/admin/plans", label: "Plans", icon: Layers, core: false },
  { href: "/admin/addons", label: "Add-ons", icon: Package, core: false },
  { href: "/admin/price-controls", label: "Price Controls", icon: DollarSign, core: false },
  { href: "/admin/affiliates", label: "Affiliates", icon: Handshake, core: false, countKey: "affiliates" },
  { href: "/admin/music-payouts", label: "Music payouts", icon: Banknote, core: false, countKey: "musicPayouts" },
  { href: "/admin/broadcast", label: "Broadcast", icon: Radio, core: false },
  { href: "/admin/qr-code", label: "QR code", icon: QrCode, core: false },
  { href: "/admin/demo", label: "Demo link", icon: FlaskConical, core: false },
  { href: "/admin/settings", label: "Settings", icon: SlidersHorizontal, core: true },
  { href: "/admin/analytics", label: "Analytics", icon: BarChart3, core: false },
  { href: "/admin/customers", label: "Customers", icon: UserCheck, core: false },
  { href: "/admin/branding", label: "Branding", icon: Palette, core: false },
];

export default function AdminShell({
  email,
  initialCounts,
  appName,
  logoUrl,
  children,
}: {
  email: string;
  initialCounts: AdminNavCounts;
  // Platform branding (src/lib/branding.ts) — this console's own "Ringo
  // Connect" wordmark/logo aren't hardcoded so an admin can rebrand the
  // whole platform from /admin/branding without a code change.
  appName: string;
  logoUrl: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isActive = (href: string, exact?: boolean) => (exact ? pathname === href : pathname.startsWith(href));

  const [counts, setCounts] = useState(initialCounts);

  // Polls rather than Supabase Realtime — same "no Realtime dependency"
  // posture every other live view in this app already uses. 15s keeps
  // the badges current without hammering the database from every open
  // admin tab; nothing here is urgent enough to need the ~3-5s intervals
  // an actually-open chat/inbox pane uses.
  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch("/api/admin/nav-counts");
        if (!res.ok) return;
        setCounts(await res.json());
      } catch {
        // Silent — a missed refresh just means slightly stale badges
        // until the next tick.
      }
    };
    const interval = setInterval(poll, 15000);
    return () => clearInterval(interval);
  }, []);

  const countFor = (countKey?: keyof AdminNavCounts) => (countKey ? counts[countKey] : undefined);

  const coreItems = NAV_ITEMS.filter((i) => i.core);
  const moreItems = NAV_ITEMS.filter((i) => !i.core);

  const SidebarContent = (
    <>
      <div>
        <Link href="/admin" className="flex flex-col items-start gap-1.5 px-1 mb-1 text-white">
          <BrandLogo
            logoUrl={logoUrl}
            appName={appName}
            variant="full"
            tone="dark"
            height={24}
            legacy={
              <span className="flex items-center gap-2.5">
                <Image src={logoUrl} alt="" width={26} height={26} className="rounded-md object-contain" />
                <div className="leading-tight">
                  <p className="font-display font-medium text-white text-sm">{appName}</p>
                  <p className="text-[10px] uppercase tracking-wider text-white/40">Admin console</p>
                </div>
              </span>
            }
          />
          {!hasCustomLogo(logoUrl) && <p className="text-[10px] uppercase tracking-wider text-white/40">Admin console</p>}
        </Link>
        {/* Same three-color signature as everywhere else, but as a thin
            accent under a dark header instead of a full gradient line —
            enough to feel like the same brand, restrained enough to sit
            in a chrome element you look at all day. */}
        <div className="h-[2px] w-full mt-4 mb-6 rounded-full bg-gradient-to-r from-ringo-indigo via-ringo-coral to-ringo-teal opacity-60" />

        <nav className="flex flex-col gap-0.5">
          {NAV_ITEMS.map(({ href, label, icon: Icon, exact, countKey }) => {
            const active = isActive(href, exact);
            return (
              <Link
                key={href}
                href={href}
                className={`relative flex items-center gap-3 pl-3.5 pr-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  active ? "bg-white/10 text-white" : "text-white/55 hover:bg-white/5 hover:text-white/85"
                }`}
              >
                {active && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[3px] rounded-full bg-ringo-coral" />
                )}
                <Icon size={17} strokeWidth={2} />
                <span className="flex-1">{label}</span>
                <CountBadge count={countFor(countKey)} />
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-1 px-1">
          {/* The in-app feed — every full admin sees the same rows (see
              notifyAdmins() in src/lib/notifications.ts). OS-level push is
              opted into via the proactive prompt below instead of an
              always-visible icon here (see PushPermissionPrompt's own
              comment); it can still be toggled manually from
              /admin/settings once someone's dismissed that prompt. */}
          <NotificationBell mode="admin" variant="onDark" />
          <ThemeToggle iconOnly variant="onDark" />
        </div>
        {/* "Add to Home Screen" — a separate concern from the notification
            bell/prompt above: this is PWA installability, not push opt-in.
            Renders nothing when installing isn't actually possible (see
            AdminAppControls.tsx's own comment). */}
        <div className="flex flex-col gap-0.5 border-t border-white/10 pt-3">
          <AdminInstallButton variant="row" />
        </div>
        <div className="border-t border-white/10 pt-3 flex items-center justify-between px-1">
          <div className="min-w-0">
            <p className="text-xs text-white/40 uppercase tracking-wide mb-0.5">Signed in as</p>
            <p className="text-sm text-white truncate">{email}</p>
          </div>
          <Link
            href="/auth/logout"
            aria-label="Log out"
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-white/50 hover:text-ringo-coral hover:bg-white/5 transition-colors"
          >
            <LogOut size={15} />
          </Link>
        </div>
      </div>
    </>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[248px_1fr]">
      {/* Registers the same non-caching service worker DashboardShell
          uses (see RegisterServiceWorker.tsx) — needed here too now,
          since the push prompt below depends on
          navigator.serviceWorker.ready resolving. */}
      <RegisterServiceWorker />
      <AppBadgeReset />

      {/* Proactively asks to enable push, instead of relying on someone
          noticing a header icon — see that component's own comment. */}
      <PushPermissionPrompt
        subscribeUrl="/api/push/subscribe"
        body="Get notified about new paid members, signup requests and payout requests — right on this device."
      />

      {/* Fixed dark sidebar — deliberately NOT theme-toggle-aware. This is
          chrome, not content: it stays the same dark "control panel"
          regardless of the admin's light/dark preference for the main
          content area, the way most ops tools keep their nav rail fixed. */}
      <aside className="hidden lg:flex flex-col justify-between bg-[#0B1023] p-5 h-screen sticky top-0">
        {SidebarContent}
      </aside>

      {/* Mobile top bar — `relative` so AdminMoreMenu's dropdown panel
          (position: absolute, top-full) anchors right below it. */}
      <div className="lg:hidden relative flex items-center justify-between px-4 py-3 bg-[#0B1023]">
        <div className="flex items-center gap-1 min-w-0">
          <AdminMoreMenu items={moreItems} isActive={isActive} />
          <Link href="/admin" className="flex items-center gap-2 min-w-0">
            <BrandLogo
              logoUrl={logoUrl}
              appName={appName}
              variant="symbol"
              height={22}
              legacy={<Image src={logoUrl} alt="" width={22} height={22} className="rounded-md shrink-0 object-contain" />}
            />
            <span className="font-display font-medium text-white text-sm truncate">Admin</span>
          </Link>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <AdminInstallButton variant="icon" />
          <NotificationBell mode="admin" variant="onDark" />
          <ThemeToggle iconOnly variant="onDark" />
          <Link
            href="/auth/logout"
            aria-label="Log out"
            className="w-9 h-9 flex items-center justify-center rounded-full text-white/50 hover:text-ringo-coral hover:bg-white/10 transition-colors"
          >
            <LogOut size={16} />
          </Link>
        </div>
      </div>

      <main className="p-6 lg:p-10 pb-24 lg:pb-10">{children}</main>

      {/* Mobile bottom tab bar — just the 4 core items (Users, Requests,
          Support, Settings); everything else lives in AdminMoreMenu
          above. */}
      <nav
        className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-[#0B1023] flex justify-around pt-2"
        style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
      >
        {coreItems.map(({ href, label, icon: Icon, exact, countKey }) => {
          const active = isActive(href, exact);
          return (
            <Link
              key={href}
              href={href}
              className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg text-[10px] font-medium transition-colors ${
                active ? "text-white bg-white/10" : "text-white/45"
              }`}
            >
              <span className="relative">
                <Icon size={18} strokeWidth={active ? 2.4 : 2} />
                <CountBadge count={countFor(countKey)} variant="corner" />
              </span>
              {label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
