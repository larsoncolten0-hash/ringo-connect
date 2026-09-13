import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getMusicPayoutSettings } from "@/lib/musicPayoutSettings";
import { sendPushToUser } from "@/lib/push/send";
import { formatPrice } from "@/lib/currency";

// Mirrors src/lib/affiliate.ts's payout-resolution + overview functions
// closely — same shape, same reasoning, just a different source of money
// owed to a creator. See the migration's header for why earnings only ever
// come from Fapshi-collected mobile money sales, never cash/card ones.

export type CurrencyTotals = { pending: number; available: number; requested: number; paid: number };

export type MusicEarning = {
  id: string;
  grossAmount: number;
  artistAmount: number;
  commissionRate: number;
  currency: string;
  status: "pending" | "requested" | "paid" | "reversed";
  availableAt: string;
  createdAt: string;
};

export type MusicPayout = {
  id: string;
  amount: number;
  currency: string;
  status: "requested" | "processing" | "paid" | "rejected";
  requestedAt: string;
  processedAt: string | null;
  adminNote: string | null;
};

export type MyMusicEarningsOverview = {
  payoutMethod: "mobile_money" | "paypal" | "bank" | null;
  payoutDetails: Record<string, any> | null;
  settings: { commissionRatePct: number; holdDays: number; minPayoutXaf: number };
  totalsByCurrency: Record<string, CurrencyTotals>;
  earnings: MusicEarning[];
  payouts: MusicPayout[];
};

function emptyTotals(): CurrencyTotals {
  return { pending: 0, available: 0, requested: 0, paid: 0 };
}

export async function getMyMusicEarningsOverview(): Promise<MyMusicEarningsOverview | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: me }, settings, { data: earningRows }, { data: payoutRows }] = await Promise.all([
    supabase.from("users").select("affiliate_payout_method, affiliate_payout_details").eq("id", user.id).single(),
    getMusicPayoutSettings(),
    supabase
      .from("music_sale_earnings")
      .select("id, gross_amount, artist_amount, commission_rate, currency, status, available_at, created_at")
      .eq("artist_user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("music_payouts")
      .select("id, amount, currency, status, requested_at, processed_at, admin_note")
      .eq("artist_user_id", user.id)
      .order("requested_at", { ascending: false }),
  ]);

  const now = Date.now();
  const totalsByCurrency: Record<string, CurrencyTotals> = {};

  const earnings: MusicEarning[] = (earningRows || []).map((row: any) => {
    const currency = row.currency as string;
    totalsByCurrency[currency] ??= emptyTotals();
    const amount = Number(row.artist_amount);

    if (row.status === "paid") totalsByCurrency[currency].paid += amount;
    else if (row.status === "requested") totalsByCurrency[currency].requested += amount;
    else if (row.status === "pending") {
      if (new Date(row.available_at).getTime() <= now) totalsByCurrency[currency].available += amount;
      else totalsByCurrency[currency].pending += amount;
    }

    return {
      id: row.id,
      grossAmount: Number(row.gross_amount),
      artistAmount: amount,
      commissionRate: Number(row.commission_rate),
      currency,
      status: row.status,
      availableAt: row.available_at,
      createdAt: row.created_at,
    };
  });

  const payouts: MusicPayout[] = (payoutRows || []).map((row: any) => ({
    id: row.id,
    amount: Number(row.amount),
    currency: row.currency,
    status: row.status,
    requestedAt: row.requested_at,
    processedAt: row.processed_at,
    adminNote: row.admin_note,
  }));

  return {
    payoutMethod: me?.affiliate_payout_method ?? null,
    payoutDetails: (me?.affiliate_payout_details as Record<string, any>) ?? null,
    settings: {
      commissionRatePct: Math.round(settings.musicCommissionRate * 10000) / 100,
      holdDays: settings.musicPayoutHoldDays,
      minPayoutXaf: settings.musicMinPayoutXaf,
    },
    totalsByCurrency,
    earnings,
    payouts,
  };
}

export async function requestMusicPayout(currency: "XAF" | "USD") {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("request_music_payout", { p_currency: currency });
  if (error) throw new Error(error.message);
  return data;
}

// ============================================================================
// Admin-facing reads/writes — /admin/music-payouts
// ============================================================================

export type AdminMusicPayout = {
  id: string;
  amount: number;
  currency: string;
  status: "requested" | "processing" | "paid" | "rejected";
  payoutMethod: string | null;
  payoutDetails: Record<string, any> | null;
  adminNote: string | null;
  requestedAt: string;
  processedAt: string | null;
  fapshiTransId: string | null;
  artist: { id: string; email: string; username: string | null };
};

export type AdminMusicPayoutOverview = {
  totalsByCurrency: Record<string, { outstanding: number; paid: number }>;
  payouts: AdminMusicPayout[];
};

export async function getAdminMusicPayoutOverview(): Promise<AdminMusicPayoutOverview> {
  const admin = createAdminClient();

  const [{ data: payoutRows }, { data: earningRows }] = await Promise.all([
    admin
      .from("music_payouts")
      .select(
        "id, amount, currency, status, payout_method, payout_details, admin_note, requested_at, processed_at, fapshi_trans_id, users!artist_user_id(id, email, profiles(username))"
      )
      .order("requested_at", { ascending: false })
      .limit(300),
    admin.from("music_sale_earnings").select("currency, artist_amount, status").neq("status", "reversed").limit(20000),
  ]);

  const totalsByCurrency: Record<string, { outstanding: number; paid: number }> = {};
  for (const row of earningRows || []) {
    const currency = row.currency as string;
    const amount = Number(row.artist_amount);
    totalsByCurrency[currency] ??= { outstanding: 0, paid: 0 };
    if (row.status === "paid") totalsByCurrency[currency].paid += amount;
    else totalsByCurrency[currency].outstanding += amount;
  }

  const payouts: AdminMusicPayout[] = (payoutRows || []).map((row: any) => ({
    id: row.id,
    amount: Number(row.amount),
    currency: row.currency,
    status: row.status,
    payoutMethod: row.payout_method,
    payoutDetails: row.payout_details,
    adminNote: row.admin_note,
    requestedAt: row.requested_at,
    processedAt: row.processed_at,
    fapshiTransId: row.fapshi_trans_id,
    artist: { id: row.users?.id, email: row.users?.email ?? "—", username: row.users?.profiles?.[0]?.username ?? null },
  }));

  return { totalsByCurrency, payouts };
}

// --- Payout resolution — shared by the manual admin route and the Fapshi
// disbursement routes, mirrors affiliate.ts's own trio exactly. ---

/** Terminal: the artist has been paid, by whatever method. Earnings linked
 *  to this payout are locked in as paid. */
export async function markMusicPayoutPaid(payoutId: string, opts: { adminId: string; note?: string | null }) {
  const admin = createAdminClient();
  const { data: payout, error } = await admin
    .from("music_payouts")
    .update({
      status: "paid",
      admin_note: opts.note ?? null,
      processed_at: new Date().toISOString(),
      processed_by: opts.adminId,
    })
    .eq("id", payoutId)
    .select("artist_user_id, amount, currency")
    .single();
  if (error) throw new Error(error.message);

  await admin.from("music_sale_earnings").update({ status: "paid" }).eq("payout_id", payoutId);

  // The single shared choke point for both the Fapshi-automated and
  // manual-admin "mark paid" paths — see this function's own callers.
  await sendPushToUser(admin, payout?.artist_user_id, {
    category: "payout_paid",
    title: "Payout sent",
    body: `Your ${formatPrice(payout.amount, payout.currency)} payout from Ringo Connect has been sent.`,
    url: "/dashboard/music/earnings",
  });
}

/** Terminal: an admin is declining this specific request — hands the
 *  underlying earnings back to the available pool (unlinked, status back
 *  to 'pending') so the artist can simply request again. */
export async function markMusicPayoutRejected(payoutId: string, opts: { adminId: string; note?: string | null }) {
  const admin = createAdminClient();
  const { error } = await admin
    .from("music_payouts")
    .update({
      status: "rejected",
      admin_note: opts.note ?? null,
      processed_at: new Date().toISOString(),
      processed_by: opts.adminId,
    })
    .eq("id", payoutId);
  if (error) throw new Error(error.message);

  await admin.from("music_sale_earnings").update({ status: "pending", payout_id: null }).eq("payout_id", payoutId);
}

/** A Fapshi disbursement has been initiated for this payout — money is in
 *  flight. Deliberately does NOT touch the linked earnings. */
export async function markMusicPayoutProcessing(payoutId: string, fapshiTransId: string) {
  const admin = createAdminClient();
  const { error } = await admin.from("music_payouts").update({ status: "processing", fapshi_trans_id: fapshiTransId }).eq("id", payoutId);
  if (error) throw new Error(error.message);
}

/** A Fapshi disbursement came back FAILED/EXPIRED — the money never left,
 *  so the SAME payout row simply becomes retryable again. Linked earnings
 *  are left alone (still 'requested', still linked). */
export async function revertMusicPayoutToRequested(payoutId: string, note?: string | null) {
  const admin = createAdminClient();
  const { error } = await admin.from("music_payouts").update({ status: "requested", admin_note: note ?? null }).eq("id", payoutId);
  if (error) throw new Error(error.message);
}
