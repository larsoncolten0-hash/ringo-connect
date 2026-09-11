import { requireMusicProfile } from "@/lib/musicAuth";
import MusicSalesView from "@/components/music/MusicSalesView";

export const dynamic = "force-dynamic";

export default async function MusicSalesPage() {
  const { supabase, profile } = await requireMusicProfile();

  const since = new Date();
  since.setDate(since.getDate() - 90);

  // Only paid, non-cancelled/refunded orders count as revenue anywhere on
  // this page — see MusicSalesView's own note on why.
  const { data: orders } = await supabase
    .from("music_orders")
    .select("id, total, created_at")
    .eq("profile_id", profile.id)
    .eq("payment_status", "paid")
    .not("status", "in", "(cancelled,refunded)")
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: false });

  const orderIds = (orders || []).map((o) => o.id);
  let items: { item_type: string; name_snapshot: string; quantity: number; line_total: number; event_id: string | null }[] = [];
  if (orderIds.length > 0) {
    const { data } = await supabase
      .from("music_order_items")
      .select("item_type, name_snapshot, quantity, line_total, event_id")
      .in("order_id", orderIds);
    items = data || [];
  }

  return <MusicSalesView orders={orders || []} items={items} currency={profile.currency || "USD"} />;
}
