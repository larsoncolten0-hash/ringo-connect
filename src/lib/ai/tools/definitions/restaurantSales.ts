import { createClient } from "@/lib/supabase/server";
import { BI_PERIODS, bucketByUtcDay, clampLimit, isBiPeriod, resolvePeriod, type BiPeriod } from "../period";
import { clipText, type AiTool } from "../types";

// Read-only business intelligence for restaurant orders (Phase 4 increment
// 4). Revenue/order_count come from `orders.total` — NEVER re-summed from
// order_items, because `total` also includes delivery_fee, which line
// items don't carry. `cancelled`/`refunded` orders are excluded from
// revenue/counts (matching every human Dashboard Sales page) but still
// visible in `by_status` so cancellation activity isn't hidden. `top_items`
// groups by `item_name_snapshot` (survives a since-deleted menu item),
// never a live join to menu_items. No customer name/phone/email/id is ever
// selected.

const MAX_ORDERS = 5000;
const REVENUE_EXCLUDED_STATUSES = new Set(["cancelled", "refunded"]);

export const getMyRestaurantSales: AiTool<{ period: BiPeriod; limit: number }> = {
  name: "get_my_restaurant_sales",
  description:
    "Get verified restaurant order revenue for a period: total revenue, order count, a daily trend, orders by status and by order type (dine-in/takeaway/delivery), and the top-selling menu items by revenue. Revenue excludes cancelled/refunded orders. Aggregates only — no customer names, phone numbers or individual orders.",
  kind: "read",
  permission: "sales.view",
  available: (s) => s.isRestaurant,
  inputSchema: {
    type: "object",
    properties: {
      period: { type: "string", enum: [...BI_PERIODS], description: "today | yesterday | 7d | 30d | this_month | previous_month." },
      limit: { type: "number", description: "How many top items to return (1-10). Server clamps this regardless of what's asked." },
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
    const { data, error } = await createClient()
      .from("orders")
      .select("id, status, order_type, total, created_at")
      .eq("profile_id", workspace.profileId)
      .gte("created_at", range.start.toISOString())
      .lt("created_at", range.end.toISOString())
      .limit(MAX_ORDERS);
    if (error) throw new Error(error.message);

    const orders = data || [];
    const byStatus: Record<string, number> = {};
    for (const o of orders) byStatus[o.status] = (byStatus[o.status] || 0) + 1;

    const eligible = orders.filter((o: any) => !REVENUE_EXCLUDED_STATUSES.has(o.status));
    const totalRevenue = eligible.reduce((sum: number, o: any) => sum + (Number(o.total) || 0), 0);

    const byType: Record<string, { orders: number; revenue: number }> = {};
    for (const o of eligible as any[]) {
      const key = o.order_type || "unknown";
      byType[key] = byType[key] || { orders: 0, revenue: 0 };
      byType[key].orders += 1;
      byType[key].revenue += Number(o.total) || 0;
    }

    const trend = bucketByUtcDay(
      eligible as any[],
      (o) => o.created_at,
      (o) => ({ revenue: Number(o.total) || 0, order_count: 1 })
    );

    const eligibleIds = (eligible as any[]).map((o) => o.id);
    let topItems: { name: string | null; revenue: number; quantity: number }[] = [];
    if (eligibleIds.length > 0) {
      const { data: items, error: itemsError } = await createClient()
        .from("order_items")
        .select("item_name_snapshot, quantity, line_total")
        .in("order_id", eligibleIds)
        .limit(MAX_ORDERS * 5);
      if (itemsError) throw new Error(itemsError.message);
      const byName = new Map<string, { revenue: number; quantity: number }>();
      for (const it of items || []) {
        const name = clipText(it.item_name_snapshot, 60) || "Unnamed item";
        const cur = byName.get(name) || { revenue: 0, quantity: 0 };
        cur.revenue += Number(it.line_total) || 0;
        cur.quantity += it.quantity || 0;
        byName.set(name, cur);
      }
      topItems = Array.from(byName.entries())
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
      note: "Revenue excludes cancelled and refunded orders; top_items excludes delivery fees (not attributable to one item).",
      by_status: byStatus,
      by_order_type: byType,
      trend,
      top_items: topItems,
    };
  },
};
