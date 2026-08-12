"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { Users, Layers, SlidersHorizontal, BarChart3, LogOut } from "lucide-react";
import ThemeToggle from "@/components/ThemeToggle";

const NAV_ITEMS = [
  { href: "/admin", label: "Users", icon: Users, exact: true },
  { href: "/admin/plans", label: "Plans", icon: Layers },
  { href: "/admin/settings", label: "Settings", icon: SlidersHorizontal },
  { href: "/admin/analytics", label: "Analytics", icon: BarChart3 },
];

export default function AdminShell({ email, children }: { email: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const isActive = (href: string, exact?: boolean) => (exact ? pathname === href : pathname.startsWith(href));

  const SidebarContent = (
    <>
      <div>
        <Link href="/admin" className="flex items-center gap-2.5 px-1 mb-1">
          <Image src="/logo.png" alt="" width={26} height={26} className="rounded-md" />
          <div className="leading-tight">
            <p className="font-display font-medium text-white text-sm">Ringo Connect</p>
            <p className="text-[10px] uppercase tracking-wider text-white/40">Admin console</p>
          </div>
        </Link>
        {/* Same three-color signature as everywhere else, but as a thin
            accent under a dark header instead of a full gradient line —
            enough to feel like the same brand, restrained enough to sit
            in a chrome element you look at all day. */}
        <div className="h-[2px] w-full mt-4 mb-6 rounded-full bg-gradient-to-r from-ringo-indigo via-ringo-coral to-ringo-teal opacity-60" />

        <nav className="flex flex-col gap-0.5">
          {NAV_ITEMS.map(({ href, label, icon: Icon, exact }) => {
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
                {label}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between px-1">
          <ThemeToggle iconOnly variant="onDark" />
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
      {/* Fixed dark sidebar — deliberately NOT theme-toggle-aware. This is
          chrome, not content: it stays the same dark "control panel"
          regardless of the admin's light/dark preference for the main
          content area, the way most ops tools keep their nav rail fixed. */}
      <aside className="hidden lg:flex flex-col justify-between bg-[#0B1023] p-5 h-screen sticky top-0">
        {SidebarContent}
      </aside>

      {/* Mobile top bar */}
      <div className="lg:hidden flex items-center justify-between px-4 py-3 bg-[#0B1023]">
        <Link href="/admin" className="flex items-center gap-2">
          <Image src="/logo.png" alt="" width={22} height={22} className="rounded-md" />
          <span className="font-display font-medium text-white text-sm">Admin</span>
        </Link>
        <div className="flex items-center gap-1">
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

      {/* Mobile bottom tab bar */}
      <nav
        className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-[#0B1023] flex justify-around pt-2"
        style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
      >
        {NAV_ITEMS.map(({ href, label, icon: Icon, exact }) => {
          const active = isActive(href, exact);
          return (
            <Link
              key={href}
              href={href}
              className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg text-[10px] font-medium transition-colors ${
                active ? "text-white bg-white/10" : "text-white/45"
              }`}
            >
              <Icon size={18} strokeWidth={active ? 2.4 : 2} />
              {label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}