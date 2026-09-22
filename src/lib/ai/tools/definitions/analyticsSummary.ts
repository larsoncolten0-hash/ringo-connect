import { createClient } from "@/lib/supabase/server";
import { countConnectionsSince } from "@/lib/ai/context/scopedCounts";
import type { AiTool } from "../types";

type Period = "7d" | "30d" | "90d";
const DAYS: Record<Period, number> = { "7d": 7, "30d": 30, "90d": 90 };
const MAX_EVENTS = 20000;

function hostOf(referrer: unknown): string {
  if (typeof referrer !== "string" || !referrer) return "direct";
  try {
    return new URL(referrer).hostname.replace(/^www\./, "") || "direct";
  } catch {
    return "other";
  }
}

function top(map: Map<string, number>, n: number) {
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key, count]) => ({ key, count }));
}

export const getMyAnalyticsSummary: AiTool<{ period: Period }> = {
  name: "get_my_analytics_summary",
  description:
    "Get the user's own page analytics for a period: page views, link clicks, product clicks, WhatsApp clicks, top traffic sources (by website), top countries, and new connections. Aggregated counts only.",
  kind: "read",
  permission: "sales.view",
  inputSchema: {
    type: "object",
    properties: { period: { type: "string", enum: ["7d", "30d", "90d"], description: "Time window." } },
    required: ["period"],
    additionalProperties: false,
  },
  parseInput: (raw) => {
    const period = (raw as { period?: unknown } | null)?.period;
    return period === "7d" || period === "30d" || period === "90d" ? { period } : null;
  },
  async run({ workspace, snapshot }, { period }) {
    const since = new Date(Date.now() - DAYS[period] * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await createClient()
      .from("click_events")
      .select("target_type, referrer, country")
      .eq("profile_id", workspace.profileId)
      .gte("created_at", since)
      .limit(MAX_EVENTS);
    if (error) throw new Error(error.message);

    const byType: Record<string, number> = { page: 0, link: 0, product: 0, whatsapp: 0 };
    const sources = new Map<string, number>();
    const countries = new Map<string, number>();
    for (const e of data || []) {
      byType[e.target_type] = (byType[e.target_type] || 0) + 1;
      if (e.target_type === "page") {
        const host = hostOf(e.referrer);
        sources.set(host, (sources.get(host) || 0) + 1);
        const c = typeof e.country === "string" && e.country ? e.country.slice(0, 40) : "unknown";
        countries.set(c, (countries.get(c) || 0) + 1);
      }
    }

    return {
      period,
      page_views: byType.page,
      link_clicks: byType.link,
      product_clicks: byType.product,
      whatsapp_clicks: byType.whatsapp,
      top_sources: top(sources, 5),
      top_countries: top(countries, 5),
      new_connections: await countConnectionsSince(workspace.profileId, since),
      capped: (data || []).length >= MAX_EVENTS,
      dashboard_shows_full_history: snapshot.plan.fullAnalyticsEnabled,
    };
  },
};
