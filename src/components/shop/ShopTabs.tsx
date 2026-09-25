"use client";

import { usePathname } from "next/navigation";
import { ClipboardList, Wallet } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import SectionTabs from "@/components/dashboard/SectionTabs";

// Sub-navigation of the Shop section (same SectionTabs the Music section uses).
export default function ShopTabs() {
  const pathname = usePathname();
  const { t } = useLanguage();

  const tabs = [
    { href: "/dashboard/shop", label: t.shopOrders.tabOrders, icon: ClipboardList },
    { href: "/dashboard/shop/earnings", label: t.shopOrders.tabEarnings, icon: Wallet },
  ];

  // The Orders tab also covers an order's own detail page (/dashboard/shop/<id>).
  const isActive = (href: string) => (href === "/dashboard/shop/earnings" ? pathname.startsWith(href) : pathname.startsWith("/dashboard/shop") && !pathname.startsWith("/dashboard/shop/earnings"));

  return <SectionTabs tabs={tabs} isActive={isActive} />;
}
