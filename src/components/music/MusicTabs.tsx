"use client";

import { usePathname } from "next/navigation";
import { LayoutGrid, ClipboardList, TrendingUp, Users, Wallet } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import SectionTabs from "@/components/dashboard/SectionTabs";

export default function MusicTabs() {
  const pathname = usePathname();
  const { t } = useLanguage();

  const tabs = [
    { href: "/dashboard/music", label: t.nav.music, icon: LayoutGrid, exact: true },
    { href: "/dashboard/music/orders", label: t.restaurant.ordersLabel, icon: ClipboardList },
    { href: "/dashboard/music/sales", label: t.restaurant.salesTitle, icon: TrendingUp },
    { href: "/dashboard/music/customers", label: t.restaurant.customersTitle, icon: Users },
    { href: "/dashboard/music/earnings", label: t.music.earningsTab, icon: Wallet },
  ];

  const isActive = (href: string, exact?: boolean) => (exact ? pathname === href : pathname.startsWith(href));

  return <SectionTabs tabs={tabs} isActive={isActive} />;
}
