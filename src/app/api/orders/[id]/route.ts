import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Public, unauthenticated — same reasoning as /api/signup-requests/[id]/
// pay-status: the order's `id` is a random UUID handed to the customer at
// checkout (in the URL, never listable/enumerable), so knowing it is
// itself the access control. No anon RLS policy on `orders` exists at all
// — this route (admin client) is the only way to read one, and it only
// ever returns the one row matched by that exact id, scoped to its own
// restaurant automatically (a customer of restaurant A can never learn
// anything about restaurant B's orders since they'd need B's order id).
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const admin = createAdminClient();

  const { data: order } = await admin
    .from("orders")
    .select(`*, order_items(*), profiles(name, username, whatsapp_number, currency), restaurant_tables(label)`)
    .eq("id", params.id)
    .maybeSingle();

  if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });

  return NextResponse.json({
    id: order.id,
    order_number: order.order_number,
    status: order.status,
    order_type: order.order_type,
    payment_method: order.payment_method,
    payment_status: order.payment_status,
    subtotal: order.subtotal,
    delivery_fee: order.delivery_fee,
    total: order.total,
    created_at: order.created_at,
    table_label: order.restaurant_tables?.label || null,
    restaurant_name: order.profiles?.name || order.profiles?.username,
    currency: order.profiles?.currency || "USD",
    items: (order.order_items || []).map((i: any) => ({
      name: i.item_name_snapshot,
      price: i.item_price_snapshot,
      quantity: i.quantity,
      line_total: i.line_total,
      notes: i.notes,
    })),
  });
}
