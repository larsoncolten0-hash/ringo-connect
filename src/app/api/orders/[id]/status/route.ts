import { createClient, createAdminClient } from "@/lib/supabase/server";
import { sendRestaurantOrderStatusEmail } from "@/lib/email/sendRestaurantOrderStatusEmail";
import { sendPushToOrderWatcher } from "@/lib/push/send";
import type { OrderStatus } from "@/lib/orderStatus";
import { NextResponse } from "next/server";

// The two moments the user explicitly asked for push on: the kitchen
// starting the order, and it being ready. Every other transition
// (accepted/served/completed/cancelled) still gets the existing email
// via sendRestaurantOrderStatusEmail below, just not a push — mirroring
// exactly the two stages requested, not every status this table has.
const PUSH_STATUS_COPY: Partial<Record<OrderStatus, { title: string; body: string }>> = {
  preparing: { title: "Your order is being prepared", body: "The kitchen has started on your order." },
  ready: { title: "Order ready", body: "Your order is ready." },
};

const VALID_STATUSES: OrderStatus[] = ["accepted", "preparing", "ready", "served", "completed", "cancelled"];

// The restaurant advancing an order's status (or cancelling it) —
// previously a direct client-side Supabase update (see
// RestaurantOrdersView.tsx's own comment); this is now routed through an
// API route instead so a status-update email can actually be sent
// (sendEmail is server-only — the Resend API key must never reach the
// browser). Request-scoped client, not the admin client: RLS ("orders
// owner all") is what actually verifies this order belongs to the
// caller's own profile, same as the direct update it replaces.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const status = body?.status as OrderStatus;
  if (!VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: "Invalid status." }, { status: 400 });
  }

  // `.neq` guards against a duplicate/retried request re-firing the email
  // for a status the order is already at — matches zero rows in that
  // case, same no-op-is-safe posture as every other write in this app.
  const { data: order, error } = await supabase
    .from("orders")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", params.id)
    .neq("status", status)
    .select("id")
    .maybeSingle();

  // RLS silently returns zero rows for an order the caller doesn't own,
  // same as a genuinely missing id or one already at this status — all
  // three surface identically here.
  if (error || !order) return NextResponse.json({ error: "Order not found." }, { status: 404 });

  await supabase.from("order_status_history").insert({ order_id: order.id, status });

  const pushCopy = PUSH_STATUS_COPY[status];
  if (pushCopy) {
    // The admin client, not the request-scoped `supabase` above — the
    // guest customer's push_subscriptions row (owned by order_id, not
    // user_id) has no RLS policy granting the restaurant owner's own
    // session access to it, same reasoning every cross-owner push send
    // elsewhere in this app uses the admin client.
    await sendPushToOrderWatcher(createAdminClient(), order.id, {
      category: `order_${status}`,
      title: pushCopy.title,
      body: pushCopy.body,
    });
  }

  try {
    await sendRestaurantOrderStatusEmail(supabase, order.id, status);
  } catch (err) {
    // Never fail the status update itself over a notification email — the
    // transition already succeeded above.
    console.error(`restaurant order status email threw for order ${order.id} (${status}):`, err);
  }

  return NextResponse.json({ ok: true });
}
