import { requireRestaurantProfile } from "@/lib/restaurantAuth";
import RestaurantOverview from "@/components/restaurant/RestaurantOverview";

export const dynamic = "force-dynamic";

export default async function RestaurantOverviewPage() {
  const { supabase, profile } = await requireRestaurantProfile();

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const { data: todaysOrders } = await supabase
    .from("orders")
    .select("id, status, total")
    .eq("profile_id", profile.id)
    .gte("created_at", startOfToday.toISOString())
    .not("status", "in", "(cancelled,refunded)");

  const { data: recentOrders } = await supabase
    .from("orders")
    .select("id, order_number, status, total, restaurant_tables(label)")
    .eq("profile_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(5);

  // Top-selling over the last 30 days — "today" alone is too sparse for a
  // new restaurant to ever show anything here.
  const since = new Date();
  since.setDate(since.getDate() - 30);
  const { data: recentOrderIds } = await supabase
    .from("orders")
    .select("id")
    .eq("profile_id", profile.id)
    .gte("created_at", since.toISOString())
    .not("status", "in", "(cancelled,refunded)");

  let topSelling: { name: string; qty: number }[] = [];
  if (recentOrderIds && recentOrderIds.length > 0) {
    const { data: lineItems } = await supabase
      .from("order_items")
      .select("item_name_snapshot, quantity")
      .in(
        "order_id",
        recentOrderIds.map((o) => o.id)
      );
    const tally = new Map<string, number>();
    for (const li of lineItems || []) {
      tally.set(li.item_name_snapshot, (tally.get(li.item_name_snapshot) || 0) + li.quantity);
    }
    topSelling = Array.from(tally.entries())
      .map(([name, qty]) => ({ name, qty }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 3);
  }

  return (
    <RestaurantOverview
      restaurantName={profile.name || profile.username}
      currency={profile.currency || "USD"}
      todaysSales={(todaysOrders || []).reduce((sum, o) => sum + Number(o.total), 0)}
      todaysOrderCount={(todaysOrders || []).length}
      pendingCount={(todaysOrders || []).filter((o) => ["pending", "accepted"].includes(o.status)).length}
      completedCount={(todaysOrders || []).filter((o) => ["served", "completed"].includes(o.status)).length}
      recentOrders={recentOrders || []}
      topSelling={topSelling}
    />
  );
}
