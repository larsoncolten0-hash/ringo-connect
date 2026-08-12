"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { LayoutGrid, BarChart3, CreditCard } from "lucide-react";
import ThemeToggle from "@/components/ThemeToggle";
import LanguageToggle from "@/components/LanguageToggle";
import AvatarMenu from "@/components/dashboard/AvatarMenu";
import InstallPrompt from "@/components/InstallPrompt";
import { useLanguage } from "@/components/LanguageProvider";

export default function DashboardShell({
  email,
  username,
  avatarUrl,
  planName,
  isFreePlan,
  children,
}: {
  email: string;
  username: string;
  avatarUrl?: string | null;
  planName: string;
  isFreePlan: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { t } = useLanguage();

  const NAV_ITEMS = [
    { href: "/dashboard", label: t.nav.editor, icon: LayoutGrid, exact: true },
    { href: "/dashboard/analytics", label: t.nav.analytics, icon: BarChart3 },
    { href: "/dashboard/subscription", label: t.nav.subscription, icon: CreditCard },
  ];

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname.startsWith(href);

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[260px_1fr]">
      {/* Desktop sidebar — the persistent nav. Every dashboard page renders
          inside this layout, so this never re-mounts between pages. */}
      <aside className="hidden lg:flex flex-col justify-between border-r border-ringo-border p-5 h-screen sticky top-0">
        <div>
          <Link href="/" className="flex items-center gap-2.5 px-1">
            <Image src="/logo.png" alt="Ringo Connect" width={28} height={28} className="rounded-md" />
            <span className="font-display font-medium text-ringo-text">Ringo Connect</span>
          </Link>
          {/* Signature: a quiet gradient line — same brand signal as the
              animated rings on the auth pages, at rest for a daily-use screen. */}
          <div className="h-[2px] w-full mt-4 mb-6 rounded-full bg-gradient-to-r from-ringo-indigo via-ringo-coral to-ringo-teal opacity-70" />

          <nav className="flex flex-col gap-0.5">
            {NAV_ITEMS.map(({ href, label, icon: Icon, exact }) => {
              const active = isActive(href, exact);
              return (
                <Link
                  key={href}
                  href={href}
                  className={`relative flex items-center gap-3 pl-3.5 pr-3 py-2.5 rounded-card text-sm font-medium transition-colors ${
                    active
                      ? "bg-ringo-indigo/10 text-ringo-indigo"
                      : "text-ringo-muted hover:bg-ringo-muted/10 hover:text-ringo-text"
                  }`}
                >
                  {active && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[3px] rounded-full bg-ringo-indigo" />
                  )}
                  <Icon size={17} strokeWidth={2} />
                  {label}
                </Link>
              );
            })}
          </nav>
        </div>

        {isFreePlan && (
          <Link
            href="/dashboard/subscription"
            className="block rounded-card p-3.5 bg-gradient-to-br from-ringo-indigo to-ringo-indigo/85 text-white shadow-[0_4px_16px_-4px_rgba(79,70,229,0.4)] transition-transform hover:-translate-y-0.5"
          >
            <p className="text-xs font-medium opacity-80 mb-0.5">{t.sidebar.freeBadge}</p>
            <p className="text-sm font-medium mb-2.5 leading-snug">{t.sidebar.unlockFeatures}</p>
            <span className="text-xs font-medium underline underline-offset-2">{t.sidebar.upgradePlan}</span>
          </Link>
        )}
      </aside>

      <div className="flex flex-col min-h-screen">
        {/* Top-right cluster — language + theme toggle + avatar menu. */}
        <div className="flex items-center justify-between lg:justify-end gap-2 px-4 lg:px-10 py-3 sticky top-0 z-30 bg-ringo-bg/85 backdrop-blur border-b border-ringo-border lg:border-none">
          <Link href="/" className="flex items-center gap-2 lg:hidden">
            <Image src="/logo.png" alt="Ringo Connect" width={24} height={24} className="rounded-md" />
          </Link>
          <div className="flex items-center gap-1">
            <LanguageToggle />
            <ThemeToggle iconOnly />
            <AvatarMenu email={email} username={username} avatarUrl={avatarUrl} planName={planName} />
          </div>
        </div>

        <main className="flex-1 px-4 lg:px-10 py-6 pb-24 lg:pb-10">{children}</main>

        {/* Mobile bottom tab bar — replaces the sidebar on small screens. */}
        <nav
          className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-ringo-surface border-t border-ringo-border flex justify-around pt-2"
          style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
        >
          {NAV_ITEMS.map(({ href, label, icon: Icon, exact }) => {
            const active = isActive(href, exact);
            return (
              <Link
                key={href}
                href={href}
                className={`flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-card text-[11px] font-medium transition-colors ${
                  active ? "text-ringo-indigo bg-ringo-indigo/10" : "text-ringo-muted"
                }`}
              >
                <Icon size={19} strokeWidth={active ? 2.4 : 2} />
                {label}
              </Link>
            );
          })}
        </nav>
      </div>

      <InstallPrompt />
    </div>
  );
}