"use client";

import { usePathname } from "next/navigation";
import { BarChart3, BookOpen } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import SectionTabs from "@/components/dashboard/SectionTabs";

// Sub-navigation of the Reports section: the monthly report and the bookkeeping entries that feed it.
export default function ReportsTabs() {
  const pathname = usePathname();
  const { t } = useLanguage();
  const tabs = [
    { href: "/dashboard/reports", label: t.reports.ui.tabReport, icon: BarChart3 },
    { href: "/dashboard/reports/entries", label: t.reports.ui.tabEntries, icon: BookOpen },
  ];
  const isActive = (href: string) => (href === "/dashboard/reports/entries" ? pathname.startsWith(href) : pathname === href || pathname === `${href}/`);
  return <SectionTabs tabs={tabs} isActive={isActive} />;
}
