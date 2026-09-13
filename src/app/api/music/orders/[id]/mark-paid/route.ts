import { createClient } from "@/lib/supabase/server";
import { sendMusicOrderReceiptEmail } from "@/lib/email/sendMusicOrderReceipt";
import { NextResponse } from "next/server";

// The artist confirming a cash/card order was actually paid — the ONLY way
// payment_status becomes 'paid' for those (see MusicOrdersView.tsx's own
// comment). Previously this was a direct client-side Supabase update with
// no server round-trip at all; now routed through an API route instead so
// a receipt email can actually be sent (sendEmail is server-only — the
// Resend API key must never reach the browser). Request-scoped client, not
// the admin client: RLS (`music_orders owner update` — same policy
// MusicOrdersView's direct update already relied on) is what actually
// verifies this order belongs to the caller's own profile.
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const { data: order, error } = await supabase
    .from("music_orders")
    .update({ payment_status: "paid" })
    .eq("id", params.id)
    .select("id")
    .maybeSingle();

  // RLS silently returns zero rows for an order the caller doesn't own,
  // same as a genuinely missing id — both surface identically here.
  if (error || !order) return NextResponse.json({ error: "Order not found." }, { status: 404 });

  try {
    await sendMusicOrderReceiptEmail(supabase, order.id);
  } catch (err) {
    // Never fail the mark-paid action itself over a receipt email — the
    // artist's confirmation (and the fan's Play/Download access) already
    // succeeded above.
    console.error(`music order receipt email threw for order ${order.id}:`, err);
  }

  return NextResponse.json({ ok: true });
}
