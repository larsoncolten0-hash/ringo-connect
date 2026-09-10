"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid, ClipboardList, TrendingUp, Users } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";

export default function MusicTabs() {
  const pathname = usePathname();
  const { t } = useLanguage();

  const tabs = [
    { href: "/dashboard/music", label: t.nav.music, icon: LayoutGrid, exact: true },
    { href: "/dashboard/music/orders", label: t.restaurant.ordersLabel, icon: ClipboardList },
    { href: "/dashboard/music/sales", label: t.restaurant.salesTitle, icon: TrendingUp },
    { href: "/dashboard/music/customers", label: t.restaurant.customersTitle, icon: Users },
  ];

  const isActive = (href: string, exact?: boolean) => (exact ? pathname === href : pathname.startsWith(href));

  return (
    <div className="flex gap-1 overflow-x-auto no-scrollbar border-b border-ringo-border pb-0.5">
      {tabs.map((tab) => {
        const active = isActive(tab.href, tab.exact);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`flex items-center gap-1.5 px-3.5 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
              active ? "border-ringo-indigo text-ringo-indigo" : "border-transparent text-ringo-muted hover:text-ringo-text"
            }`}
          >
            <tab.icon size={15} />
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
