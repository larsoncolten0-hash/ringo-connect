import { notFound } from "next/navigation";
import { requireRestaurantProfile } from "@/lib/restaurantAuth";
import ReceiptView from "@/components/restaurant/ReceiptView";

export const dynamic = "force-dynamic";

export default async function OrderReceiptPage({ params }: { params: { id: string } }) {
  const { supabase, profile } = await requireRestaurantProfile();

  // RLS ("orders owner all") already scopes this to the logged-in
  // creator's own profile_id — the .eq below is defense in depth, not the
  // actual security boundary.
  const { data: order } = await supabase
    .from("orders")
    .select("*, order_items(*), restaurant_tables(label)")
    .eq("id", params.id)
    .eq("profile_id", profile.id)
    .maybeSingle();

  if (!order) return notFound();

  return (
    <ReceiptView
      restaurantName={profile.name || profile.username}
      currency={profile.currency || "USD"}
      order={order}
    />
  );
}
