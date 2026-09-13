import { createAdminClient } from "@/lib/supabase/server";
import { checkAndConfirmFapshiOrder } from "@/lib/musicOrderPayment";
import { formatOrderNumber, formatReceiptNumber } from "@/lib/receiptNumber";

// The one place a music_orders row is turned into "everything a receipt
// needs to render" — shared by the web receipt page
// (src/app/m/[username]/receipt/[id]/page.tsx), the PDF route
// (src/app/api/music/orders/[id]/receipt-pdf/route.ts), and the receipt
// email (sendMusicOrderReceipt.ts), so the three surfaces the spec asks
// to stay in sync (web/PDF/email) are guaranteed to, structurally, by
// sharing this one query and shape rather than three drifting copies of
// it. This is the "reusable receipt engine" scoped to what's actually
// needed today — music orders only (restaurant/booking have their own
// receipt shapes already, see ReceiptView.tsx) — extending to another
// commerce type later means adding a sibling function with this same
// return shape, not forking this one.
//
// Every line item's name/price is read from music_order_items' own
// snapshot columns (name_snapshot/price_snapshot/line_total), never from
// the current tracks/events/products row — so a receipt for an order
// placed before a price change stays historically accurate automatically
// (see PART 21 of the ticket receipt spec), with no extra work here.
export type MusicReceiptData = {
  orderId: string;
  orderNumber: string; // "ORD-000456"
  receiptNumber: string; // "RC-000456"
  createdAt: string;
  paymentStatus: "unpaid" | "paid";
  customerName: string;
  customerEmail: string | null;
  currency: string;
  subtotal: number;
  total: number;
  artistName: string;
  artistUsername: string;
  artistContact: string | null;
  accent: string;
  items: { name: string; quantity: number; unitPrice: number; lineTotal: number }[];
  // Populated only when every ticket line in this order belongs to the
  // SAME event — the common case (a fan buying one event's tickets in one
  // cart). An order mixing ticket lines from two different events (rare —
  // nothing stops adding two different events' tickets to one cart) has
  // no single event to headline, so this stays null and each ticket's own
  // event is identified individually within `tickets` instead.
  event: { title: string; location: string | null; date: string | null; time: string | null } | null;
  tickets: { code: string; attendeeName: string; status: string; ticketTypeName: string; eventTitle: string }[];
};

export async function getMusicReceiptData(orderId: string): Promise<MusicReceiptData | null> {
  const admin = createAdminClient();

  const { data: order } = await admin
    .from("music_orders")
    .select(
      `id, order_number, payment_status, payment_method, pending_fapshi_trans_id, customer_name, customer_email, subtotal, total, created_at,
       music_order_items(id, item_type, event_id, ticket_type_id, name_snapshot, price_snapshot, quantity, line_total,
         digital_tickets(id, ticket_code, attendee_name, status)),
       profiles(id, user_id, name, username, whatsapp_number, currency, theme_color)`
    )
    .eq("id", orderId)
    .maybeSingle();

  if (!order) return null;

  const profile = order.profiles as any;
  if (!profile) return null;

  // Same automatic re-check every other order-facing surface already does
  // (ticket-pass page, MusicStorePage's poll, the scanner) — a receipt
  // opened moments after checkout, before Fapshi has actually confirmed
  // the charge, must not need a reload to pick up "paid" once it clears.
  let paymentStatus = order.payment_status as "unpaid" | "paid";
  if (paymentStatus !== "paid" && order.pending_fapshi_trans_id) {
    try {
      const status = await checkAndConfirmFapshiOrder(admin, order as any);
      if (status === "SUCCESSFUL") paymentStatus = "paid";
    } catch {
      // Fapshi unreachable this request — fall through with the
      // last-known status.
    }
  }

  const items = (order.music_order_items || []) as any[];

  const eventIds = Array.from(new Set(items.filter((i) => i.event_id).map((i) => i.event_id)));
  const { data: events } =
    eventIds.length > 0
      ? await admin.from("events").select("id, title, location, event_date, event_time").in("id", eventIds)
      : { data: [] as any[] };
  const eventById = new Map((events || []).map((e) => [e.id, e]));

  const singleEvent = eventIds.length === 1 ? eventById.get(eventIds[0]) : null;

  const tickets = items.flatMap((item) =>
    (item.digital_tickets || []).map((t: any) => ({
      code: t.ticket_code,
      attendeeName: t.attendee_name,
      status: t.status,
      ticketTypeName: item.name_snapshot,
      eventTitle: eventById.get(item.event_id)?.title || "",
    }))
  );

  return {
    orderId: order.id,
    orderNumber: formatOrderNumber(order.order_number),
    receiptNumber: formatReceiptNumber(order.order_number),
    createdAt: order.created_at,
    paymentStatus,
    customerName: order.customer_name,
    customerEmail: order.customer_email,
    currency: profile.currency || "USD",
    subtotal: Number(order.subtotal),
    total: Number(order.total),
    artistName: profile.name || profile.username,
    artistUsername: profile.username,
    artistContact: profile.whatsapp_number || null,
    accent: profile.theme_color || "#F2B705",
    items: items.map((i) => ({
      name: i.name_snapshot,
      quantity: i.quantity,
      unitPrice: Number(i.price_snapshot),
      lineTotal: Number(i.line_total),
    })),
    event: singleEvent
      ? { title: singleEvent.title, location: singleEvent.location, date: singleEvent.event_date, time: singleEvent.event_time }
      : null,
    tickets,
  };
}
