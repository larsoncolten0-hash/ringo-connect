import { createAdminClient } from "@/lib/supabase/server";
import { profileHasCategory } from "@/lib/categories";
import { NextResponse } from "next/server";

type CartLine = {
  item_type: "song" | "release" | "merch" | "ticket" | "support";
  id?: string; // track_id / release_id / product_id / event_id — omitted for 'support'
  // 'ticket' only — which tier of a multi-ticket-type event (see
  // event_ticket_types). Omitted = the event's own legacy single price,
  // exactly as before this existed.
  ticket_type_id?: string;
  quantity?: number;
  amount?: number; // 'support' only — the one case a client-declared number is trusted, same as the public Support Artist widget
};

// Public, unauthenticated — guest checkout, same reasoning as
// /api/orders (restaurant) and /api/signup-requests. Every price except
// a Support Artist amount is re-derived from the database; nothing about
// money comes from the request body except for 'support', which has no
// underlying product to check a price against in the first place (the
// fan is choosing how much to give, exactly like the existing public
// SupportArtistSection already does via a WhatsApp message).
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const admin = createAdminClient();

  const profileId = body?.profile_id;
  const customerName = typeof body?.customer_name === "string" ? body.customer_name.trim() : "";
  const customerPhone = typeof body?.customer_phone === "string" ? body.customer_phone.trim() : "";
  const customerEmail = typeof body?.customer_email === "string" ? body.customer_email.trim() : "";
  const lines: CartLine[] = Array.isArray(body?.items) ? body.items : [];

  if (!profileId) return NextResponse.json({ error: "Invalid order." }, { status: 400 });
  if (!customerName || !customerPhone) {
    return NextResponse.json({ error: "Name and phone number are required." }, { status: 400 });
  }
  if (lines.length === 0) return NextResponse.json({ error: "Your cart is empty." }, { status: 400 });

  const { data: profile } = await admin.from("profiles").select("*").eq("id", profileId).eq("published", true).single();
  if (!profile || !profileHasCategory(profile, "music_entertainment")) {
    return NextResponse.json({ error: "Artist not found." }, { status: 404 });
  }

  const orderItems: {
    item_type: CartLine["item_type"];
    track_id: string | null;
    release_id: string | null;
    product_id: string | null;
    event_id: string | null;
    ticket_type_id: string | null;
    name_snapshot: string;
    price_snapshot: number;
    quantity: number;
    line_total: number;
  }[] = [];

  // Ticket types successfully reserved via reserve_event_ticket_type in
  // this request — tracked so a failure further down (order insert fails
  // after inventory was already committed) can release them back rather
  // than permanently losing tickets to a dropped request. Running per-
  // event/per-type totals *within this same cart* also feed the
  // max_tickets_per_customer / ticket type's own max_per_customer checks
  // below, so buying 3+2 of the same tier in one cart is capped correctly,
  // not just checked against past orders.
  const reservedTicketTypes: { id: string; quantity: number }[] = [];
  const ticketQtyByEvent = new Map<string, number>();
  const ticketQtyByType = new Map<string, number>();

  for (const line of lines) {
    const quantity = Math.max(1, Math.min(20, Number(line.quantity) || 1));

    if (line.item_type === "support") {
      const amount = Math.max(0, Number(line.amount) || 0);
      if (amount <= 0) continue;
      if (profile.hub_support_enabled === false) continue;
      orderItems.push({
        item_type: "support",
        track_id: null,
        release_id: null,
        product_id: null,
        event_id: null,
        ticket_type_id: null,
        name_snapshot: "Artist Support",
        price_snapshot: amount,
        quantity: 1,
        line_total: amount,
      });
      continue;
    }

    if (!line.id) continue;

    if (line.item_type === "song") {
      const { data: track } = await admin.from("tracks").select("*").eq("id", line.id).eq("profile_id", profileId).maybeSingle();
      if (!track || track.available === false || !track.price || track.release_id) continue; // bundled tracks aren't sold individually
      orderItems.push({
        item_type: "song",
        track_id: track.id,
        release_id: null,
        product_id: null,
        event_id: null,
        ticket_type_id: null,
        name_snapshot: track.title,
        price_snapshot: Number(track.price),
        quantity: 1, // digital goods — one copy per line, buy again to gift another
        line_total: Number(track.price),
      });
    } else if (line.item_type === "release") {
      const { data: release } = await admin.from("music_releases").select("*").eq("id", line.id).eq("profile_id", profileId).maybeSingle();
      if (!release || release.available === false) continue;
      orderItems.push({
        item_type: "release",
        track_id: null,
        release_id: release.id,
        product_id: null,
        event_id: null,
        ticket_type_id: null,
        name_snapshot: release.title,
        price_snapshot: Number(release.price),
        quantity: 1,
        line_total: Number(release.price),
      });
    } else if (line.item_type === "merch") {
      const { data: product } = await admin.from("products").select("*").eq("id", line.id).eq("profile_id", profileId).maybeSingle();
      if (!product || product.available === false) continue;
      if (product.inventory_count !== null && product.inventory_count < quantity) continue; // sold out / not enough stock
      orderItems.push({
        item_type: "merch",
        track_id: null,
        release_id: null,
        product_id: product.id,
        event_id: null,
        ticket_type_id: null,
        name_snapshot: product.name,
        price_snapshot: Number(product.price) || 0,
        quantity,
        line_total: (Number(product.price) || 0) * quantity,
      });
    } else if (line.item_type === "ticket" && line.ticket_type_id) {
      // Multi-tier ticket (event_ticket_types) — see
      // supabase/migrations/2026-09-21_event_ticket_types.sql. Two plain
      // queries rather than a joined/filtered one, same style as every
      // other lookup in this route — keeps this security-relevant check
      // unambiguous rather than leaning on a join-filter query shape not
      // otherwise used in this codebase.
      const { data: tt } = await admin.from("event_ticket_types").select("*").eq("id", line.ticket_type_id).maybeSingle();
      if (!tt) continue;
      const { data: event } = await admin.from("events").select("*").eq("id", tt.event_id).eq("profile_id", profileId).maybeSingle();
      // Defense in depth — the line's own `id` (event_id) must actually
      // match the ticket type's real parent event.
      if (!event || event.id !== line.id || event.status !== "published") continue;

      const eventTotalIfAdded = (ticketQtyByEvent.get(event.id) || 0) + quantity;
      const typeTotalIfAdded = (ticketQtyByType.get(tt.id) || 0) + quantity;

      if (event.max_tickets_per_customer != null || tt.max_per_customer != null) {
        const { data: priorOrders } = await admin
          .from("music_orders")
          .select("id")
          .eq("profile_id", profileId)
          .eq("customer_phone", customerPhone)
          .neq("status", "cancelled");
        const priorOrderIds = (priorOrders || []).map((o) => o.id);
        let priorEventQty = 0;
        let priorTypeQty = 0;
        if (priorOrderIds.length > 0) {
          const { data: priorItems } = await admin
            .from("music_order_items")
            .select("ticket_type_id, quantity")
            .eq("event_id", event.id)
            .in("order_id", priorOrderIds);
          for (const pi of priorItems || []) {
            priorEventQty += pi.quantity;
            if (pi.ticket_type_id === tt.id) priorTypeQty += pi.quantity;
          }
        }
        if (event.max_tickets_per_customer != null && priorEventQty + eventTotalIfAdded > event.max_tickets_per_customer) continue;
        if (tt.max_per_customer != null && priorTypeQty + typeTotalIfAdded > tt.max_per_customer) continue;
      }

      // The one real, atomic guarantee — every check above is a nicer
      // error message, this is the actual "can't oversell" boundary.
      const { data: reserved } = await admin.rpc("reserve_event_ticket_type", {
        p_ticket_type_id: tt.id,
        p_quantity: quantity,
      });
      if (!reserved) continue; // sold out, inactive, or outside its sales window

      reservedTicketTypes.push({ id: tt.id, quantity });
      ticketQtyByEvent.set(event.id, eventTotalIfAdded);
      ticketQtyByType.set(tt.id, typeTotalIfAdded);

      orderItems.push({
        item_type: "ticket",
        track_id: null,
        release_id: null,
        product_id: null,
        event_id: event.id,
        ticket_type_id: tt.id,
        // Just the tier's own name (e.g. "VIP"), matching how every other
        // item_type snapshots its own name without prefixing the artist/
        // event — the event itself is already identified by event_id, and
        // the ticket-pass page reads the event's own (live, non-snapshot)
        // title alongside this for display.
        name_snapshot: tt.name,
        price_snapshot: Number(tt.price),
        quantity,
        line_total: Number(tt.price) * quantity,
      });
    } else if (line.item_type === "ticket") {
      // Legacy single-price ticket — an event with no ticket types at all,
      // unchanged from before this feature existed except for also
      // respecting the new `status` column (defaults to 'published', so
      // every pre-existing event keeps selling exactly as it did).
      const { data: event } = await admin.from("events").select("*").eq("id", line.id).eq("profile_id", profileId).maybeSingle();
      if (!event || !event.price || event.status !== "published") continue;
      const remaining = event.ticket_capacity !== null ? event.ticket_capacity - (event.tickets_sold || 0) : Infinity;
      if (remaining < quantity) continue; // sold out
      orderItems.push({
        item_type: "ticket",
        track_id: null,
        release_id: null,
        product_id: null,
        event_id: event.id,
        ticket_type_id: null,
        name_snapshot: event.title,
        price_snapshot: Number(event.price),
        quantity,
        line_total: Number(event.price) * quantity,
      });
    }
  }

  if (orderItems.length === 0) {
    return NextResponse.json({ error: "Nothing in your cart is currently available." }, { status: 400 });
  }

  const subtotal = orderItems.reduce((sum, i) => sum + i.line_total, 0);
  const paymentMethod = ["cash", "mobile_money", "card"].includes(body?.payment_method) ? body.payment_method : "cash";

  const { data: customer } = await admin
    .from("music_customers")
    .upsert({ profile_id: profileId, phone: customerPhone, name: customerName, email: customerEmail || null }, { onConflict: "profile_id,phone" })
    .select()
    .single();

  const { data: order, error: orderError } = await admin
    .from("music_orders")
    .insert({
      profile_id: profileId,
      customer_id: customer?.id || null,
      customer_name: customerName,
      customer_email: customerEmail || null,
      customer_phone: customerPhone,
      payment_method: paymentMethod,
      subtotal,
      total: subtotal,
    })
    .select()
    .single();

  if (orderError || !order) {
    console.error("music_orders insert failed:", orderError?.message);
    // Give back any ticket inventory this request already reserved above —
    // otherwise a dropped order would permanently lock those seats away
    // from sale even though nobody actually bought them.
    for (const r of reservedTicketTypes) {
      await admin.rpc("release_event_ticket_type", { p_ticket_type_id: r.id, p_quantity: r.quantity });
    }
    return NextResponse.json({ error: "Could not place your order — try again." }, { status: 500 });
  }

  const { data: insertedItems } = await admin
    .from("music_order_items")
    .insert(orderItems.map((i) => ({ ...i, order_id: order.id })))
    .select();

  // Real digital tickets — one row per physical ticket, so a quantity-3
  // line becomes 3 independently valid/used/cancelled passes (see
  // digital_tickets in the migration). Covers both multi-tier and legacy
  // single-price ticket purchases (ticket_type_id null either way there).
  // Access to the actual QR/pass page still gates on payment_status
  // becoming 'paid' (see the ticket-pass route) — this just creates the
  // records so they exist the moment the order does.
  const ticketItems = (insertedItems || []).filter((i: any) => i.item_type === "ticket");
  for (const item of ticketItems) {
    const rows = Array.from({ length: item.quantity }, () => ({
      order_id: order.id,
      order_item_id: item.id,
      profile_id: profileId,
      event_id: item.event_id,
      ticket_type_id: item.ticket_type_id,
      attendee_name: customerName,
    }));
    await admin.from("digital_tickets").insert(rows);
  }

  // Best-effort inventory/ticket-count updates — not perfectly race-safe
  // under heavy concurrent checkout, an accepted tradeoff at this scale
  // (same posture as the rest of this codebase's simpler counters).
  for (const item of orderItems) {
    if (item.item_type === "merch" && item.product_id) {
      const { data: p } = await admin.from("products").select("inventory_count").eq("id", item.product_id).single();
      if (p?.inventory_count !== null && p?.inventory_count !== undefined) {
        await admin.from("products").update({ inventory_count: Math.max(0, p.inventory_count - item.quantity) }).eq("id", item.product_id);
      }
    } else if (item.item_type === "ticket" && item.event_id) {
      const { data: e } = await admin.from("events").select("tickets_sold").eq("id", item.event_id).single();
      await admin.from("events").update({ tickets_sold: (e?.tickets_sold || 0) + item.quantity }).eq("id", item.event_id);
    }
  }

  if (customer) {
    await admin
      .from("music_customers")
      .update({
        total_orders: (customer.total_orders || 0) + 1,
        total_spent: Number(customer.total_spent || 0) + subtotal,
        last_order_at: new Date().toISOString(),
        name: customerName,
      })
      .eq("id", customer.id);
  }

  return NextResponse.json({ id: order.id, order_number: order.order_number });
}
