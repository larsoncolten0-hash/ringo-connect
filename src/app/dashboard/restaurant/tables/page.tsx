import { requireRestaurantProfile } from "@/lib/restaurantAuth";
import TablesStatusView from "@/components/restaurant/TablesStatusView";

export const dynamic = "force-dynamic";

export default async function RestaurantTablesPage() {
  const { supabase, profile } = await requireRestaurantProfile();

  const { data: tables } = await supabase
    .from("restaurant_tables")
    .select("*")
    .eq("profile_id", profile.id)
    .order("sort_order");

  const { data: activeOrders } = await supabase
    .from("orders")
    .select("id, order_number, table_id, status, order_items(item_name_snapshot, quantity)")
    .eq("profile_id", profile.id)
    .not("table_id", "is", null)
    .not("status", "in", "(completed,cancelled,refunded)");

  return <TablesStatusView tables={tables || []} activeOrders={activeOrders || []} />;
}
