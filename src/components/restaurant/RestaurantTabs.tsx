"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid, ClipboardList, ChefHat, Table2, Receipt, TrendingUp, Users } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import type { Permission } from "@/lib/team/permissions";

// Which permission each tab requires — kept in exact lockstep with the
// permission each tab's own page passes to requireRestaurantProfile() (see
// src/lib/restaurantAuth.ts and each page.tsx under
// src/app/dashboard/restaurant/*). `null` = no specific permission, only
// "an active member of a restaurant-category org," matching the Overview
// page's own (lack of) restriction — this file must never invent a
// stricter or looser rule than what the page it links to already enforces.
const TAB_PERMISSION: Record<string, Permission | null> = {
  "/dashboard/restaurant": null,
  "/dashboard/restaurant/orders": "orders.view",
  "/dashboard/restaurant/kitchen": "kitchen.view",
  "/dashboard/restaurant/tables": "tables.view",
  "/dashboard/restaurant/sales": "sales.view",
  "/dashboard/restaurant/customers": "customers.view",
};

export default function RestaurantTabs({ access }: { access: { isOwner: boolean; permissions: Permission[] } }) {
  const pathname = usePathname();
  const { t } = useLanguage();

  const tabs = [
    { href: "/dashboard/restaurant", label: t.nav.restaurant, icon: LayoutGrid, exact: true },
    { href: "/dashboard/restaurant/orders", label: t.restaurant.ordersLabel, icon: ClipboardList },
    { href: "/dashboard/restaurant/kitchen", label: t.restaurant.kitchenTitle, icon: ChefHat },
    { href: "/dashboard/restaurant/tables", label: t.restaurant.tablesTitle, icon: Table2 },
    { href: "/dashboard/restaurant/sales", label: t.restaurant.salesTitle, icon: TrendingUp },
    { href: "/dashboard/restaurant/customers", label: t.restaurant.customersTitle, icon: Users },
  ].filter((tab) => {
    const required = TAB_PERMISSION[tab.href];
    return !required || access.isOwner || access.permissions.includes(required);
  });

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
