"use client";

import { ClipboardList, TrendingUp, Users, Wallet } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { formatPrice } from "@/lib/currency";
import { STATUS_COLOR } from "@/lib/orderStatus";
import OverviewSection from "@/components/dashboard/OverviewSection";

export type MusicSalesSnapshot = { todayRevenue: number; last7Revenue: number; prev7Revenue: number; last7Orders: number };
export type MusicRankedCustomer = { name: string; amount: number };
export type MusicEarningsSnapshot = { currency: string; available: number; pending: number; paid: number };

// The Sales section's first page: the headline numbers, then a preview card for each of the
// section's other pages (Orders, Sales, Customers, Earnings), each with a "See more" link.
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
  salesSnapshot,
  topFans,
  topSupporters,
  earnings,
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
  salesSnapshot: MusicSalesSnapshot;
  topFans: MusicRankedCustomer[];
  topSupporters: MusicRankedCustomer[];
  // Null when earnings can't be read (nothing to preview, so the card is hidden).
  earnings: MusicEarningsSnapshot[] | null;
}) {
  const { t, locale } = useLanguage();
  const bestSellers = [
    bestSellingSong && { label: t.music.bestSellingSong, value: bestSellingSong },
    bestSellingRelease && { label: t.music.bestSellingRelease, value: bestSellingRelease },
    bestSellingMerch && { label: t.music.bestSellingMerch, value: bestSellingMerch },
  ].filter(Boolean) as { label: string; value: string }[];

  const trendPct =
    salesSnapshot.prev7Revenue > 0
      ? Math.round(((salesSnapshot.last7Revenue - salesSnapshot.prev7Revenue) / salesSnapshot.prev7Revenue) * 100)
      : null;

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

      <OverviewSection title={t.music.recentOrdersMusic} icon={ClipboardList} href="/dashboard/music/orders">
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
      </OverviewSection>

      <OverviewSection title={t.restaurant.salesTitle} icon={TrendingUp} href="/dashboard/music/sales">
        {totalOrders === 0 && salesSnapshot.last7Revenue === 0 ? (
          <p className="text-sm text-ringo-muted">{t.music.overviewNoSalesYet}</p>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: t.music.overviewToday, value: formatPrice(salesSnapshot.todayRevenue, currency, locale) },
                { label: t.music.overviewLast7Days, value: formatPrice(salesSnapshot.last7Revenue, currency, locale) },
                {
                  label: t.music.overviewAvgOrder,
                  value: formatPrice(salesSnapshot.last7Orders > 0 ? salesSnapshot.last7Revenue / salesSnapshot.last7Orders : 0, currency, locale),
                },
              ].map((m) => (
                <div key={m.label}>
                  <p className="text-xs text-ringo-muted mb-0.5">{m.label}</p>
                  <p className="text-sm font-bold text-ringo-text" suppressHydrationWarning>
                    {m.value}
                  </p>
                </div>
              ))}
            </div>
            {trendPct !== null && (
              <p className={`text-xs font-medium ${trendPct >= 0 ? "text-ringo-teal" : "text-red-500"}`}>{t.music.overviewTrend(trendPct)}</p>
            )}
            {bestSellers.length > 0 && (
              <div className="flex flex-col gap-1.5 pt-3 border-t border-ringo-border/50">
                {bestSellers.map((b) => (
                  <div key={b.label} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-ringo-muted">{b.label}</span>
                    <span className="text-ringo-text font-medium text-right truncate">{b.value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </OverviewSection>

      <OverviewSection title={t.restaurant.customersTitle} icon={Users} href="/dashboard/music/customers">
        {topFans.length === 0 && topSupporters.length === 0 ? (
          <p className="text-sm text-ringo-muted">{t.music.overviewNoCustomers}</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {[
              { title: t.music.overviewTopFans, rows: topFans },
              { title: t.music.overviewTopSupporters, rows: topSupporters },
            ]
              .filter((g) => g.rows.length > 0)
              .map((g) => (
                <div key={g.title}>
                  <p className="text-xs text-ringo-muted mb-1.5">{g.title}</p>
                  {g.rows.map((r, i) => (
                    <div key={`${r.name}-${i}`} className="flex items-center justify-between gap-3 text-sm py-1">
                      <span className="text-ringo-text truncate">
                        {i + 1}. {r.name}
                      </span>
                      <span className="text-ringo-text font-medium shrink-0" suppressHydrationWarning>
                        {formatPrice(r.amount, currency, locale)}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
          </div>
        )}
      </OverviewSection>

      {earnings && (
        <OverviewSection title={t.music.earningsTab} icon={Wallet} href="/dashboard/music/earnings">
          {earnings.length === 0 ? (
            <p className="text-sm text-ringo-muted">{t.music.overviewNoEarnings}</p>
          ) : (
            <div className="flex flex-col gap-3">
              {earnings.map((e) => (
                <div key={e.currency} className="grid grid-cols-3 gap-3">
                  {[
                    { label: t.music.overviewAvailable, value: e.available },
                    { label: t.music.overviewPending, value: e.pending },
                    { label: t.music.overviewPaidOut, value: e.paid },
                  ].map((m) => (
                    <div key={m.label}>
                      <p className="text-xs text-ringo-muted mb-0.5">{m.label}</p>
                      <p className="text-sm font-bold text-ringo-text" suppressHydrationWarning>
                        {formatPrice(m.value, e.currency, locale)}
                      </p>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </OverviewSection>
      )}
    </div>
  );
}
