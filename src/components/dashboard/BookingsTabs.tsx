"use client";

import { usePathname } from "next/navigation";
import { ClipboardList, Settings } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import SectionTabs from "@/components/dashboard/SectionTabs";

export default function BookingsTabs() {
  const pathname = usePathname();
  const { t } = useLanguage();

  const tabs = [
    { href: "/dashboard/bookings", label: t.bookings.requestsTab, icon: ClipboardList, exact: true },
    { href: "/dashboard/bookings/settings", label: t.bookings.settingsTab, icon: Settings },
  ];

  const isActive = (href: string, exact?: boolean) => (exact ? pathname === href : pathname.startsWith(href));

  return <SectionTabs tabs={tabs} isActive={isActive} />;
}
