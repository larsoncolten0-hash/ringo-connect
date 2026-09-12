import { requireRestaurantProfile } from "@/lib/restaurantAuth";
import RestaurantOrdersView from "@/components/restaurant/RestaurantOrdersView";

export const dynamic = "force-dynamic";

export default async function RestaurantOrdersPage() {
  const { supabase, profile } = await requireRestaurantProfile();

  const { data: orders } = await supabase
    .from("orders")
    .select("*, order_items(*), restaurant_tables(label)")
    .eq("profile_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(100);

  return <RestaurantOrdersView profileId={profile.id} currency={profile.currency || "USD"} initialOrders={orders || []} />;
}
