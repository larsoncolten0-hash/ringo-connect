import { createClient } from "@/lib/supabase/server";
import { NO_INPUT_SCHEMA, clipText, parseNoInput, type AiTool } from "../types";

export const getMyRestaurantSummary: AiTool = {
  name: "get_my_restaurant_summary",
  description:
    "Summarize the user's own restaurant setup: ordering switch and order types, menu categories (id + name), menu items (up to 30: id, name, price, available), tables, and orders over the last 30 days by status and type (counts and totals only, no customer details). Use a menu item's id with update_menu_item_draft to edit it, or a category's id with create_menu_item_draft to add a new item to it.",
  kind: "read",
  permission: "orders.view",
  available: (s) => s.isRestaurant,
  inputSchema: NO_INPUT_SCHEMA,
  parseInput: parseNoInput,
  async run({ workspace, snapshot }) {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const db = createClient();
    const [ordersRes, tablesRes, itemsRes, categoriesRes] = await Promise.all([
      db.from("orders").select("status, order_type, total").eq("profile_id", workspace.profileId).gte("created_at", since).limit(5000),
      db.from("restaurant_tables").select("id", { count: "exact", head: true }).eq("profile_id", workspace.profileId).eq("enabled", true),
      db.from("menu_items").select("id, name, price, available").eq("profile_id", workspace.profileId).order("sort_order", { ascending: true }).limit(30),
      db.from("menu_categories").select("id, name").eq("profile_id", workspace.profileId).order("sort_order", { ascending: true }).limit(30),
    ]);
    if (ordersRes.error) throw new Error(ordersRes.error.message);
    if (itemsRes.error) throw new Error(itemsRes.error.message);
    if (categoriesRes.error) throw new Error(categoriesRes.error.message);

    const byStatus: Record<string, number> = {};
    const byType: Record<string, number> = {};
    let total = 0;
    for (const o of ordersRes.data || []) {
      byStatus[o.status] = (byStatus[o.status] || 0) + 1;
      byType[o.order_type] = (byType[o.order_type] || 0) + 1;
      // Revenue matches every Dashboard Sales view: cancelled/refunded orders never count.
      if (o.status !== "cancelled" && o.status !== "refunded") total += Number(o.total) || 0;
    }

    return {
      settings: snapshot.restaurant,
      subcategory: snapshot.profile.restaurantSubcategory,
      menu: {
        categories: snapshot.counts.menuCategories,
        category_list: (categoriesRes.data || []).map((c: any) => ({ id: c.id, name: clipText(c.name, 60) })),
        items: snapshot.counts.menuItems,
        available_items: snapshot.counts.availableMenuItems,
        menu_items: (itemsRes.data || []).map((i: any) => ({
          id: i.id,
          name: clipText(i.name, 60),
          price: i.price === null ? null : Number(i.price),
          available: i.available !== false,
        })),
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
