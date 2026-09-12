"use client";

import { useMemo, useState } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import { formatPrice } from "@/lib/currency";

type FilterKey = "today" | "yesterday" | "week" | "month";

// Historical accuracy comes for free here — `orders.total` was computed
// once at checkout from menu_items' price at that exact moment (see
// /api/orders), so editing a menu item's price today never changes what
// yesterday's sales report shows.
export default function SalesView({
  orders,
  lineItems,
  currency,
}: {
  orders: { id: string; order_type: string; total: number; created_at: string }[];
  lineItems: { item_name_snapshot: string; quantity: number }[];
  currency: string;
}) {
  const { t, locale } = useLanguage();
  const [filter, setFilter] = useState<FilterKey>("today");

  const range = useMemo(() => {
    const now = new Date();
    const startOfDay = (d: Date) => {
      const x = new Date(d);
      x.setHours(0, 0, 0, 0);
      return x;
    };
    if (filter === "today") return { from: startOfDay(now), to: now };
    if (filter === "yesterday") {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      return { from: startOfDay(y), to: startOfDay(now) };
    }
    if (filter === "week") {
      const from = new Date(now);
      from.setDate(from.getDate() - 7);
      return { from, to: now };
    }
    const from = new Date(now);
    from.setDate(from.getDate() - 30);
    return { from, to: now };
  }, [filter]);

  const filteredOrders = orders.filter((o) => {
    const d = new Date(o.created_at);
    return d >= range.from && d <= range.to;
  });

  const totalSales = filteredOrders.reduce((sum, o) => sum + Number(o.total), 0);
  const avgOrder = filteredOrders.length > 0 ? totalSales / filteredOrders.length : 0;

  const byType = filteredOrders.reduce<Record<string, number>>((acc, o) => {
    acc[o.order_type] = (acc[o.order_type] || 0) + 1;
    return acc;
  }, {});

  // Daily history over the whole 90-day window fetched, not just the
  // active filter — the filter chips control the summary cards, this
  // table is always the fuller picture underneath.
  const byDay = useMemo(() => {
    const map = new Map<string, { orders: number; sales: number }>();
    for (const o of orders) {
      const key = new Date(o.created_at).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-US", { month: "short", day: "numeric" });
      const entry = map.get(key) || { orders: 0, sales: 0 };
      entry.orders += 1;
      entry.sales += Number(o.total);
      map.set(key, entry);
    }
    return Array.from(map.entries()).slice(0, 14);
  }, [orders, locale]);

  const bestSelling = useMemo(() => {
    const tally = new Map<string, number>();
    for (const li of lineItems) tally.set(li.item_name_snapshot, (tally.get(li.item_name_snapshot) || 0) + li.quantity);
    return Array.from(tally.entries())
      .map(([name, qty]) => ({ name, qty }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5);
  }, [lineItems]);

  const filters: { key: FilterKey; label: string }[] = [
    { key: "today", label: t.restaurant.filterToday },
    { key: "yesterday", label: t.restaurant.filterYesterday },
    { key: "week", label: t.restaurant.filterWeek },
    { key: "month", label: t.restaurant.filterMonth },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex gap-1.5">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`text-xs font-medium px-3 py-1.5 rounded-full border transition ${
              filter === f.key ? "border-ringo-indigo bg-ringo-indigo/10 text-ringo-indigo" : "border-ringo-border text-ringo-muted"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: t.restaurant.todaysSales, value: formatPrice(totalSales, currency, locale) },
          { label: t.restaurant.ordersLabel, value: String(filteredOrders.length) },
          { label: t.restaurant.averageOrder, value: formatPrice(avgOrder, currency, locale) },
        ].map((s) => (
          <div key={s.label} className="rounded-card border border-ringo-border/70 bg-ringo-surface p-4">
            <p className="text-xs text-ringo-muted mb-1">{s.label}</p>
            <p className="text-lg font-bold text-ringo-text" suppressHydrationWarning>
              {s.value}
            </p>
          </div>
        ))}
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-5">
          <h2 className="text-sm font-medium text-ringo-text mb-3">{t.restaurant.bestSellingItems}</h2>
          {bestSelling.length === 0 ? (
            <p className="text-sm text-ringo-muted">{t.restaurant.noOrdersYet}</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {bestSelling.map((item, i) => (
                <div key={item.name} className="flex justify-between text-sm">
                  <span className="text-ringo-text">
                    {i + 1}. {item.name}
                  </span>
                  <span className="text-ringo-muted">{item.qty}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-5">
          <h2 className="text-sm font-medium text-ringo-text mb-3">{t.restaurant.ordersByType}</h2>
          <div className="flex flex-col gap-1.5">
            {[
              ["dine_in", t.restaurant.dineInLabel],
              ["takeaway", t.restaurant.takeawayLabel],
              ["delivery", t.restaurant.deliveryLabel],
            ].map(([key, label]) => (
              <div key={key} className="flex justify-between text-sm">
                <span className="text-ringo-text">{label}</span>
                <span className="text-ringo-muted">{byType[key] || 0}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-5">
        <h2 className="text-sm font-medium text-ringo-text mb-3">{t.restaurant.salesTitle}</h2>
        {byDay.length === 0 ? (
          <p className="text-sm text-ringo-muted">{t.restaurant.noOrdersYet}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-ringo-muted border-b border-ringo-border/70">
                  <th className="py-1.5 font-normal">Date</th>
                  <th className="font-normal">{t.restaurant.ordersLabel}</th>
                  <th className="font-normal text-right">{t.restaurant.todaysSales}</th>
                </tr>
              </thead>
              <tbody>
                {byDay.map(([day, stats]) => (
                  <tr key={day} className="border-b border-ringo-border/40 last:border-0">
                    <td className="py-1.5 text-ringo-text">{day}</td>
                    <td className="text-ringo-text">{stats.orders}</td>
                    <td className="text-ringo-text text-right" suppressHydrationWarning>
                      {formatPrice(stats.sales, currency, locale)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
