import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getShopPayoutSettings } from "@/lib/shopPayoutSettings";
import { sendPushAndBellToUser } from "@/lib/push/withBell";
import { formatPrice } from "@/lib/currency";

// Mirrors src/lib/musicEarnings.ts closely — same shape, same reasoning, just against
// commerce_sale_earnings/commerce_payouts (Increment 5A's Shop ledger) instead of
// music_sale_earnings/music_payouts. Shop is XAF-only (see the migration's own note), so unlike
// music there is no USD branch anywhere here.

export type ShopPayoutCurrencyTotals = { pending: number; available: number; requested: number; paid: number };

export type ShopSaleEarning = {
  id: string;
  grossAmount: number;
  netAmount: number;
  commissionRate: number;
  currency: string;
  status: "recorded" | "requested" | "paid" | "reversed";
  availableAt: string;
  createdAt: string;
};

export type ShopPayout = {
  id: string;
  amount: number;
  currency: string;
  status: "requested" | "processing" | "paid" | "rejected";
  requestedAt: string;
  processedAt: string | null;
  adminNote: string | null;
};

export type MyShopPayoutOverview = {
  payoutMethod: "mobile_money" | "paypal" | "bank" | null;
  payoutDetails: Record<string, any> | null;
  settings: { holdDays: number; minPayoutXaf: number };
  totals: ShopPayoutCurrencyTotals;
  earnings: ShopSaleEarning[];
  payouts: ShopPayout[];
};

function emptyTotals(): ShopPayoutCurrencyTotals {
  return { pending: 0, available: 0, requested: 0, paid: 0 };
}

export async function getMyShopPayoutOverview(): Promise<MyShopPayoutOverview | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: me }, settings, { data: earningRows }, { data: payoutRows }] = await Promise.all([
    supabase.from("users").select("affiliate_payout_method, affiliate_payout_details").eq("id", user.id).single(),
    getShopPayoutSettings(),
    supabase
      .from("commerce_sale_earnings")
      .select("id, gross_amount, net_amount, commission_rate, currency, status, available_at, created_at")
      .eq("creator_user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("commerce_payouts")
      .select("id, amount, currency, status, requested_at, processed_at, admin_note")
      .eq("creator_user_id", user.id)
      .order("requested_at", { ascending: false }),
  ]);

  const now = Date.now();
  const totals = emptyTotals();

  const earnings: ShopSaleEarning[] = (earningRows || []).map((row: any) => {
    const amount = Number(row.net_amount);

    if (row.status === "paid") totals.paid += amount;
    else if (row.status === "requested") totals.requested += amount;
    else if (row.status === "recorded") {
      if (new Date(row.available_at).getTime() <= now) totals.available += amount;
      else totals.pending += amount;
    }

    return {
      id: row.id,
      grossAmount: Number(row.gross_amount),
      netAmount: amount,
      commissionRate: Number(row.commission_rate),
      currency: row.currency,
      status: row.status,
      availableAt: row.available_at,
      createdAt: row.created_at,
    };
  });

  const payouts: ShopPayout[] = (payoutRows || []).map((row: any) => ({
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
    settings: { holdDays: settings.commercePayoutHoldDays, minPayoutXaf: settings.commerceMinPayoutXaf },
    totals,
    earnings,
    payouts,
  };
}

export async function requestShopPayout() {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("request_commerce_payout");
  if (error) throw new Error(error.message);
  return data;
}

// ============================================================================
// Admin-facing reads/writes — /admin/shop-payouts
// ============================================================================

export type AdminShopPayout = {
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
  seller: { id: string; email: string; username: string | null };
};

export type AdminShopPayoutOverview = {
  totalsByCurrency: Record<string, { outstanding: number; paid: number }>;
  payouts: AdminShopPayout[];
};

export async function getAdminShopPayoutOverview(): Promise<AdminShopPayoutOverview> {
  const admin = createAdminClient();

  const [{ data: payoutRows }, { data: earningRows }] = await Promise.all([
    admin
      .from("commerce_payouts")
      .select(
        "id, amount, currency, status, payout_method, payout_details, admin_note, requested_at, processed_at, fapshi_trans_id, users!creator_user_id(id, email, profiles(username))"
      )
      .order("requested_at", { ascending: false })
      .limit(300),
    admin.from("commerce_sale_earnings").select("currency, net_amount, status").neq("status", "reversed").limit(20000),
  ]);

  const totalsByCurrency: Record<string, { outstanding: number; paid: number }> = {};
  for (const row of earningRows || []) {
    const currency = row.currency as string;
    const amount = Number(row.net_amount);
    totalsByCurrency[currency] ??= { outstanding: 0, paid: 0 };
    if (row.status === "paid") totalsByCurrency[currency].paid += amount;
    else totalsByCurrency[currency].outstanding += amount;
  }

  const payouts: AdminShopPayout[] = (payoutRows || []).map((row: any) => ({
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
    seller: { id: row.users?.id, email: row.users?.email ?? "—", username: row.users?.profiles?.[0]?.username ?? null },
  }));

  return { totalsByCurrency, payouts };
}

// --- Payout resolution — shared by the manual admin route and the Fapshi disbursement routes,
// mirrors musicEarnings.ts's own trio exactly. ---

/** Terminal: the seller has been paid, by whatever method. Earnings linked to this payout are
 *  locked in as paid. */
export async function markShopPayoutPaid(payoutId: string, opts: { adminId: string; note?: string | null }) {
  const admin = createAdminClient();
  const { data: payout, error } = await admin
    .from("commerce_payouts")
    .update({
      status: "paid",
      admin_note: opts.note ?? null,
      processed_at: new Date().toISOString(),
      processed_by: opts.adminId,
    })
    .eq("id", payoutId)
    .select("creator_user_id, amount, currency")
    .single();
  if (error) throw new Error(error.message);

  await admin.from("commerce_sale_earnings").update({ status: "paid" }).eq("payout_id", payoutId);

  await sendPushAndBellToUser(admin, payout?.creator_user_id, {
    category: "payout_paid",
    title: "Payout sent",
    body: `Your ${formatPrice(payout.amount, payout.currency)} Shop payout from Ringo Connect has been sent.`,
    url: "/dashboard/shop/earnings",
  });
}

/** Terminal: an admin is declining this specific request — hands the underlying earnings back to
 *  the available pool (unlinked, status back to 'recorded') so the seller can simply request again. */
export async function markShopPayoutRejected(payoutId: string, opts: { adminId: string; note?: string | null }) {
  const admin = createAdminClient();
  const { error } = await admin
    .from("commerce_payouts")
    .update({
      status: "rejected",
      admin_note: opts.note ?? null,
      processed_at: new Date().toISOString(),
      processed_by: opts.adminId,
    })
    .eq("id", payoutId);
  if (error) throw new Error(error.message);

  await admin.from("commerce_sale_earnings").update({ status: "recorded", payout_id: null }).eq("payout_id", payoutId);
}

/** A Fapshi disbursement has been initiated for this payout — money is in flight. Deliberately
 *  does NOT touch the linked earnings. */
export async function markShopPayoutProcessing(payoutId: string, fapshiTransId: string) {
  const admin = createAdminClient();
  const { error } = await admin.from("commerce_payouts").update({ status: "processing", fapshi_trans_id: fapshiTransId }).eq("id", payoutId);
  if (error) throw new Error(error.message);
}

/** A Fapshi disbursement came back FAILED/EXPIRED — the money never left, so the SAME payout row
 *  simply becomes retryable again. Linked earnings are left alone (still 'requested', still
 *  linked). Also tells the seller their payout couldn't be completed this time. */
export async function revertShopPayoutToRequested(payoutId: string, note?: string | null) {
  const admin = createAdminClient();
  const { data: payout, error } = await admin
    .from("commerce_payouts")
    .update({ status: "requested", admin_note: note ?? null })
    .eq("id", payoutId)
    .select("creator_user_id, amount, currency")
    .single();
  if (error) throw new Error(error.message);

  await sendPushAndBellToUser(admin, payout?.creator_user_id, {
    category: "payout_failed",
    title: "Payout couldn't be completed",
    body: `Your ${formatPrice(payout.amount, payout.currency)} Shop payout didn't go through this time. Ringo will retry it.`,
    url: "/dashboard/shop/earnings",
  });
}
