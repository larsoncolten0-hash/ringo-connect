"use client";

import { usePathname } from "next/navigation";
import { BarChart3, BookOpen, LayoutDashboard } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import SectionTabs from "@/components/dashboard/SectionTabs";

// Sub-navigation of the Reports section: the Overview (landing), the monthly report and the bookkeeping entries that feed it.
export default function ReportsTabs() {
  const pathname = usePathname();
  const { t } = useLanguage();
  const tabs = [
    { href: "/dashboard/reports", label: t.overview.ui.tabOverview, icon: LayoutDashboard },
    { href: "/dashboard/reports/monthly", label: t.reports.ui.tabReport, icon: BarChart3 },
    { href: "/dashboard/reports/entries", label: t.reports.ui.tabEntries, icon: BookOpen },
  ];
  // the Overview is only the exact landing page; every other tab owns its own sub-path
  const isActive = (href: string) => (href === "/dashboard/reports" ? pathname === href || pathname === `${href}/` : pathname.startsWith(href));
  return <SectionTabs tabs={tabs} isActive={isActive} />;
}
