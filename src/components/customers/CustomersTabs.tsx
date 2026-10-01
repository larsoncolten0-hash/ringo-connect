"use client";

import { usePathname } from "next/navigation";
import { AlertCircle, Contact } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import SectionTabs from "@/components/dashboard/SectionTabs";

// Sub-navigation of the Customers area: the directory and the derived "needs attention" lists.
export default function CustomersTabs() {
  const pathname = usePathname();
  const { t } = useLanguage();
  const tabs = [
    { href: "/dashboard/customers", label: t.customerAttention.ui.tabDirectory, icon: Contact },
    { href: "/dashboard/customers/attention", label: t.customerAttention.ui.tabAttention, icon: AlertCircle },
  ];
  const isActive = (href: string) => (href === "/dashboard/customers/attention" ? pathname.startsWith(href) : pathname === href || pathname === `${href}/`);
  return <SectionTabs tabs={tabs} isActive={isActive} />;
}
