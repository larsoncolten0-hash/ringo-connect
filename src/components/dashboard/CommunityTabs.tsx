"use client";

import { usePathname } from "next/navigation";
import { LayoutDashboard, Users, Megaphone, Settings } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import SectionTabs from "@/components/dashboard/SectionTabs";

export default function CommunityTabs() {
  const pathname = usePathname();
  const { t } = useLanguage();

  const tabs = [
    { href: "/dashboard/community", label: t.community.overviewTab, icon: LayoutDashboard, exact: true },
    { href: "/dashboard/community/subscribers", label: t.community.subscribersTab, icon: Users },
    { href: "/dashboard/community/announcements", label: t.community.announcementsTab, icon: Megaphone },
    { href: "/dashboard/community/settings", label: t.community.settingsTab, icon: Settings },
  ];

  const isActive = (href: string, exact?: boolean) => (exact ? pathname === href : pathname.startsWith(href));

  return <SectionTabs tabs={tabs} isActive={isActive} />;
}
