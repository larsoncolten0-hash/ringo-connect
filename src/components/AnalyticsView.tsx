"use client";

import { useEffect, useMemo, useState } from "react";
import { Eye, MousePointerClick, ShoppingBag, MessageCircle, Lock, TrendingUp, Share2, MapPin, Globe2, ListOrdered } from "lucide-react";
import Link from "next/link";
import { useLanguage } from "@/components/LanguageProvider";
import { getPresetRange, buildTrendData, type DateRange } from "@/lib/dateRanges";
import { getRegionName, getReferrerSource } from "@/lib/geo";
import DateRangePicker from "@/components/analytics/DateRangePicker";
import StatCard from "@/components/analytics/StatCard";
import TrendChart from "@/components/analytics/TrendChart";
import RankedBarList from "@/components/analytics/RankedBarList";
import AnalyticsCard from "@/components/analytics/AnalyticsCard";
import WorldMap, { type CountryMetricCounts } from "@/components/analytics/WorldMap";
import EventsTable from "@/components/analytics/EventsTable";

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

  // Per-country page-view / link-click counts for the choropleth — same
  // `filtered` events the rest of the page already aggregates, just
  // grouped by country instead of by link/product/source.
  const countsByCountry = useMemo(() => {
    const map: Record<string, CountryMetricCounts> = {};
    filtered.forEach((e) => {
      if (!e.country || (e.target_type !== "page" && e.target_type !== "link")) return;
      if (!map[e.country]) map[e.country] = { page: 0, link: 0 };
      map[e.country][e.target_type]++;
    });
    return map;
  }, [filtered]);

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
          <AnalyticsCard icon={TrendingUp} title={t.analytics.clicksOverTime}>
            <TrendChart data={trendData} />
          </AnalyticsCard>

          <AnalyticsCard icon={Globe2} title={t.analytics.worldMapTitle}>
            <WorldMap
              countsByCountry={countsByCountry}
              regionNames={regionNames}
              labels={{ pageViews: t.analytics.pageViews, linkClicks: t.analytics.linkClicks }}
              emptyLabel={t.analytics.noLocations}
            />
          </AnalyticsCard>

          <div className="grid lg:grid-cols-2 gap-4">
            <AnalyticsCard icon={MousePointerClick} title={t.analytics.topLinks}>
              <RankedBarList items={topLinks} emptyLabel={t.analytics.noLinkClicks} />
            </AnalyticsCard>
            <AnalyticsCard icon={ShoppingBag} title={t.analytics.topProducts}>
              <RankedBarList items={topProducts} emptyLabel={t.analytics.noProductClicks} />
            </AnalyticsCard>
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <AnalyticsCard icon={Share2} title={t.analytics.trafficSources}>
              <RankedBarList items={topSources} emptyLabel={t.analytics.noSources} />
            </AnalyticsCard>
            <AnalyticsCard icon={MapPin} title={t.analytics.locations}>
              <RankedBarList items={topLocations} emptyLabel={t.analytics.noLocations} />
            </AnalyticsCard>
          </div>

          <AnalyticsCard icon={ListOrdered} title={t.analytics.recentActivity}>
            <EventsTable
              events={filtered}
              links={safeLinks}
              products={safeProducts}
              regionNames={regionNames}
              labels={{
                type: t.analytics.colType,
                target: t.analytics.colTarget,
                source: t.analytics.colSource,
                location: t.analytics.colLocation,
                time: t.analytics.colTime,
                typeLabels: {
                  page: t.analytics.eventTypePage,
                  link: t.analytics.eventTypeLink,
                  product: t.analytics.eventTypeProduct,
                  whatsapp: t.analytics.eventTypeWhatsapp,
                },
                direct: t.analytics.direct,
                unknown: t.analytics.unknown,
                empty: t.analytics.noEvents,
                of: t.analytics.of,
                itemLabel: t.analytics.eventsLabel,
              }}
            />
          </AnalyticsCard>
        </>
      )}
    </div>
  );
}
