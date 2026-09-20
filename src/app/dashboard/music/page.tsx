import { requireMusicProfile } from "@/lib/musicAuth";
import MusicOverview, { type MusicEarningsSnapshot, type MusicRankedCustomer } from "@/components/music/MusicOverview";
import { getMyMusicEarningsOverview } from "@/lib/musicEarnings";

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

  // Snapshots of the other Sales tabs (Sales, Customers, Earnings), each linking to its page.
  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const paidBetween = (from: number, to: number) =>
    paidOrders.filter((o) => {
      const at = new Date(o.created_at).getTime();
      return at >= from && at < to;
    });
  const sum = (rows: { total: number }[]) => rows.reduce((total, o) => total + Number(o.total), 0);
  const last7 = paidBetween(now - 7 * DAY, now + 1);
  const salesSnapshot = {
    todayRevenue: sum(paidBetween(startOfToday.getTime(), now + 1)),
    last7Revenue: sum(last7),
    prev7Revenue: sum(paidBetween(now - 14 * DAY, now - 7 * DAY)),
    last7Orders: last7.length,
  };

  // Same rule as the Customers page: a support contribution never counts toward a fan's total.
  const { data: paidWithItems } = await supabase
    .from("music_orders")
    .select("customer_id, customer_name, customer_phone, music_order_items(item_type, line_total)")
    .eq("profile_id", profile.id)
    .eq("payment_status", "paid")
    .not("status", "in", "(cancelled,refunded)");
  const fans = new Map<string, MusicRankedCustomer>();
  const supporters = new Map<string, MusicRankedCustomer>();
  for (const order of paidWithItems || []) {
    const key = order.customer_id || order.customer_phone;
    if (!key) continue;
    let fanAmount = 0;
    let supportAmount = 0;
    for (const item of (order.music_order_items as any[]) || []) {
      if (item.item_type === "support") supportAmount += Number(item.line_total);
      else fanAmount += Number(item.line_total);
    }
    const name = order.customer_name || order.customer_phone || "";
    if (fanAmount > 0) fans.set(key, { name, amount: (fans.get(key)?.amount || 0) + fanAmount });
    if (supportAmount > 0) supporters.set(key, { name, amount: (supporters.get(key)?.amount || 0) + supportAmount });
  }
  const top3 = (m: Map<string, MusicRankedCustomer>) => Array.from(m.values()).sort((a, b) => b.amount - a.amount).slice(0, 3);

  let earnings: MusicEarningsSnapshot[] | null = null;
  try {
    const overview = await getMyMusicEarningsOverview();
    if (overview) {
      earnings = Object.entries(overview.totalsByCurrency).map(([currency, totals]) => ({
        currency,
        available: totals.available,
        pending: totals.pending + totals.requested,
        paid: totals.paid,
      }));
    }
  } catch {
    // Earnings tables unavailable: the card is simply hidden.
  }

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
      salesSnapshot={salesSnapshot}
      topFans={top3(fans)}
      topSupporters={top3(supporters)}
      earnings={earnings}
    />
  );
}
