import { createAdminClient } from "@/lib/supabase/server";
import { checkAndConfirmFapshiOrder } from "@/lib/musicOrderPayment";
import { NextResponse } from "next/server";

// Mirrors /api/signup-requests/[id]/pay-status exactly, including this
// force-dynamic export — without it this handler (reads no cookies, only
// a URL param) is statically optimizable, so the FIRST response (almost
// always "CREATED", checked moments after direct-pay is initiated) gets
// cached and every later poll replays that same frozen snapshot forever
// instead of re-checking Fapshi.
export const dynamic = "force-dynamic";

// Public — same fan-facing pattern as the pay route this checks on. Never
// trusts a claimed status from the client, always re-verifies with an
// authenticated GET straight to Fapshi (see checkAndConfirmFapshiOrder,
// shared with /api/music/orders/[id] so a fan who takes longer than this
// screen's own short polling window to approve the prompt still gets
// marked 'paid' automatically once they do, no artist involved).
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const admin = createAdminClient();

  const { data: order } = await admin
    .from("music_orders")
    .select(
      "id, total, pending_fapshi_trans_id, payment_status, payment_method, profiles(id, user_id, currency), music_order_items(item_type)"
    )
    .eq("id", params.id)
    .single();

  if (!order?.pending_fapshi_trans_id) {
    return NextResponse.json({ error: "No payment has been started for this order." }, { status: 404 });
  }

  if (order.payment_status === "paid") {
    // Already resolved by an earlier check — report success again rather
    // than re-checking Fapshi or double-creating the earnings row.
    return NextResponse.json({ status: "SUCCESSFUL" });
  }

  try {
    const status = await checkAndConfirmFapshiOrder(admin, order as any);
    return NextResponse.json({ status });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Could not check payment status." }, { status: 502 });
  }
}
