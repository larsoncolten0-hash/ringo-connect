import { requireRestaurantProfile } from "@/lib/restaurantAuth";
import SalesView from "@/components/restaurant/SalesView";

export const dynamic = "force-dynamic";

export default async function RestaurantSalesPage() {
  const { supabase, profile } = await requireRestaurantProfile();

  const since = new Date();
  since.setDate(since.getDate() - 90);

  const { data: orders } = await supabase
    .from("orders")
    .select("id, order_type, total, created_at")
    .eq("profile_id", profile.id)
    .gte("created_at", since.toISOString())
    .not("status", "in", "(cancelled,refunded)")
    .order("created_at", { ascending: false });

  const orderIds = (orders || []).map((o) => o.id);
  let lineItems: { item_name_snapshot: string; quantity: number }[] = [];
  if (orderIds.length > 0) {
    const { data } = await supabase.from("order_items").select("item_name_snapshot, quantity").in("order_id", orderIds);
    lineItems = data || [];
  }

  return <SalesView orders={orders || []} lineItems={lineItems} currency={profile.currency || "USD"} />;
}
