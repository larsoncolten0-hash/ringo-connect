import { createAdminClient } from "@/lib/supabase/server";
import { profileHasCategory } from "@/lib/categories";
import { sendRestaurantOrderReceiptEmail } from "@/lib/email/sendRestaurantOrderReceipt";
import { NextResponse } from "next/server";

// Public, unauthenticated by design — guest ordering, no Ringo account
// required (same reasoning as /api/signup-requests). Everything that
// matters is re-derived server-side from the database: item prices/names
// come from menu_items, never from the request body, so a tampered client
// request can't under-charge or fabricate line items. There is no anon
// RLS policy on orders/order_items/restaurant_customers at all — this
// route (service-role admin client) is the only way in.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const admin = createAdminClient();

  const profileId = body?.profile_id;
  const orderType = body?.order_type;
  const customerName = typeof body?.customer_name === "string" ? body.customer_name.trim() : "";
  const customerPhone = typeof body?.customer_phone === "string" ? body.customer_phone.trim() : "";
  const customerEmail = typeof body?.customer_email === "string" ? body.customer_email.trim().slice(0, 200) : "";
  const items: { menu_item_id: string; quantity: number; notes?: string }[] = Array.isArray(body?.items) ? body.items : [];

  if (!profileId || !["dine_in", "takeaway", "delivery"].includes(orderType)) {
    return NextResponse.json({ error: "Invalid order." }, { status: 400 });
  }
  if (!customerName || !customerPhone) {
    return NextResponse.json({ error: "Name and phone number are required." }, { status: 400 });
  }
  if (items.length === 0) {
    return NextResponse.json({ error: "Your cart is empty." }, { status: 400 });
  }

  const { data: profile } = await admin.from("profiles").select("*").eq("id", profileId).eq("published", true).single();
  if (!profile || !profileHasCategory(profile, "restaurant_food")) {
    return NextResponse.json({ error: "Restaurant not found." }, { status: 404 });
  }
  if (profile.ordering_enabled === false) {
    return NextResponse.json({ error: "This restaurant isn't accepting orders right now." }, { status: 400 });
  }
  const typeEnabledCol = { dine_in: "dine_in_enabled", takeaway: "takeaway_enabled", delivery: "delivery_enabled" }[orderType as "dine_in" | "takeaway" | "delivery"];
  if (profile[typeEnabledCol] === false) {
    return NextResponse.json({ error: "This order type isn't available." }, { status: 400 });
  }

  // Table: only trusted if it resolves to THIS profile and is enabled —
  // never trust a client-supplied table_id blindly (that would let one
  // restaurant's order get attributed to another restaurant's table, or
  // a disabled/deleted table).
  let tableId: string | null = null;
  if (body?.table_id) {
    const { data: table } = await admin
      .from("restaurant_tables")
      .select("id")
      .eq("id", body.table_id)
      .eq("profile_id", profileId)
      .eq("enabled", true)
      .maybeSingle();
    tableId = table?.id || null;
  }

  if (orderType === "delivery" && !body?.delivery_address?.trim()) {
    return NextResponse.json({ error: "A delivery address is required." }, { status: 400 });
  }

  // Re-derive every line item from the database — the request's own
  // price/name (if it sent any) is ignored entirely.
  const menuItemIds = items.map((i) => i.menu_item_id).filter(Boolean);
  const { data: menuItems } = await admin
    .from("menu_items")
    .select("*")
    .eq("profile_id", profileId)
    .in("id", menuItemIds);

  const orderItems: { menu_item_id: string; item_name_snapshot: string; item_price_snapshot: number; quantity: number; line_total: number; notes: string | null }[] = [];
  for (const line of items) {
    const menuItem = (menuItems || []).find((m) => m.id === line.menu_item_id);
    const quantity = Math.max(1, Math.min(50, Number(line.quantity) || 1));
    if (!menuItem || menuItem.available === false) continue; // silently drop — the cart UI already hides unavailable items
    orderItems.push({
      menu_item_id: menuItem.id,
      item_name_snapshot: menuItem.name,
      item_price_snapshot: Number(menuItem.price),
      quantity,
      line_total: Number(menuItem.price) * quantity,
      notes: typeof line.notes === "string" ? line.notes.trim().slice(0, 300) || null : null,
    });
  }
  if (orderItems.length === 0) {
    return NextResponse.json({ error: "None of the items in your cart are currently available." }, { status: 400 });
  }

  const subtotal = orderItems.reduce((sum, i) => sum + i.line_total, 0);
  const deliveryFee = orderType === "delivery" ? Number(profile.delivery_fee) || 0 : 0;
  const total = subtotal + deliveryFee;

  const paymentMethod = ["cash", "mobile_money", "card"].includes(body?.payment_method) ? body.payment_method : "cash";

  // Customer record — upserted by (profile_id, phone). Marketing consent
  // is written ONLY when the checkbox was actually checked; it's never
  // implied by placing an order (see customer_marketing_consent's own
  // comment in the migration).
  const { data: customer } = await admin
    .from("restaurant_customers")
    .upsert(
      { profile_id: profileId, phone: customerPhone, name: customerName },
      { onConflict: "profile_id,phone", ignoreDuplicates: false }
    )
    .select()
    .single();

  if (customer && body?.marketing_opt_in === true) {
    await admin
      .from("customer_marketing_consent")
      .upsert({ customer_id: customer.id, opted_in: true, opted_in_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  }

  const { data: order, error: orderError } = await admin
    .from("orders")
    .insert({
      profile_id: profileId,
      table_id: tableId,
      customer_id: customer?.id || null,
      order_type: orderType,
      customer_name: customerName,
      customer_phone: customerPhone,
      customer_email: customerEmail || null,
      delivery_address: orderType === "delivery" ? body.delivery_address.trim() : null,
      delivery_fee: deliveryFee,
      payment_method: paymentMethod,
      subtotal,
      total,
      notes: typeof body?.notes === "string" ? body.notes.trim().slice(0, 500) || null : null,
    })
    .select()
    .single();

  if (orderError || !order) {
    console.error("order insert failed:", orderError?.message);
    return NextResponse.json({ error: "Could not place your order — try again." }, { status: 500 });
  }

  await admin.from("order_items").insert(orderItems.map((i) => ({ ...i, order_id: order.id })));
  await admin.from("order_status_history").insert({ order_id: order.id, status: "pending" });

  if (customerEmail) {
    try {
      await sendRestaurantOrderReceiptEmail(admin, order.id);
    } catch (err) {
      // Never fail order placement over a receipt email — the order
      // itself already succeeded above.
      console.error(`restaurant order receipt email threw for order ${order.id}:`, err);
    }
  }

  if (customer) {
    await admin
      .from("restaurant_customers")
      .update({
        total_orders: (customer.total_orders || 0) + 1,
        total_spent: Number(customer.total_spent || 0) + total,
        last_order_at: new Date().toISOString(),
        name: customerName, // keep the freshest name they typed
      })
      .eq("id", customer.id);
  }

  return NextResponse.json({ id: order.id, order_number: order.order_number });
}
