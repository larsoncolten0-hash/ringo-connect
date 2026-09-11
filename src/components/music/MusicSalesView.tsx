"use client";

import { useMemo, useState } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import { formatPrice } from "@/lib/currency";

type FilterKey = "today" | "yesterday" | "week" | "month";

// Revenue everywhere on this page only ever counts paid, non-cancelled/
// refunded orders — matching the "Reporting only, no withdrawal flow"
// decision: these are informational totals computed from completed sales,
// never a held balance, and there is deliberately no payout/withdrawal
// action here (see balanceComingSoonBody below) because Ringo Connect has
// no real payment-collection gateway yet — only a declared payment method
// the artist marks as received (see MusicOrdersView's "Mark Paid").
export default function MusicSalesView({
  orders,
  items,
  currency,
}: {
  orders: { id: string; total: number; created_at: string }[];
  items: { item_type: string; name_snapshot: string; quantity: number; line_total: number; event_id?: string | null }[];
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

  const revenueByType = (types: string[]) =>
    items.filter((i) => types.includes(i.item_type)).reduce((sum, i) => sum + Number(i.line_total), 0);

  const bestOf = (type: string) => {
    const tally = new Map<string, number>();
    for (const i of items) {
      if (i.item_type !== type) continue;
      tally.set(i.name_snapshot, (tally.get(i.name_snapshot) || 0) + i.quantity);
    }
    const sorted = Array.from(tally.entries()).sort((a, b) => b[1] - a[1]);
    return sorted[0]?.[0] || null;
  };

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

  const filters: { key: FilterKey; label: string }[] = [
    { key: "today", label: t.restaurant.filterToday },
    { key: "yesterday", label: t.restaurant.filterYesterday },
    { key: "week", label: t.restaurant.filterWeek },
    { key: "month", label: t.restaurant.filterMonth },
  ];

  const bestSellers = [
    bestOf("song") && { label: t.music.bestSellingSong, value: bestOf("song")! },
    bestOf("release") && { label: t.music.bestSellingRelease, value: bestOf("release")! },
    bestOf("merch") && { label: t.music.bestSellingMerch, value: bestOf("merch")! },
  ].filter(Boolean) as { label: string; value: string }[];

  // Real revenue per ticket tier — grouped straight from the same paid,
  // non-cancelled/refunded order_items every other total on this page
  // already reads, using each line's own price_snapshot-derived
  // line_total. Never the ticket type's current live price: an artist who
  // later changes VIP from 5,000 to 7,000 must not silently rewrite what
  // past buyers actually paid (see the migration's own header note).
  const ticketBreakdown = useMemo(() => {
    const tally = new Map<string, { quantity: number; revenue: number }>();
    for (const i of items) {
      if (i.item_type !== "ticket") continue;
      const entry = tally.get(i.name_snapshot) || { quantity: 0, revenue: 0 };
      entry.quantity += i.quantity;
      entry.revenue += Number(i.line_total);
      tally.set(i.name_snapshot, entry);
    }
    return Array.from(tally.entries())
      .map(([name, stats]) => ({ name, ...stats }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [items]);

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
          { label: t.music.totalRevenueLabel, value: formatPrice(totalSales, currency, locale) },
          { label: t.music.totalOrdersLabelMusic, value: String(filteredOrders.length) },
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

      <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-5">
        <h2 className="text-sm font-medium text-ringo-text mb-3">{t.music.revenueByCategory}</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: t.music.musicSalesLabel, value: revenueByType(["song", "release"]) },
            { label: t.music.merchSalesLabel, value: revenueByType(["merch"]) },
            { label: t.music.ticketSalesLabel, value: revenueByType(["ticket"]) },
            { label: t.music.supportRevenueLabel, value: revenueByType(["support"]) },
          ].map((c) => (
            <div key={c.label} className="flex flex-col">
              <span className="text-xs text-ringo-muted">{c.label}</span>
              <span className="text-sm font-semibold text-ringo-text" suppressHydrationWarning>
                {formatPrice(c.value, currency, locale)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {bestSellers.length > 0 && (
        <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-5">
          <div className="flex flex-col gap-1.5">
            {bestSellers.map((b) => (
              <div key={b.label} className="flex items-center justify-between text-sm">
                <span className="text-ringo-muted">{b.label}</span>
                <span className="text-ringo-text font-medium">{b.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {ticketBreakdown.length > 0 && (
        <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-5">
          <h2 className="text-sm font-medium text-ringo-text mb-3">{t.music.ticketBreakdownHeading}</h2>
          <div className="flex flex-col gap-2">
            {ticketBreakdown.map((tt) => (
              <div key={tt.name} className="flex items-center justify-between text-sm">
                <span className="text-ringo-text">
                  {tt.name} <span className="text-ringo-muted">· {tt.quantity} {t.music.ticketTypeSoldLabel}</span>
                </span>
                <span className="text-ringo-text font-medium" suppressHydrationWarning>
                  {formatPrice(tt.revenue, currency, locale)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-card border border-dashed border-ringo-border p-5">
        <h2 className="text-sm font-medium text-ringo-text mb-1">{t.music.balanceComingSoonTitle}</h2>
        <p className="text-xs text-ringo-muted">{t.music.balanceComingSoonBody}</p>
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
                  <th className="font-normal text-right">{t.music.totalRevenueLabel}</th>
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
