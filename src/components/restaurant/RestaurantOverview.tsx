"use client";

import Link from "next/link";
import { useLanguage } from "@/components/LanguageProvider";
import { formatPrice } from "@/lib/currency";

const STATUS_COLOR: Record<string, string> = {
  pending: "bg-ringo-indigo/10 text-ringo-indigo",
  accepted: "bg-ringo-indigo/10 text-ringo-indigo",
  preparing: "bg-amber-500/10 text-amber-600",
  ready: "bg-ringo-teal/10 text-ringo-teal",
  served: "bg-ringo-teal/10 text-ringo-teal",
  completed: "bg-ringo-teal/10 text-ringo-teal",
  cancelled: "bg-red-500/10 text-red-500",
  refunded: "bg-red-500/10 text-red-500",
};

export default function RestaurantOverview({
  restaurantName,
  currency,
  todaysSales,
  todaysOrderCount,
  pendingCount,
  completedCount,
  recentOrders,
  topSelling,
}: {
  restaurantName: string;
  currency: string;
  todaysSales: number;
  todaysOrderCount: number;
  pendingCount: number;
  completedCount: number;
  recentOrders: any[];
  topSelling: { name: string; qty: number }[];
}) {
  const { t, locale } = useLanguage();

  return (
    <div className="flex flex-col gap-5">
      <h1 className="font-display text-xl font-medium text-ringo-text">{t.restaurant.dashboardGreeting(restaurantName)}</h1>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: t.restaurant.todaysSales, value: formatPrice(todaysSales, currency, locale) },
          { label: t.restaurant.ordersLabel, value: String(todaysOrderCount) },
          { label: t.restaurant.pendingLabel, value: String(pendingCount) },
          { label: t.restaurant.completedLabel, value: String(completedCount) },
        ].map((stat) => (
          <div key={stat.label} className="rounded-card border border-ringo-border/70 bg-ringo-surface p-4">
            <p className="text-xs text-ringo-muted mb-1">{stat.label}</p>
            <p className="text-lg font-bold text-ringo-text" suppressHydrationWarning>
              {stat.value}
            </p>
          </div>
        ))}
      </div>

      <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-ringo-text">{t.restaurant.recentOrders}</h2>
          <Link href="/dashboard/restaurant/orders" className="text-xs font-medium text-ringo-indigo">
            {t.restaurant.ordersLabel}
          </Link>
        </div>
        {recentOrders.length === 0 && <p className="text-sm text-ringo-muted">{t.restaurant.noOrdersYet}</p>}
        <div className="flex flex-col gap-2">
          {recentOrders.map((o: any) => (
            <div key={o.id} className="flex items-center justify-between text-sm py-1.5 border-b border-ringo-border/50 last:border-0">
              <span className="text-ringo-text">
                #{o.order_number}
                {o.restaurant_tables?.label && <span className="text-ringo-muted"> · {o.restaurant_tables.label}</span>}
              </span>
              <span className="text-ringo-text font-medium" suppressHydrationWarning>
                {formatPrice(o.total, currency, locale)}
              </span>
              <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${STATUS_COLOR[o.status] || ""}`}>{o.status}</span>
            </div>
          ))}
        </div>
      </div>

      {topSelling.length > 0 && (
        <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-5">
          <h2 className="text-sm font-medium text-ringo-text mb-3">{t.restaurant.topSelling}</h2>
          <div className="flex flex-col gap-1.5">
            {topSelling.map((item, i) => (
              <div key={item.name} className="flex items-center justify-between text-sm">
                <span className="text-ringo-text">
                  {i + 1}. {item.name}
                </span>
                <span className="text-ringo-muted">{item.qty}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
