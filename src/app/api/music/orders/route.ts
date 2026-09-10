import { createAdminClient } from "@/lib/supabase/server";
import { profileHasCategory } from "@/lib/categories";
import { NextResponse } from "next/server";

type CartLine = {
  item_type: "song" | "release" | "merch" | "ticket" | "support";
  id?: string; // track_id / release_id / product_id / event_id — omitted for 'support'
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
    name_snapshot: string;
    price_snapshot: number;
    quantity: number;
    line_total: number;
  }[] = [];

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
        name_snapshot: product.name,
        price_snapshot: Number(product.price) || 0,
        quantity,
        line_total: (Number(product.price) || 0) * quantity,
      });
    } else if (line.item_type === "ticket") {
      const { data: event } = await admin.from("events").select("*").eq("id", line.id).eq("profile_id", profileId).maybeSingle();
      if (!event || !event.price) continue;
      const remaining = event.ticket_capacity !== null ? event.ticket_capacity - (event.tickets_sold || 0) : Infinity;
      if (remaining < quantity) continue; // sold out
      orderItems.push({
        item_type: "ticket",
        track_id: null,
        release_id: null,
        product_id: null,
        event_id: event.id,
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
    return NextResponse.json({ error: "Could not place your order — try again." }, { status: 500 });
  }

  await admin.from("music_order_items").insert(orderItems.map((i) => ({ ...i, order_id: order.id })));

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
