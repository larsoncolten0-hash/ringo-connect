"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Link2, Music, MessageCircle, Receipt, User } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import LanguageToggle from "@/components/LanguageToggle";
import { usePlayer } from "./player/MusicPlayerProvider";
import AccountMenu from "./AccountMenu";
import BrandLogo from "@/components/BrandLogo";

// The My Ringo chrome — deliberately its OWN navigation, separate from the
// creator dashboard's shell/tab bar (nothing is shared or imported from
// there). Bottom tab bar on phones, a slim sidebar from `sm` up. Receives only
// what the avatar menu shows about the customer themself (name, avatar, email and
// whether it's confirmed) — never phone or any id.
export default function MyRingoShell({
  customer,
  children,
}: {
  customer: { name: string; avatarUrl: string | null; email: string; emailConfirmed: boolean };
  children: React.ReactNode;
}) {
  const { t } = useLanguage();
  const pathname = usePathname();
  const { current: nowPlaying } = usePlayer();

  const items = [
    { href: "/my-ringo", label: t.myRingo.nav.home, Icon: Home, exact: true },
    { href: "/my-ringo/connections", label: t.myRingo.nav.connections, Icon: Link2, exact: false },
    { href: "/my-ringo/music", label: t.myRingo.nav.music, Icon: Music, exact: false },
    { href: "/my-ringo/activity", label: t.myRingo.nav.activity, Icon: Receipt, exact: false },
    { href: "/my-ringo/inbox", label: t.myRingo.nav.inbox, Icon: MessageCircle, exact: false },
    { href: "/my-ringo/me", label: t.myRingo.nav.me, Icon: User, exact: false },
  ];
  const isActive = (href: string, exact: boolean) => (exact ? pathname === href : pathname.startsWith(href));

  return (
    <div className="min-h-screen bg-ringo-bg text-ringo-text">
      {/* Desktop / tablet sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-ringo-border/70 bg-ringo-surface p-4 sm:flex">
        <Link href="/my-ringo" className="mb-6 flex items-center gap-2 px-2 font-display text-lg font-bold tracking-tight">
          <BrandLogo variant="symbol" height={26} />
          {t.myRingo.title}
        </Link>
        <nav aria-label={t.myRingo.nav.label} className="flex flex-col gap-1">
          {items.map(({ href, label, Icon, exact }) => {
            const active = isActive(href, exact);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                  active ? "bg-ringo-indigo/10 text-ringo-indigo" : "text-ringo-muted hover:bg-ringo-muted/10 hover:text-ringo-text"
                }`}
              >
                <Icon size={18} />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto mb-2 px-1">
          <LanguageToggle />
        </div>
        <AccountMenu customer={customer} variant="side" />
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-ringo-border/70 bg-ringo-surface/90 px-4 backdrop-blur sm:hidden">
        <Link href="/my-ringo" className="flex items-center gap-2 font-display text-base font-bold tracking-tight">
          <BrandLogo variant="symbol" height={24} />
          {t.myRingo.title}
        </Link>
        <div className="flex items-center gap-1">
          <LanguageToggle />
          <AccountMenu customer={customer} variant="top" />
        </div>
      </header>

      <main
        className={`mx-auto w-full max-w-3xl px-4 pt-5 sm:ml-60 sm:max-w-none sm:px-8 sm:pt-8 ${
          nowPlaying ? "pb-44 sm:pb-28" : "pb-28 sm:pb-10"
        }`}
      >
        <div className="mx-auto w-full max-w-3xl">{children}</div>
      </main>

      {/* Mobile bottom tab bar */}
      <nav
        aria-label={t.myRingo.nav.label}
        className="fixed inset-x-0 bottom-0 z-30 border-t border-ringo-border/70 bg-ringo-surface/95 backdrop-blur sm:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <ul className="mx-auto flex max-w-md items-stretch justify-around">
          {items.map(({ href, label, Icon, exact }) => {
            const active = isActive(href, exact);
            return (
              <li key={href} className="flex-1">
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition ${
                    active ? "text-ringo-indigo" : "text-ringo-muted"
                  }`}
                >
                  <Icon size={21} strokeWidth={active ? 2.4 : 2} />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
