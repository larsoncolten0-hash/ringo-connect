import { requireRestaurantProfile } from "@/lib/restaurantAuth";
import { todayKeyOf } from "@/lib/reports/period";
import RestaurantOverview from "@/components/restaurant/RestaurantOverview";

export const dynamic = "force-dynamic";

// Top selling counts the most recent orders of the last 30 days, in chunks, so the lookup stays inside a request URL's length however busy the restaurant is.
const TOP_SELLING_ORDER_CAP = 1000;
const CHUNK = 100;

export default async function RestaurantOverviewPage() {
  const { supabase, profile } = await requireRestaurantProfile();

  // "Today" is the restaurant's day (Africa/Douala, UTC+1 with no daylight saving, the same zone every Business Toolkit figure uses), not the server's
  // midnight. On Vercel the server runs in UTC, so the old boundary put the first hour of every business day into "yesterday".
  const startOfToday = new Date(`${todayKeyOf(new Date())}T00:00:00+01:00`);
  // Top-selling over the last 30 days: "today" alone is too sparse for a new restaurant to ever show anything here.
  const since = new Date();
  since.setDate(since.getDate() - 30);

  // Three independent reads: they used to be awaited one after another (three round trips in a row on the screen an owner opens most).
  const [todays, recent, recentIds] = await Promise.all([
    supabase
      .from("orders")
      .select("id, status, total")
      .eq("profile_id", profile.id)
      .gte("created_at", startOfToday.toISOString())
      .not("status", "in", "(cancelled,refunded)"),
    supabase
      .from("orders")
      .select("id, order_number, status, total, restaurant_tables(label)")
      .eq("profile_id", profile.id)
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("orders")
      .select("id")
      .eq("profile_id", profile.id)
      .gte("created_at", since.toISOString())
      .not("status", "in", "(cancelled,refunded)")
      .order("created_at", { ascending: false })
      .limit(TOP_SELLING_ORDER_CAP),
  ]);

  // The line items for those orders. The ids used to go into ONE `in (...)` filter: with a few hundred orders that URL is too long for the request,
  // the lookup failed and the section silently showed nothing. Chunks of 100 ids, run together, are always valid.
  let topSelling: { name: string; qty: number }[] = [];
  let topFailed = false;
  const ids = (recentIds.data || []).map((o: any) => o.id as string);
  if (ids.length > 0) {
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK));
    const results = await Promise.all(chunks.map((c) => supabase.from("order_items").select("item_name_snapshot, quantity").in("order_id", c)));
    const tally = new Map<string, number>();
    for (const r of results) {
      if (r.error) topFailed = true;
      for (const li of r.data || []) tally.set(li.item_name_snapshot, (tally.get(li.item_name_snapshot) || 0) + li.quantity);
    }
    topSelling = Array.from(tally.entries())
      .map(([name, qty]) => ({ name, qty }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 3);
  }

  const todaysOrders = todays.data || [];
  return (
    <RestaurantOverview
      restaurantName={profile.name || profile.username}
      currency={profile.currency || "USD"}
      todaysSales={todaysOrders.reduce((sum, o) => sum + Number(o.total), 0)}
      todaysOrderCount={todaysOrders.length}
      pendingCount={todaysOrders.filter((o) => ["pending", "accepted"].includes(o.status)).length}
      completedCount={todaysOrders.filter((o) => ["served", "completed"].includes(o.status)).length}
      recentOrders={recent.data || []}
      topSelling={topSelling}
      menuHref={`/r/${profile.username}`}
      // a failed read must not look like a quiet day: zeros are real only when the reads worked
      loadFailed={!!(todays.error || recent.error || recentIds.error || topFailed)}
    />
  );
}
