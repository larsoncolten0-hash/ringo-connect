"use client";

import { useMemo } from "react";
import { Users, UserPlus, Activity, Link2, TrendingUp } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid } from "recharts";
import { buildTrendData, getPresetRange } from "@/lib/dateRanges";
import StatCard from "@/components/analytics/StatCard";
import RankedBarList from "@/components/analytics/RankedBarList";

const DAY = 24 * 60 * 60 * 1000;

// AdminShell is English-only chrome (see AdminAppControls.tsx's own comment
// on that convention) — no useLanguage()/translations.ts here.
export default function AdminCustomersAnalytics({
  customers,
  connections,
  topCreators,
  hiddenTestCustomers,
}: {
  customers: { id: string; created_at: string; last_login_at: string | null; preferred_language: string | null }[];
  connections: { customer_id: string; profile_id: string; status: string; source: string; marketing_consent: boolean }[];
  topCreators: { label: string; count: number }[];
  hiddenTestCustomers: number;
}) {
  const now = Date.now();
  const active = useMemo(() => connections.filter((c) => c.status === "active"), [connections]);
  const newLast30 = useMemo(
    () => customers.filter((c) => now - new Date(c.created_at).getTime() <= 30 * DAY).length,
    [customers, now]
  );
  const activeLast30 = useMemo(
    () => customers.filter((c) => c.last_login_at && now - new Date(c.last_login_at).getTime() <= 30 * DAY).length,
    [customers, now]
  );
  const consentRate = active.length
    ? Math.round((active.filter((c) => c.marketing_consent).length / active.length) * 100)
    : 0;

  const signupTrend = useMemo(() => buildTrendData(customers, getPresetRange("last30")), [customers]);

  const languages = useMemo(() => {
    const counts: Record<string, number> = {};
    customers.forEach((c) => {
      const label = c.preferred_language === "fr" ? "French" : c.preferred_language === "en" ? "English" : "Not set";
      counts[label] = (counts[label] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);
  }, [customers]);

  const sources = useMemo(() => {
    const counts: Record<string, number> = {};
    active.forEach((c) => {
      const label = c.source.replace(/_/g, " ");
      counts[label] = (counts[label] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);
  }, [active]);

  const card =
    "rounded-card border border-ringo-border/70 bg-ringo-surface p-4 sm:p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]";

  return (
    <div className="max-w-5xl flex flex-col gap-5">
      <div>
        <h1 className="font-display text-xl font-medium text-ringo-text tracking-[-0.01em]">Customer analytics</h1>
        <p className="text-sm text-ringo-muted mt-0.5">
          People who sign in to My Ringo and connect with creators — separate from creator analytics.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total customers" value={customers.length} icon={Users} accent="indigo" />
        <StatCard label="New (30 days)" value={newLast30} icon={UserPlus} accent="teal" />
        <StatCard label="Signed in (30 days)" value={activeLast30} icon={Activity} accent="coral" />
        <StatCard label="Active connections" value={active.length} icon={Link2} accent="slate" />
      </div>

      <div className={card}>
        <p className="text-sm font-medium text-ringo-text tracking-[-0.01em] mb-4 flex items-center gap-1.5">
          <TrendingUp size={14} className="text-ringo-indigo" /> New customers — last 30 days
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
        <div className={card}>
          <p className="text-sm font-medium text-ringo-text tracking-[-0.01em] mb-4">Most connected creators</p>
          <RankedBarList items={topCreators} emptyLabel="No connections yet." />
        </div>
        <div className={card}>
          <p className="text-sm font-medium text-ringo-text tracking-[-0.01em] mb-4">How customers connect</p>
          <RankedBarList items={sources} emptyLabel="No connections yet." />
        </div>
        <div className={card}>
          <p className="text-sm font-medium text-ringo-text tracking-[-0.01em] mb-4">Preferred language</p>
          <RankedBarList items={languages} emptyLabel="No customers yet." />
        </div>
        <div className={card}>
          <p className="text-sm font-medium text-ringo-text tracking-[-0.01em] mb-4">Marketing consent</p>
          <StatCard label="Connections opted in" value={`${consentRate}%`} icon={Link2} accent="teal" />
          <p className="text-xs text-ringo-muted mt-3">
            Share of active connections where the customer ticked the marketing consent box.
          </p>
        </div>
      </div>

      <p className="text-xs text-ringo-muted">
        Test customers (only connected to demo accounts) are excluded
        {hiddenTestCustomers > 0 ? ` — ${hiddenTestCustomers} hidden.` : "."}
      </p>
    </div>
  );
}
