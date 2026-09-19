"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Gift, LayoutGrid, ListChecks, Package, ScanLine, Settings2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";

// Header + tab bar for /dashboard/loyalty/**. Which tabs show mirrors what each page (and the
// API behind it) actually allows: scan/activity need loyalty.scan; packages and program setup
// need loyalty.manage. Hiding a tab is only UX; every page and route re-checks on the server.
export default function LoyaltyShell({
  can,
  packagesOffered,
  hidden,
  children,
}: {
  can: { scan: boolean; manage: boolean; reverse: boolean };
  packagesOffered: boolean;
  hidden: boolean;
  children: React.ReactNode;
}) {
  const { t } = useLanguage();
  const L = t.loyalty;
  const pathname = usePathname();

  const tabs = [
    { href: "/dashboard/loyalty", label: L.tabs.overview, icon: LayoutGrid, exact: true, show: true },
    { href: "/dashboard/loyalty/scan", label: L.tabs.scan, icon: ScanLine, exact: false, show: can.scan },
    { href: "/dashboard/loyalty/activity", label: L.tabs.activity, icon: ListChecks, exact: false, show: can.scan },
    { href: "/dashboard/loyalty/packages", label: L.tabs.packages, icon: Package, exact: false, show: can.manage && packagesOffered },
    { href: "/dashboard/loyalty/setup", label: L.tabs.setup, icon: Settings2, exact: false, show: can.manage },
  ].filter((tab) => tab.show);

  return (
    <div className="max-w-5xl">
      <div className="mb-4">
        <h1 className="font-display text-xl font-medium text-ringo-text">{L.title}</h1>
        <p className="text-sm text-ringo-muted">{L.subtitle}</p>
      </div>

      {hidden ? (
        <div className="flex flex-col items-center gap-2 rounded-card border border-ringo-border/70 bg-ringo-surface p-8 text-center">
          <Gift size={28} className="text-ringo-muted" />
          <p className="text-base font-semibold text-ringo-text">{L.notAvailable.title}</p>
          <p className="max-w-md text-sm text-ringo-muted">{L.notAvailable.body}</p>
        </div>
      ) : (
        <>
          <div className="no-scrollbar flex gap-1 overflow-x-auto border-b border-ringo-border pb-0.5">
            {tabs.map((tab) => {
              const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors ${
                    active ? "border-ringo-indigo text-ringo-indigo" : "border-transparent text-ringo-muted hover:text-ringo-text"
                  }`}
                >
                  <tab.icon size={15} />
                  {tab.label}
                </Link>
              );
            })}
          </div>
          <div className="mt-5">{children}</div>
        </>
      )}
    </div>
  );
}
