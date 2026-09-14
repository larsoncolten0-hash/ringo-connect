"use client";

import { useMemo } from "react";
import { Users, Radio, Activity, Smartphone, TrendingUp, Globe2, ArrowDownRight } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid } from "recharts";
import { buildTrendData, getPresetRange } from "@/lib/dateRanges";
import { getRegionName } from "@/lib/geo";
import { ONLINE_WINDOW_MINUTES, DAILY_ACTIVE_WINDOW_HOURS, CHURN_TRACKING_STARTED_AT } from "@/lib/adminUserActivity";
import StatCard from "@/components/analytics/StatCard";
import RankedBarList from "@/components/analytics/RankedBarList";

export default function AdminUsersAnalytics({
  users,
  plans,
  countryEvents,
  churnRows,
}: {
  users: any[];
  plans: any[];
  countryEvents: { country: string | null }[];
  churnRows: { action: string; created_at: string }[];
}) {
  const creators = useMemo(() => users.filter((u) => u.role === "creator"), [users]);

  const onlineCount = useMemo(
    () =>
      creators.filter(
        (u) =>
          u.last_active_at && Date.now() - new Date(u.last_active_at).getTime() <= ONLINE_WINDOW_MINUTES * 60 * 1000
      ).length,
    [creators]
  );
  const dailyActiveCount = useMemo(
    () =>
      creators.filter(
        (u) =>
          u.last_active_at &&
          Date.now() - new Date(u.last_active_at).getTime() <= DAILY_ACTIVE_WINDOW_HOURS * 60 * 60 * 1000
      ).length,
    [creators]
  );
  const pwaInstalledCount = useMemo(() => creators.filter((u) => u.pwa_installed_at).length, [creators]);
  // "Currently using as installed app" — standalone AND recently active,
  // not "ever pinged standalone once," so a stale flag from months ago
  // doesn't count as someone "currently" doing anything.
  const standaloneNowCount = useMemo(
    () =>
      creators.filter(
        (u) =>
          u.last_active_standalone &&
          u.last_active_at &&
          Date.now() - new Date(u.last_active_at).getTime() <= DAILY_ACTIVE_WINDOW_HOURS * 60 * 60 * 1000
      ).length,
    [creators]
  );

  const planBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    creators.forEach((u) => {
      counts[u.plan_id] = (counts[u.plan_id] || 0) + 1;
    });
    // Every one of the current plans shown even at zero (cheapest first),
    // rather than only whichever plans happen to have a subscriber today.
    return plans
      .slice()
      .sort((a, b) => (a.price_usd ?? 0) - (b.price_usd ?? 0))
      .map((p) => ({ label: p.display_name || p.name, count: counts[p.id] || 0 }));
  }, [creators, plans]);

  const categoryBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    creators.forEach((u) => {
      const category = u.profiles?.[0]?.category as string | null | undefined;
      const label = category ? category.replace(/_/g, " ") : "Uncategorized";
      counts[label] = (counts[label] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);
  }, [creators]);

  const signupTrend = useMemo(() => buildTrendData(creators, getPresetRange("last30")), [creators]);

  // Platform-wide visitor geography — click_events.country across every
  // creator's page, not "where creators themselves are" (no such field
  // exists in this schema). Same data source and getRegionName() helper
  // the per-creator analytics page already uses.
  const geoBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    countryEvents.forEach((e) => {
      if (!e.country) return;
      counts[e.country] = (counts[e.country] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([code, count]) => ({ label: getRegionName(code), count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [countryEvents]);

  const churn = useMemo(() => {
    return {
      expired: churnRows.filter((r) => r.action === "plan_expired_downgrade").length,
      organic: churnRows.filter((r) => r.action === "self_downgrade").length,
    };
  }, [churnRows]);

  return (
    <div className="max-w-5xl flex flex-col gap-5">
      <div>
        <h1 className="font-display text-xl font-medium text-ringo-text tracking-[-0.01em]">User analytics</h1>
        <p className="text-sm text-ringo-muted mt-0.5">Engagement, installs, and plan activity across all creators.</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total creators" value={creators.length} icon={Users} accent="indigo" />
        <StatCard label={`Active <${ONLINE_WINDOW_MINUTES}m*`} value={onlineCount} icon={Radio} accent="teal" />
        <StatCard label="Daily active (24h)*" value={dailyActiveCount} icon={Activity} accent="coral" />
        <StatCard label="Installed PWA, ever†" value={pwaInstalledCount} icon={Smartphone} accent="slate" />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-4 sm:p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <p className="text-sm font-medium text-ringo-text tracking-[-0.01em] mb-4">Creators by plan</p>
          <RankedBarList items={planBreakdown} emptyLabel="No creators yet." />
        </div>
        <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-4 sm:p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <p className="text-sm font-medium text-ringo-text tracking-[-0.01em] mb-4">Category distribution</p>
          <RankedBarList items={categoryBreakdown} emptyLabel="No categorized profiles yet." />
        </div>
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
          <p className="text-sm font-medium text-ringo-text tracking-[-0.01em] mb-4 flex items-center gap-1.5">
            <Globe2 size={14} className="text-ringo-indigo" /> Visitor geography (all creator pages)
          </p>
          <RankedBarList items={geoBreakdown} emptyLabel="No click data yet." />
        </div>

        <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-4 sm:p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] flex flex-col gap-4">
          <p className="text-sm font-medium text-ringo-text tracking-[-0.01em] flex items-center gap-1.5">
            <ArrowDownRight size={14} className="text-ringo-indigo" /> Downgrades to Free
          </p>
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="Expiry-driven (auto)" value={churn.expired} icon={ArrowDownRight} accent="coral" />
            <StatCard label="Self-serve‡" value={churn.organic} icon={ArrowDownRight} accent="slate" />
          </div>
          <p className="text-xs text-ringo-muted">
            ‡ Self-serve downgrades only became trackable starting {CHURN_TRACKING_STARTED_AT} — billing/cancel
            previously wrote no audit trail at all. There is no reliable count before that date, and none has been
            estimated here.
          </p>
        </div>
      </div>

      <div className="rounded-card border border-ringo-border/70 bg-ringo-surface/60 p-4 text-xs text-ringo-muted flex flex-col gap-1.5">
        <p>
          * "Active" figures use last_active_at, a periodic activity timestamp updated on real dashboard/admin use —
          this app has no real-time presence system, so these are polling-based proxies, never a live connection
          count.
        </p>
        <p>
          † Counts only browsers that fired the standard <code>appinstalled</code> event, which iOS Safari never
          fires — this figure undercounts iOS users who added the app to their home screen manually. "Currently
          using as installed app" ({standaloneNowCount} in the last {DAILY_ACTIVE_WINDOW_HOURS}h) is a separate,
          display-mode-based signal that does catch those iOS sessions.
        </p>
      </div>
    </div>
  );
}
