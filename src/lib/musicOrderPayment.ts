import { createAdminClient } from "@/lib/supabase/server";
import { fapshiGetStatus, type FapshiStatus } from "@/lib/fapshi";
import { getMusicPayoutSettings } from "@/lib/musicPayoutSettings";
import { sendMusicOrderReceiptEmail } from "@/lib/email/sendMusicOrderReceipt";

// Shared by /api/music/orders/[id]/pay-status (the short active-polling
// window right after a fan starts a Mobile Money payment) AND
// /api/music/orders/[id] (the long-lived poll the confirmation screen
// keeps running for as long as the fan has that tab open — see
// MusicStorePage.tsx). Extracted so a fan who takes longer than the
// pay-status screen's own ~2min timeout to approve the USSD prompt still
// gets marked 'paid' automatically the moment Fapshi confirms it, without
// ever needing the artist to touch anything by hand. That artist-marks-it
// path stays the ONLY route for cash/card orders (see MusicOrdersView.tsx)
// — this function only ever runs for an order that actually went through
// real automatic Mobile Money collection (payment_method 'mobile_money'
// with a pending_fapshi_trans_id).
//
// This is the one and only place a music_sale_earnings row is ever
// created — see the migration's header comment for why that matters: a
// cash/card order the artist marks paid by hand must never generate a
// "Ringo owes you 90%" entry, because Ringo never touched that money.
export async function checkAndConfirmFapshiOrder(
  admin: ReturnType<typeof createAdminClient>,
  order: {
    id: string;
    total: number;
    pending_fapshi_trans_id: string | null;
    payment_status: string;
    payment_method: string;
    profiles: { id?: string; user_id: string; currency: string | null } | null;
  }
): Promise<FapshiStatus | null> {
  if (order.payment_method !== "mobile_money" || !order.pending_fapshi_trans_id) return null;
  if (order.payment_status === "paid") return "SUCCESSFUL";

  const tx = await fapshiGetStatus(order.pending_fapshi_trans_id);

  if (tx.status === "SUCCESSFUL") {
    const profile = order.profiles;
    await admin.from("music_orders").update({ payment_status: "paid" }).eq("id", order.id);

    if (profile?.user_id) {
      // Idempotent against a race between two near-simultaneous checks:
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
          order_id: order.id,
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
    }

    try {
      await sendMusicOrderReceiptEmail(admin, order.id);
    } catch (err) {
      // Never let a receipt email failure undo or block the payment
      // confirmation the fan is actually waiting on — see the function's
      // own comment for why this is safe to just log and move on.
      console.error(`music order receipt email threw for order ${order.id}:`, err);
    }
  }

  return tx.status;
}
