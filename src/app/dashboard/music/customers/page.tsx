import { requireMusicProfile } from "@/lib/musicAuth";
import MusicCustomersView from "@/components/music/MusicCustomersView";

export const dynamic = "force-dynamic";

type Agg = { name: string; phone: string; amount: number; count: number; lastAt: string };

// Top Fans and Top Supporters are computed independently from
// music_order_items, never from music_customers.total_spent — that column
// mixes every kind of spend together, but the brief is explicit: a support
// contribution must never count toward (or get counted as) a product
// purchase in this view, so each needs its own tally straight from the
// line items' item_type.
export default async function MusicCustomersPage() {
  const { supabase, profile } = await requireMusicProfile();

  const { data: orders } = await supabase
    .from("music_orders")
    .select("customer_id, customer_name, customer_phone, created_at, music_order_items(item_type, line_total)")
    .eq("profile_id", profile.id)
    .eq("payment_status", "paid")
    .not("status", "in", "(cancelled,refunded)");

  const fans = new Map<string, Agg>();
  const supporters = new Map<string, Agg>();

  for (const order of orders || []) {
    const key = order.customer_id || order.customer_phone;
    if (!key) continue;

    let fanAmount = 0;
    let supportAmount = 0;
    for (const item of (order.music_order_items as any[]) || []) {
      if (item.item_type === "support") supportAmount += Number(item.line_total);
      else fanAmount += Number(item.line_total);
    }

    if (fanAmount > 0) {
      const existing = fans.get(key) || {
        name: order.customer_name,
        phone: order.customer_phone,
        amount: 0,
        count: 0,
        lastAt: order.created_at,
      };
      existing.amount += fanAmount;
      existing.count += 1;
      if (new Date(order.created_at) > new Date(existing.lastAt)) existing.lastAt = order.created_at;
      fans.set(key, existing);
    }

    if (supportAmount > 0) {
      const existing = supporters.get(key) || {
        name: order.customer_name,
        phone: order.customer_phone,
        amount: 0,
        count: 0,
        lastAt: order.created_at,
      };
      existing.amount += supportAmount;
      existing.count += 1;
      if (new Date(order.created_at) > new Date(existing.lastAt)) existing.lastAt = order.created_at;
      supporters.set(key, existing);
    }
  }

  const topFans = Array.from(fans.values())
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 20);
  const topSupporters = Array.from(supporters.values())
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 20);

  return <MusicCustomersView topFans={topFans} topSupporters={topSupporters} currency={profile.currency || "USD"} />;
}
