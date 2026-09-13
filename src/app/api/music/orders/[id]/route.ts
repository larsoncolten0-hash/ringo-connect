import { createAdminClient } from "@/lib/supabase/server";
import { checkAndConfirmFapshiOrder } from "@/lib/musicOrderPayment";
import { NextResponse } from "next/server";

// Public, unauthenticated — same reasoning as the restaurant equivalent:
// the order's `id` is a random UUID handed to the fan at checkout, never
// listable, so knowing it is itself the access control.
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const admin = createAdminClient();

  const { data: order } = await admin
    .from("music_orders")
    .select(`*, music_order_items(*, digital_tickets(id, ticket_code, status)), profiles(id, name, username, currency, user_id)`)
    .eq("id", params.id)
    .maybeSingle();

  if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });

  // MusicStorePage's confirmation screen polls this route every 4s for as
  // long as the fan has it open — piggyback a real Fapshi re-check onto
  // that same poll (rather than only the pay route's own short-lived
  // pay-status loop) so a Mobile Money payment that takes longer than that
  // initial window to approve on the fan's phone still unlocks Play/
  // Download the moment it actually goes through, automatically, with no
  // artist confirmation ever required. A no-op for cash/card orders (no
  // pending_fapshi_trans_id) and for one already 'paid'.
  let paymentStatus = order.payment_status;
  if (paymentStatus !== "paid" && order.pending_fapshi_trans_id) {
    try {
      const status = await checkAndConfirmFapshiOrder(admin, order as any);
      if (status === "SUCCESSFUL") paymentStatus = "paid";
    } catch {
      // Fapshi unreachable this tick — keep the last-known status, next
      // poll (4s later) tries again.
    }
  }

  return NextResponse.json({
    id: order.id,
    order_number: order.order_number,
    status: order.status,
    payment_method: order.payment_method,
    payment_status: paymentStatus,
    pending_fapshi_trans_id: order.pending_fapshi_trans_id,
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
      // A ticket line's individual digital passes — one per physical
      // ticket (quantity 3 → 3 codes), each opens its own QR pass page at
      // /m/[username]/ticket-pass/[ticket_code]. Empty for every non-ticket
      // line (digital_tickets is only ever populated for item_type
      // 'ticket' — see /api/music/orders POST).
      tickets: (i.digital_tickets || []).map((dt: any) => ({ id: dt.id, code: dt.ticket_code, status: dt.status })),
    })),
  });
}
