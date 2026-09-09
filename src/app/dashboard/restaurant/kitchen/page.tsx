import { requireRestaurantProfile } from "@/lib/restaurantAuth";
import KitchenView from "@/components/restaurant/KitchenView";

export const dynamic = "force-dynamic";

export default async function RestaurantKitchenPage() {
  const { supabase, profile } = await requireRestaurantProfile();

  const { data: orders } = await supabase
    .from("orders")
    .select("id, order_number, order_type, status, created_at, restaurant_tables(label), order_items(id, item_name_snapshot, quantity, notes)")
    .eq("profile_id", profile.id)
    .in("status", ["pending", "accepted", "preparing", "ready"])
    .order("created_at", { ascending: true });

  return <KitchenView profileId={profile.id} initialOrders={orders || []} />;
}
