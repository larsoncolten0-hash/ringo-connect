import { createAdminClient } from "@/lib/supabase/server";
import { fapshiDirectPay } from "@/lib/fapshi";
import { getPlatformSettings } from "@/lib/platformSettings";
import { NextResponse } from "next/server";

// Public — the fan paying for their own just-placed order, not an
// authenticated action. Mirrors /api/signup-requests/[id]/pay exactly: the
// amount is always re-read from the order's own stored total, never
// trusted from the client. Only ever applies to XAF orders declared as
// "mobile_money" at checkout — Fapshi doesn't move any other currency, and
// cash/card orders stay on the existing declared/artist-confirms path (see
// the migration's header for why that split matters: this route is the
// ONLY way a music_sale_earnings row ever gets created, in pay-status once
// Fapshi confirms).
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const { phone, medium } = await request.json().catch(() => ({}));
  if (!phone || !["mobile money", "orange money"].includes(medium)) {
    return NextResponse.json({ error: "Phone number and provider are required." }, { status: 400 });
  }

  const settings = await getPlatformSettings();
  if (!settings.fapshiEnabled) {
    return NextResponse.json({ error: "Mobile Money payments are currently unavailable." }, { status: 503 });
  }

  const admin = createAdminClient();

  const { data: order } = await admin
    .from("music_orders")
    .select("id, total, payment_method, payment_status, profiles(username, name, currency)")
    .eq("id", params.id)
    .single();

  if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });
  if (order.payment_status === "paid") {
    return NextResponse.json({ error: "This order has already been paid." }, { status: 400 });
  }
  if (order.payment_method !== "mobile_money") {
    return NextResponse.json({ error: "This order wasn't set up for Mobile Money." }, { status: 400 });
  }
  const profile = order.profiles as any;
  if ((profile?.currency || "USD") !== "XAF") {
    return NextResponse.json({ error: "Automatic Mobile Money is only available for XAF profiles." }, { status: 400 });
  }

  try {
    const result = await fapshiDirectPay({
      amount: Math.round(Number(order.total)),
      phone,
      medium,
      userId: params.id,
      externalId: `music-order-${params.id}`,
      message: `Ringo Connect — ${profile?.name || profile?.username || "artist"}`,
    });

    await admin.from("music_orders").update({ pending_fapshi_trans_id: result.transId }).eq("id", params.id);

    return NextResponse.json({ transId: result.transId });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Could not start the payment." }, { status: 502 });
  }
}
