import { createClient } from "@/lib/supabase/server";
import { NO_INPUT_SCHEMA, parseNoInput, type AiTool } from "../types";

export const getMyRestaurantSummary: AiTool = {
  name: "get_my_restaurant_summary",
  description:
    "Summarize the user's own restaurant setup: ordering switch and order types, menu size and availability, tables, and orders over the last 30 days by status and type (counts and totals only, no customer details).",
  kind: "read",
  permission: "orders.view",
  available: (s) => s.isRestaurant,
  inputSchema: NO_INPUT_SCHEMA,
  parseInput: parseNoInput,
  async run({ workspace, snapshot }) {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const db = createClient();
    const [ordersRes, tablesRes] = await Promise.all([
      db.from("orders").select("status, order_type, total").eq("profile_id", workspace.profileId).gte("created_at", since).limit(5000),
      db.from("restaurant_tables").select("id", { count: "exact", head: true }).eq("profile_id", workspace.profileId).eq("enabled", true),
    ]);
    if (ordersRes.error) throw new Error(ordersRes.error.message);

    const byStatus: Record<string, number> = {};
    const byType: Record<string, number> = {};
    let total = 0;
    for (const o of ordersRes.data || []) {
      byStatus[o.status] = (byStatus[o.status] || 0) + 1;
      byType[o.order_type] = (byType[o.order_type] || 0) + 1;
      total += Number(o.total) || 0;
    }

    return {
      settings: snapshot.restaurant,
      subcategory: snapshot.profile.restaurantSubcategory,
      menu: {
        categories: snapshot.counts.menuCategories,
        items: snapshot.counts.menuItems,
        available_items: snapshot.counts.availableMenuItems,
      },
      tables: { total: snapshot.counts.restaurantTables, enabled: tablesRes.count ?? null },
      last_30_days: {
        orders: (ordersRes.data || []).length,
        by_status: byStatus,
        by_type: byType,
        order_value_total: total,
        currency: snapshot.profile.currency,
      },
    };
  },
};
