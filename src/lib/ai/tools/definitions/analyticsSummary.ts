import { createClient } from "@/lib/supabase/server";
import { countConnectionsSince } from "@/lib/ai/context/scopedCounts";
import { bucketByUtcDay, clampLimit } from "../period";
import { clipText, type AiTool } from "../types";

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

export const getMyAnalyticsSummary: AiTool<{ period: Period; limit: number }> = {
  name: "get_my_analytics_summary",
  description:
    "Get the user's own page analytics for a period: page views, link clicks, product clicks, WhatsApp clicks, top traffic sources (by website), top countries, new connections, a daily click trend, and the most-clicked products. IMPORTANT: product_clicks/top_products are INTEREST signals (clicks), not sales — Ringo doesn't track individual product sales/revenue outside Restaurant (get_my_restaurant_sales) and Music/tickets (get_my_music_sales, get_my_event_sales). If asked for product REVENUE outside those categories, say plainly that it isn't tracked and offer this click data instead of guessing. Aggregated counts only.",
  kind: "read",
  permission: "sales.view",
  inputSchema: {
    type: "object",
    properties: {
      period: { type: "string", enum: ["7d", "30d", "90d"], description: "Time window." },
      limit: { type: "number", description: "How many top products to return (1-10). Server clamps this regardless of what's asked." },
    },
    required: ["period", "limit"],
    additionalProperties: false,
  },
  parseInput: (raw) => {
    const r = raw as { period?: unknown; limit?: unknown } | null;
    const period = r?.period;
    if (period !== "7d" && period !== "30d" && period !== "90d") return null;
    return { period, limit: clampLimit(r?.limit) };
  },
  async run({ workspace, snapshot }, { period, limit }) {
    const since = new Date(Date.now() - DAYS[period] * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await createClient()
      .from("click_events")
      .select("target_type, target_id, referrer, country, created_at")
      .eq("profile_id", workspace.profileId)
      .gte("created_at", since)
      .limit(MAX_EVENTS);
    if (error) throw new Error(error.message);

    const events = data || [];
    const byType: Record<string, number> = { page: 0, link: 0, product: 0, whatsapp: 0 };
    const sources = new Map<string, number>();
    const countries = new Map<string, number>();
    const productClicks = new Map<string, number>();
    for (const e of events) {
      byType[e.target_type] = (byType[e.target_type] || 0) + 1;
      if (e.target_type === "page") {
        const host = hostOf(e.referrer);
        sources.set(host, (sources.get(host) || 0) + 1);
        const c = typeof e.country === "string" && e.country ? e.country.slice(0, 40) : "unknown";
        countries.set(c, (countries.get(c) || 0) + 1);
      } else if (e.target_type === "product" && e.target_id) {
        productClicks.set(e.target_id, (productClicks.get(e.target_id) || 0) + 1);
      }
    }

    const trend = bucketByUtcDay(
      events,
      (e) => e.created_at,
      (e) => ({ clicks: 1, page_views: e.target_type === "page" ? 1 : 0 })
    );

    const rankedProductIds = Array.from(productClicks.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);
    let topProducts: { name: string | null; clicks: number }[] = [];
    if (rankedProductIds.length > 0) {
      const { data: products } = await createClient()
        .from("products")
        .select("id, name")
        .eq("profile_id", workspace.profileId)
        .in(
          "id",
          rankedProductIds.map(([id]) => id)
        );
      const names = new Map((products || []).map((p: any) => [p.id, clipText(p.name, 60)]));
      topProducts = rankedProductIds.map(([id, clicks]) => ({ name: names.get(id) ?? null, clicks }));
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
      capped: events.length >= MAX_EVENTS,
      dashboard_shows_full_history: snapshot.plan.fullAnalyticsEnabled,
      trend,
      top_products_by_clicks: topProducts,
    };
  },
};
