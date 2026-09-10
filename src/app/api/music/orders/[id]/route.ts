import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Public, unauthenticated — same reasoning as the restaurant equivalent:
// the order's `id` is a random UUID handed to the fan at checkout, never
// listable, so knowing it is itself the access control.
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const admin = createAdminClient();

  const { data: order } = await admin
    .from("music_orders")
    .select(`*, music_order_items(*), profiles(name, username, currency)`)
    .eq("id", params.id)
    .maybeSingle();

  if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });

  return NextResponse.json({
    id: order.id,
    order_number: order.order_number,
    status: order.status,
    payment_method: order.payment_method,
    payment_status: order.payment_status,
    subtotal: order.subtotal,
    total: order.total,
    created_at: order.created_at,
    artist_name: order.profiles?.name || order.profiles?.username,
    currency: order.profiles?.currency || "USD",
    items: (order.music_order_items || []).map((i: any) => ({
      id: i.id,
      item_type: i.item_type,
      track_id: i.track_id,
      name: i.name_snapshot,
      price: i.price_snapshot,
      quantity: i.quantity,
      line_total: i.line_total,
    })),
  });
}
