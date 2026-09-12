import { requireMusicProfile } from "@/lib/musicAuth";
import MusicOrdersView from "@/components/music/MusicOrdersView";

export const dynamic = "force-dynamic";

export default async function MusicOrdersPage() {
  const { supabase, profile } = await requireMusicProfile();

  const { data: orders } = await supabase
    .from("music_orders")
    .select("*, music_order_items(*)")
    .eq("profile_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(100);

  return <MusicOrdersView profileId={profile.id} currency={profile.currency || "USD"} initialOrders={orders || []} />;
}
