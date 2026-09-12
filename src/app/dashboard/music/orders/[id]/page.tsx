import { notFound } from "next/navigation";
import { requireMusicProfile } from "@/lib/musicAuth";
import MusicReceiptView from "@/components/music/MusicReceiptView";

export const dynamic = "force-dynamic";

export default async function MusicOrderReceiptPage({ params }: { params: { id: string } }) {
  const { supabase, profile } = await requireMusicProfile();

  // RLS ("music_orders owner all") already scopes this to the logged-in
  // creator's own profile_id — the .eq below is defense in depth, not the
  // actual security boundary.
  const { data: order } = await supabase
    .from("music_orders")
    .select("*, music_order_items(*)")
    .eq("id", params.id)
    .eq("profile_id", profile.id)
    .maybeSingle();

  if (!order) return notFound();

  return <MusicReceiptView artistName={profile.name || profile.username} currency={profile.currency || "USD"} order={order} />;
}
