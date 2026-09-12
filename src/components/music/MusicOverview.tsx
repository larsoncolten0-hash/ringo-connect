"use client";

import Link from "next/link";
import { useLanguage } from "@/components/LanguageProvider";
import { formatPrice } from "@/lib/currency";
import { STATUS_COLOR } from "@/lib/orderStatus";

export default function MusicOverview({
  artistName,
  currency,
  totalRevenue,
  totalOrders,
  pendingCount,
  completedCount,
  totalItemsSold,
  recentOrders,
  bestSellingSong,
  bestSellingRelease,
  bestSellingMerch,
}: {
  artistName: string;
  currency: string;
  totalRevenue: number;
  totalOrders: number;
  pendingCount: number;
  completedCount: number;
  totalItemsSold: number;
  recentOrders: any[];
  bestSellingSong: string | null;
  bestSellingRelease: string | null;
  bestSellingMerch: string | null;
}) {
  const { t, locale } = useLanguage();
  const bestSellers = [
    bestSellingSong && { label: t.music.bestSellingSong, value: bestSellingSong },
    bestSellingRelease && { label: t.music.bestSellingRelease, value: bestSellingRelease },
    bestSellingMerch && { label: t.music.bestSellingMerch, value: bestSellingMerch },
  ].filter(Boolean) as { label: string; value: string }[];

  return (
    <div className="flex flex-col gap-5">
      <h1 className="font-display text-xl font-medium text-ringo-text">{t.music.musicDashboardGreeting(artistName)}</h1>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: t.music.totalRevenueLabel, value: formatPrice(totalRevenue, currency, locale) },
          { label: t.music.totalOrdersLabelMusic, value: String(totalOrders) },
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

      <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-4">
        <p className="text-xs text-ringo-muted mb-1">{t.music.totalItemsSoldLabel}</p>
        <p className="text-lg font-bold text-ringo-text">{totalItemsSold}</p>
      </div>

      <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-ringo-text">{t.music.recentOrdersMusic}</h2>
          <Link href="/dashboard/music/orders" className="text-xs font-medium text-ringo-indigo">
            {t.restaurant.ordersLabel}
          </Link>
        </div>
        {recentOrders.length === 0 && <p className="text-sm text-ringo-muted">{t.restaurant.noOrdersYet}</p>}
        <div className="flex flex-col gap-2">
          {recentOrders.map((o: any) => (
            <div key={o.id} className="flex items-center justify-between text-sm py-1.5 border-b border-ringo-border/50 last:border-0">
              <span className="text-ringo-text">
                #{o.order_number}
                {o.customer_name && <span className="text-ringo-muted"> · {o.customer_name}</span>}
              </span>
              <span className="text-ringo-text font-medium" suppressHydrationWarning>
                {formatPrice(o.total, currency, locale)}
              </span>
              <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${STATUS_COLOR[o.status] || ""}`}>{o.status}</span>
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
    </div>
  );
}
