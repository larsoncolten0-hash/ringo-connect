"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardList, Settings } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";

export default function BookingsTabs() {
  const pathname = usePathname();
  const { t } = useLanguage();

  const tabs = [
    { href: "/dashboard/bookings", label: t.bookings.requestsTab, icon: ClipboardList, exact: true },
    { href: "/dashboard/bookings/settings", label: t.bookings.settingsTab, icon: Settings },
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
