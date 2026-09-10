import { requireMusicProfile } from "@/lib/musicAuth";
import MusicOverview from "@/components/music/MusicOverview";

export const dynamic = "force-dynamic";

// Unlike Restaurant's dashboard (a live, per-shift kitchen view), digital
// sales/tickets/support don't happen in a single sitting — so this is an
// all-time summary rather than a "today" snapshot.
export default async function MusicOverviewPage() {
  const { supabase, profile } = await requireMusicProfile();

  const { data: orders } = await supabase
    .from("music_orders")
    .select("id, order_number, status, payment_status, total, customer_name, created_at")
    .eq("profile_id", profile.id)
    .order("created_at", { ascending: false });

  const allOrders = orders || [];
  const liveOrders = allOrders.filter((o) => !["cancelled", "refunded"].includes(o.status));
  const paidOrders = liveOrders.filter((o) => o.payment_status === "paid");

  const orderIds = liveOrders.map((o) => o.id);
  let items: { item_type: string; name_snapshot: string; quantity: number }[] = [];
  if (orderIds.length > 0) {
    const { data } = await supabase
      .from("music_order_items")
      .select("item_type, name_snapshot, quantity")
      .in("order_id", orderIds);
    items = data || [];
  }

  const bestOf = (type: string) => {
    const tally = new Map<string, number>();
    for (const i of items) {
      if (i.item_type !== type) continue;
      tally.set(i.name_snapshot, (tally.get(i.name_snapshot) || 0) + i.quantity);
    }
    const sorted = Array.from(tally.entries()).sort((a, b) => b[1] - a[1]);
    return sorted[0]?.[0] || null;
  };

  return (
    <MusicOverview
      artistName={profile.name || profile.username}
      currency={profile.currency || "USD"}
      totalRevenue={paidOrders.reduce((sum, o) => sum + Number(o.total), 0)}
      totalOrders={liveOrders.length}
      pendingCount={liveOrders.filter((o) => o.payment_status !== "paid").length}
      completedCount={liveOrders.filter((o) => o.status === "completed").length}
      totalItemsSold={items.reduce((sum, i) => sum + i.quantity, 0)}
      recentOrders={allOrders.slice(0, 5)}
      bestSellingSong={bestOf("song")}
      bestSellingRelease={bestOf("release")}
      bestSellingMerch={bestOf("merch")}
    />
  );
}
