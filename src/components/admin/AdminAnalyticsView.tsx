"use client";

import { useMemo } from "react";
import { Users, DollarSign, TrendingUp, Activity } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid } from "recharts";
import { buildTrendData, getPresetRange } from "@/lib/dateRanges";
import { formatPrice } from "@/lib/currency";
import StatCard from "@/components/analytics/StatCard";
import RankedBarList from "@/components/analytics/RankedBarList";

export default function AdminAnalyticsView({
  users,
  transactions,
  events,
  recentTransactions,
}: {
  users: any[];
  transactions: any[];
  events: any[];
  recentTransactions: any[];
}) {
  const creators = useMemo(() => users.filter((u) => u.role === "creator"), [users]);

  const planBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    creators.forEach((u) => {
      const name = u.plans?.name || "free";
      counts[name] = (counts[name] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);
  }, [creators]);

  const revenue = useMemo(() => {
    const byCurrency: Record<string, number> = {};
    transactions
      .filter((t) => t.status === "success")
      .forEach((t) => {
        byCurrency[t.currency] = (byCurrency[t.currency] || 0) + Number(t.amount);
      });
    return byCurrency;
  }, [transactions]);

  const revenueByProvider = useMemo(() => {
    const counts: Record<string, number> = {};
    transactions
      .filter((t) => t.status === "success")
      .forEach((t) => {
        counts[t.provider] = (counts[t.provider] || 0) + Number(t.amount);
      });
    return Object.entries(counts).map(([label, count]) => ({ label, count: Math.round(count) }));
  }, [transactions]);

  const eventTotals = useMemo(
    () => ({
      page: events.filter((e) => e.target_type === "page").length,
      link: events.filter((e) => e.target_type === "link").length,
      product: events.filter((e) => e.target_type === "product").length,
      whatsapp: events.filter((e) => e.target_type === "whatsapp").length,
    }),
    [events]
  );

  const signupTrend = useMemo(() => {
    const range = getPresetRange("last30");
    return buildTrendData(creators, range);
  }, [creators]);

  return (
    <div className="max-w-5xl flex flex-col gap-5">
      <h1 className="font-display text-xl font-medium text-ringo-text tracking-[-0.01em]">Platform analytics</h1>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total creators" value={creators.length} icon={Users} accent="indigo" />
        <StatCard
          label="Revenue (USD)"
          value={formatPrice(revenue.USD || 0, "USD")}
          icon={DollarSign}
          accent="teal"
        />
        <StatCard
          label="Revenue (XAF)"
          value={formatPrice(revenue.XAF || 0, "XAF")}
          icon={DollarSign}
          accent="coral"
        />
        <StatCard label="Total page views" value={eventTotals.page} icon={Activity} accent="slate" />
      </div>

      <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-4 sm:p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <p className="text-sm font-medium text-ringo-text tracking-[-0.01em] mb-4 flex items-center gap-1.5">
          <TrendingUp size={14} className="text-ringo-indigo" /> New creators — last 30 days
        </p>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={signupTrend}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--ringo-border)" />
              <XAxis
                dataKey="day"
                tick={{ fontSize: 11 }}
                tickFormatter={(v) => new Date(v).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                interval="preserveStartEnd"
              />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={30} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Bar dataKey="count" fill="#4F46E5" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-4 sm:p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <p className="text-sm font-medium text-ringo-text tracking-[-0.01em] mb-4">Creators by plan</p>
          <RankedBarList items={planBreakdown} emptyLabel="No creators yet." />
        </div>
        <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-4 sm:p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <p className="text-sm font-medium text-ringo-text tracking-[-0.01em] mb-4">Revenue by provider (rounded)</p>
          <RankedBarList items={revenueByProvider} emptyLabel="No successful payments yet." />
        </div>
      </div>

      <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-4 sm:p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <p className="text-sm font-medium text-ringo-text tracking-[-0.01em] mb-4">Platform-wide activity</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <StatCard label="Link clicks" value={eventTotals.link} icon={Activity} accent="indigo" />
          <StatCard label="Product clicks" value={eventTotals.product} icon={Activity} accent="teal" />
          <StatCard label="WhatsApp clicks" value={eventTotals.whatsapp} icon={Activity} accent="coral" />
        </div>
      </div>

      <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-4 sm:p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-x-auto">
        <p className="text-sm font-medium text-ringo-text tracking-[-0.01em] mb-4">Recent transactions</p>
        <table className="w-full text-sm min-w-[560px]">
          <thead>
            <tr className="text-left text-ringo-muted border-b border-ringo-border/70">
              <th className="py-2 font-normal">Creator</th>
              <th className="font-normal">Plan</th>
              <th className="font-normal">Provider</th>
              <th className="font-normal">Amount</th>
              <th className="font-normal">Status</th>
              <th className="font-normal">Date</th>
            </tr>
          </thead>
          <tbody>
            {recentTransactions.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-6 text-center text-ringo-muted">
                  No transactions yet.
                </td>
              </tr>
            ) : (
              recentTransactions.map((tx) => (
                <tr key={tx.id} className="border-b border-ringo-border/40">
                  <td className="py-2 text-ringo-text">{tx.users?.email || "—"}</td>
                  <td className="capitalize text-ringo-text">{tx.plan_name}</td>
                  <td className="capitalize text-ringo-text">{tx.provider}</td>
                  <td className="text-ringo-text">{formatPrice(tx.amount, tx.currency)}</td>
                  <td>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        tx.status === "success"
                          ? "bg-ringo-teal/10 text-ringo-teal"
                          : tx.status === "failed"
                          ? "bg-red-500/10 text-red-500"
                          : "bg-ringo-muted/10 text-ringo-muted"
                      }`}
                    >
                      {tx.status}
                    </span>
                  </td>
                  <td className="text-ringo-muted">{new Date(tx.created_at).toLocaleDateString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}