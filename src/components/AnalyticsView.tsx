"use client";

import { useEffect, useMemo, useState } from "react";
import { Eye, MousePointerClick, ShoppingBag, MessageCircle, Lock } from "lucide-react";
import Link from "next/link";
import { useLanguage } from "@/components/LanguageProvider";
import { getPresetRange, buildTrendData, type DateRange } from "@/lib/dateRanges";
import { getRegionName, getReferrerSource } from "@/lib/geo";
import DateRangePicker from "@/components/analytics/DateRangePicker";
import StatCard from "@/components/analytics/StatCard";
import TrendChart from "@/components/analytics/TrendChart";
import RankedBarList from "@/components/analytics/RankedBarList";

type ClickEvent = {
  target_type: "page" | "link" | "product" | "whatsapp";
  target_id: string | null;
  referrer: string | null;
  country: string | null;
  created_at: string;
};

// Defined once, outside the component — a stable fallback reference for
// when a prop arrives undefined. Using `events = []` as a default
// parameter instead would create a NEW array on every render whenever
// the prop is undefined, which is exactly what caused the infinite loop
// last time. This constant never changes identity, so it's safe to use
// inside a useMemo dependency array.
const EMPTY_EVENTS: ClickEvent[] = [];
const EMPTY_LINKS: { id: string; title: string }[] = [];
const EMPTY_PRODUCTS: { id: string; name: string }[] = [];

export default function AnalyticsView({
  events,
  links,
  products,
  fullAnalyticsEnabled,
}: {
  events: ClickEvent[] | undefined | null;
  links: { id: string; title: string }[] | undefined | null;
  products: { id: string; name: string }[] | undefined | null;
  fullAnalyticsEnabled: boolean;
}) {
  const { t } = useLanguage();
  const [range, setRange] = useState<DateRange>(() => getPresetRange("last30"));
  const safeEvents = events ?? EMPTY_EVENTS;
  const safeLinks = links ?? EMPTY_LINKS;
  const safeProducts = products ?? EMPTY_PRODUCTS;

  // Country codes resolve to full names only after mount — Intl.DisplayNames
  // pulls from the runtime's ICU data, which can differ between Node's
  // server-side ICU and the browser's, causing a hydration mismatch if
  // resolved during the render Next.js compares against server HTML.
  const [regionNames, setRegionNames] = useState<Record<string, string>>({});

  // Free plan sees all-time totals only — no date filtering, no history.
  // Forcing the range to "allTime" here (rather than just hiding the
  // picker) means the stat cards below reflect the account's real
  // lifetime totals regardless of what range state would otherwise be.
  const effectiveRange = fullAnalyticsEnabled ? range : getPresetRange("allTime");

  const filtered = useMemo(
    () =>
      safeEvents.filter((e) => {
        const time = new Date(e.created_at).getTime();
        return time >= effectiveRange.from.getTime() && time <= effectiveRange.to.getTime();
      }),
    [safeEvents, effectiveRange]
  );

  useEffect(() => {
    if (!fullAnalyticsEnabled) return; // locations aren't shown on the basic view
    const codes = new Set(filtered.map((e) => e.country).filter(Boolean) as string[]);
    setRegionNames((prev) => {
      // Skip the update entirely if every code we need is already resolved —
      // prevents calling setState with a "new" object every render when
      // nothing has actually changed, which is what turns a re-render into
      // an infinite loop.
      const missing = [...codes].some((code) => !(code in prev));
      if (!missing) return prev;

      const next = { ...prev };
      codes.forEach((code) => {
        if (!(code in next)) next[code] = getRegionName(code);
      });
      return next;
    });
  }, [filtered, fullAnalyticsEnabled]);

  const totals = useMemo(
    () => ({
      page: filtered.filter((e) => e.target_type === "page").length,
      link: filtered.filter((e) => e.target_type === "link").length,
      product: filtered.filter((e) => e.target_type === "product").length,
      whatsapp: filtered.filter((e) => e.target_type === "whatsapp").length,
    }),
    [filtered]
  );

  const trendData = useMemo(() => buildTrendData(filtered, effectiveRange), [filtered, effectiveRange]);

  const topLinks = useMemo(() => {
    const counts: Record<string, number> = {};
    filtered
      .filter((e) => e.target_type === "link" && e.target_id)
      .forEach((e) => {
        counts[e.target_id!] = (counts[e.target_id!] || 0) + 1;
      });
    return Object.entries(counts)
      .map(([id, count]) => ({
        label: safeLinks.find((l) => l.id === id)?.title || t.editor.untitledLink,
        count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [filtered, safeLinks, t]);

  const topProducts = useMemo(() => {
    const counts: Record<string, number> = {};
    filtered
      .filter((e) => e.target_type === "product" && e.target_id)
      .forEach((e) => {
        counts[e.target_id!] = (counts[e.target_id!] || 0) + 1;
      });
    return Object.entries(counts)
      .map(([id, count]) => ({
        label: safeProducts.find((p) => p.id === id)?.name || t.editor.untitledProduct,
        count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [filtered, safeProducts, t]);

  const topSources = useMemo(() => {
    const counts: Record<string, number> = {};
    filtered.forEach((e) => {
      const source = getReferrerSource(e.referrer, t.analytics.direct);
      counts[source] = (counts[source] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [filtered, t]);

  const topLocations = useMemo(() => {
    const counts: Record<string, number> = {};
    filtered.forEach((e) => {
      const code = e.country || "__unknown";
      counts[code] = (counts[code] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([code, count]) => ({
        label: code === "__unknown" ? t.analytics.unknown : regionNames[code] || code,
        count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [filtered, regionNames, t]);

  return (
    <div className="flex flex-col gap-5 max-w-5xl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h1 className="font-display text-xl font-medium text-ringo-text tracking-[-0.01em]">{t.analytics.overview}</h1>
        {fullAnalyticsEnabled && <DateRangePicker value={range} onChange={setRange} />}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label={t.analytics.pageViews} value={totals.page} icon={Eye} accent="indigo" />
        <StatCard label={t.analytics.linkClicks} value={totals.link} icon={MousePointerClick} accent="teal" />
        <StatCard label={t.analytics.productClicks} value={totals.product} icon={ShoppingBag} accent="slate" />
        <StatCard label={t.analytics.whatsappClicks} value={totals.whatsapp} icon={MessageCircle} accent="coral" />
      </div>

      {!fullAnalyticsEnabled ? (
        <div className="rounded-card border border-dashed border-ringo-border p-8 flex flex-col items-center text-center gap-3">
          <span className="w-10 h-10 rounded-full bg-ringo-indigo/10 flex items-center justify-center">
            <Lock size={16} className="text-ringo-indigo" />
          </span>
          <div>
            <p className="text-sm font-medium text-ringo-text mb-1">{t.analytics.basicAnalyticsTitle}</p>
            <p className="text-sm text-ringo-muted max-w-sm">{t.analytics.basicAnalyticsBody}</p>
          </div>
          <Link
            href="/dashboard/subscription"
            className="text-xs font-medium px-3.5 py-2 rounded-card bg-ringo-indigo text-white mt-1"
          >
            {t.sidebar.upgradePlan}
          </Link>
        </div>
      ) : (
        <>
          <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-4 sm:p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <p className="text-sm font-medium text-ringo-text tracking-[-0.01em] mb-4">{t.analytics.clicksOverTime}</p>
            <TrendChart data={trendData} />
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-4 sm:p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              <p className="text-sm font-medium text-ringo-text tracking-[-0.01em] mb-4">{t.analytics.topLinks}</p>
              <RankedBarList items={topLinks} emptyLabel={t.analytics.noLinkClicks} />
            </div>
            <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-4 sm:p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              <p className="text-sm font-medium text-ringo-text tracking-[-0.01em] mb-4">{t.analytics.topProducts}</p>
              <RankedBarList items={topProducts} emptyLabel={t.analytics.noProductClicks} />
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-4 sm:p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              <p className="text-sm font-medium text-ringo-text tracking-[-0.01em] mb-4">{t.analytics.trafficSources}</p>
              <RankedBarList items={topSources} emptyLabel={t.analytics.noSources} />
            </div>
            <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-4 sm:p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              <p className="text-sm font-medium text-ringo-text tracking-[-0.01em] mb-4">{t.analytics.locations}</p>
              <RankedBarList items={topLocations} emptyLabel={t.analytics.noLocations} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}