import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Push subscribe for a guest restaurant customer tracking one order — no
// account, no community_subscribers row either. Authenticated purely by
// the order's own id, the same "the UUID itself is the access control"
// reasoning GET /api/orders/[id] already documents for letting a guest
// poll their own order with no session at all.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const orderId = body?.orderId;
  const subscription = body?.subscription;

  if (typeof orderId !== "string" || !orderId) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return NextResponse.json({ error: "Invalid subscription." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: order } = await admin.from("orders").select("id").eq("id", orderId).maybeSingle();
  if (!order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  const { error } = await admin.from("push_subscriptions").upsert(
    {
      order_id: order.id,
      // Explicit nulls — see subscribe/route.ts's matching comment: an
      // upsert's ON CONFLICT DO UPDATE only touches listed columns, so a
      // reused endpoint previously owned by a different kind would
      // otherwise trip the one-owner check constraint.
      user_id: null,
      subscriber_id: null,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      user_agent: typeof body?.userAgent === "string" ? body.userAgent.slice(0, 300) : null,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "endpoint" }
  );

  if (error) {
    console.error("push subscribe (order) failed:", error.message);
    return NextResponse.json({ error: "Could not save subscription." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
