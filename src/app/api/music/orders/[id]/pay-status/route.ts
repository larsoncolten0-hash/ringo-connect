import { createAdminClient } from "@/lib/supabase/server";
import { fapshiGetStatus } from "@/lib/fapshi";
import { getMusicPayoutSettings } from "@/lib/musicPayoutSettings";
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
// authenticated GET straight to Fapshi.
//
// This is the ONE AND ONLY place a music_sale_earnings row is ever
// created — see the migration's header comment for why that matters: a
// cash/card order the artist marks paid by hand must never generate a
// "Ringo owes you 90%" entry, because Ringo never touched that money.
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const admin = createAdminClient();

  const { data: order } = await admin
    .from("music_orders")
    .select("id, total, pending_fapshi_trans_id, payment_status, profiles(id, user_id, currency)")
    .eq("id", params.id)
    .single();

  if (!order?.pending_fapshi_trans_id) {
    return NextResponse.json({ error: "No payment has been started for this order." }, { status: 404 });
  }

  if (order.payment_status === "paid") {
    // Already resolved by an earlier poll — report success again rather
    // than re-checking Fapshi or double-creating the earnings row.
    return NextResponse.json({ status: "SUCCESSFUL" });
  }

  try {
    const tx = await fapshiGetStatus(order.pending_fapshi_trans_id);

    if (tx.status === "SUCCESSFUL") {
      const profile = order.profiles as any;

      await admin.from("music_orders").update({ payment_status: "paid" }).eq("id", params.id);

      // Idempotent against a race between two near-simultaneous polls:
      // order_id is unique on music_sale_earnings, so a second insert
      // attempt for the same order is simply ignored.
      const musicSettings = await getMusicPayoutSettings();
      const gross = Number(order.total);
      const platformFee = Math.round(gross * musicSettings.musicCommissionRate * 100) / 100;
      const artistAmount = Math.round((gross - platformFee) * 100) / 100;
      const availableAt = new Date();
      availableAt.setDate(availableAt.getDate() + musicSettings.musicPayoutHoldDays);

      await admin
        .from("music_sale_earnings")
        .insert({
          artist_user_id: profile.user_id,
          order_id: params.id,
          gross_amount: gross,
          commission_rate: musicSettings.musicCommissionRate,
          platform_fee: platformFee,
          artist_amount: artistAmount,
          currency: profile.currency || "XAF",
          available_at: availableAt.toISOString(),
        })
        .select()
        .maybeSingle();
      // Deliberately not checking the error here beyond letting it be a
      // no-op on the unique(order_id) conflict — a real insert failure
      // would leave the order 'paid' (correct — the fan already paid and
      // must get access) with the earnings row missing, which is safely
      // recoverable by an admin from the data directly rather than ever
      // blocking the fan's access on the artist's own bookkeeping.
    } else if (tx.status === "FAILED" || tx.status === "EXPIRED") {
      // Nothing to revert — the order simply stays 'unpaid'; the fan can
      // retry or fall back to a declared payment method.
    }

    return NextResponse.json({ status: tx.status, reason: tx.reason || null });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Could not check payment status." }, { status: 502 });
  }
}
