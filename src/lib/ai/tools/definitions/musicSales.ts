import { createClient } from "@/lib/supabase/server";
import { BI_PERIODS, bucketByUtcDay, clampLimit, isBiPeriod, resolvePeriod, type BiPeriod } from "../period";
import { clipText, type AiTool } from "../types";

// Read-only business intelligence for music commerce (Phase 4 increment 4):
// tracks, releases, merch and tips, ALL of which flow through the same
// music_orders/music_order_items tables (ticket revenue is a separate,
// narrower lens — see eventSales.ts). Revenue/order_count require
// payment_status = 'paid' AND status NOT IN (cancelled, refunded) — the
// stricter filter the Dashboard's own Sales/Overview pages already use
// (musicSummary.ts's existing 30-day aggregate was missing the status half
// of this and has been corrected alongside this tool). `top_tracks` groups
// by `name_snapshot` (survives a since-deleted track), never a live join.
// No customer name/email/phone/id is ever selected.

const MAX_ORDERS = 5000;

export const getMyMusicSales: AiTool<{ period: BiPeriod; limit: number }> = {
  name: "get_my_music_sales",
  description:
    "Get verified music commerce revenue for a period: total revenue, order count, a daily trend, revenue broken down by type (song/release/merch/ticket/support), and the top-selling tracks by revenue. Revenue only counts paid, non-cancelled/refunded orders. For ticket-specific numbers (tickets sold, per-event breakdown) use get_my_event_sales instead. Aggregates only — no customer names, emails or individual orders.",
  kind: "read",
  permission: "sales.view",
  available: (s) => s.isMusic,
  inputSchema: {
    type: "object",
    properties: {
      period: { type: "string", enum: [...BI_PERIODS], description: "today | yesterday | 7d | 30d | this_month | previous_month." },
      limit: { type: "number", description: "How many top tracks to return (1-10). Server clamps this regardless of what's asked." },
    },
    required: ["period", "limit"],
    additionalProperties: false,
  },
  parseInput: (raw) => {
    const r = raw as { period?: unknown; limit?: unknown } | null;
    if (!r || !isBiPeriod(r.period)) return null;
    return { period: r.period, limit: clampLimit(r.limit) };
  },
  async run({ workspace, snapshot }, { period, limit }) {
    const range = resolvePeriod(period);
    const db = createClient();
    const { data: orderRows, error } = await db
      .from("music_orders")
      .select("id, payment_status, status, total, created_at")
      .eq("profile_id", workspace.profileId)
      .gte("created_at", range.start.toISOString())
      .lt("created_at", range.end.toISOString())
      .limit(MAX_ORDERS);
    if (error) throw new Error(error.message);

    const orders = orderRows || [];
    const eligible = orders.filter((o: any) => o.payment_status === "paid" && o.status !== "cancelled" && o.status !== "refunded");
    const totalRevenue = eligible.reduce((sum: number, o: any) => sum + (Number(o.total) || 0), 0);
    const trend = bucketByUtcDay(
      eligible as any[],
      (o) => o.created_at,
      (o) => ({ revenue: Number(o.total) || 0, order_count: 1 })
    );

    const eligibleIds = (eligible as any[]).map((o) => o.id);
    let byItemType: Record<string, number> = {};
    let topTracks: { name: string | null; revenue: number; quantity: number }[] = [];
    if (eligibleIds.length > 0) {
      const { data: items, error: itemsError } = await db
        .from("music_order_items")
        .select("item_type, name_snapshot, quantity, line_total")
        .in("order_id", eligibleIds)
        .limit(MAX_ORDERS * 5);
      if (itemsError) throw new Error(itemsError.message);

      for (const it of items || []) {
        const type = it.item_type || "other";
        byItemType[type] = (byItemType[type] || 0) + (Number(it.line_total) || 0);
      }

      const byName = new Map<string, { revenue: number; quantity: number }>();
      for (const it of items || []) {
        if (it.item_type !== "song") continue;
        const name = clipText(it.name_snapshot, 60) || "Untitled track";
        const cur = byName.get(name) || { revenue: 0, quantity: 0 };
        cur.revenue += Number(it.line_total) || 0;
        cur.quantity += it.quantity || 0;
        byName.set(name, cur);
      }
      topTracks = Array.from(byName.entries())
        .map(([name, v]) => ({ name, revenue: v.revenue, quantity: v.quantity }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, limit);
    }

    return {
      period,
      period_label: range.label,
      period_start: range.start.toISOString().slice(0, 10),
      period_end: new Date(range.end.getTime() - 1).toISOString().slice(0, 10),
      currency: snapshot.profile.currency,
      total_revenue: totalRevenue,
      order_count: eligible.length,
      note: "Revenue only counts paid, non-cancelled/refunded orders — covers songs, releases, merch and support/tips together.",
      by_item_type_revenue: byItemType,
      trend,
      top_tracks: topTracks,
    };
  },
};
