import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getAffiliateSettings } from "@/lib/affiliateSettings";

export type CurrencyTotals = { pending: number; available: number; requested: number; paid: number };

export type AffiliateReferral = {
  id: string;
  email: string;
  username: string | null;
  avatarUrl: string | null;
  planName: string;
  createdAt: string;
};

export type AffiliateCommission = {
  id: string;
  amount: number;
  currency: string;
  status: "pending" | "requested" | "paid" | "reversed";
  availableAt: string;
  createdAt: string;
  referredEmail: string;
};

export type AffiliatePayout = {
  id: string;
  amount: number;
  currency: string;
  status: "requested" | "processing" | "paid" | "rejected";
  requestedAt: string;
  processedAt: string | null;
  adminNote: string | null;
};

export type AffiliateOverview = {
  affiliateCode: string;
  payoutMethod: "mobile_money" | "paypal" | "bank" | null;
  payoutDetails: Record<string, any> | null;
  suspended: boolean;
  settings: {
    enabled: boolean;
    commissionRatePct: number;
    holdDays: number;
    minPayoutXaf: number;
    minPayoutUsd: number;
  };
  totalsByCurrency: Record<string, CurrencyTotals>;
  referralCount: number;
  activeReferralCount: number;
  monthly: { month: string; currency: string; amount: number }[];
  referrals: AffiliateReferral[];
  commissions: AffiliateCommission[];
  payouts: AffiliatePayout[];
};

/** first two chars of the local part + a fixed run of dots, e.g. "jo••••@gmail.com" —
 *  enough for an affiliate to recognize who signed up without seeing the full address. */
function maskEmail(email: string | null | undefined): string {
  if (!email) return "—";
  const at = email.indexOf("@");
  if (at <= 0) return email;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"•".repeat(4)}@${domain}`;
}

function emptyTotals(): CurrencyTotals {
  return { pending: 0, available: 0, requested: 0, paid: 0 };
}

export async function getMyAffiliateOverview(): Promise<AffiliateOverview | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: me }, settings] = await Promise.all([
    supabase
      .from("users")
      .select("affiliate_code, affiliate_payout_method, affiliate_payout_details, affiliate_suspended")
      .eq("id", user.id)
      .single(),
    getAffiliateSettings(),
  ]);

  // Every row gets a code via the DB trigger the moment it's created — a
  // missing one here means the migration hasn't been run yet.
  if (!me?.affiliate_code) return null;

  const [{ data: referredUsers }, { data: commissionRows }, { data: payoutRows }] = await Promise.all([
    supabase
      .from("users")
      .select("id, email, created_at, plans(name), profiles(username, avatar_url)")
      .eq("referred_by", user.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("affiliate_commissions")
      .select("id, amount, currency, status, available_at, created_at, users!referred_user_id(email)")
      .eq("affiliate_user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("affiliate_payouts")
      .select("id, amount, currency, status, requested_at, processed_at, admin_note")
      .eq("affiliate_user_id", user.id)
      .order("requested_at", { ascending: false }),
  ]);

  const now = Date.now();
  const totalsByCurrency: Record<string, CurrencyTotals> = {};
  const monthlyMap = new Map<string, number>(); // key: `${month}|${currency}`

  const commissions: AffiliateCommission[] = (commissionRows || []).map((row: any) => {
    const currency = row.currency as string;
    totalsByCurrency[currency] ??= emptyTotals();
    const amount = Number(row.amount);

    if (row.status === "paid") {
      totalsByCurrency[currency].paid += amount;
    } else if (row.status === "requested") {
      totalsByCurrency[currency].requested += amount;
    } else if (row.status === "pending") {
      if (new Date(row.available_at).getTime() <= now) {
        totalsByCurrency[currency].available += amount;
      } else {
        totalsByCurrency[currency].pending += amount;
      }
    }

    if (row.status !== "reversed") {
      const month = String(row.created_at).slice(0, 7); // "YYYY-MM"
      const key = `${month}|${currency}`;
      monthlyMap.set(key, (monthlyMap.get(key) || 0) + amount);
    }

    return {
      id: row.id,
      amount,
      currency,
      status: row.status,
      availableAt: row.available_at,
      createdAt: row.created_at,
      referredEmail: maskEmail(row.users?.email),
    };
  });

  const monthly = Array.from(monthlyMap.entries())
    .map(([key, amount]) => {
      const [month, currency] = key.split("|");
      return { month, currency, amount };
    })
    .sort((a, b) => a.month.localeCompare(b.month));

  const referrals: AffiliateReferral[] = (referredUsers || []).map((row: any) => {
    // profiles is embedded as an array here — PostgREST treats users->profiles
    // as one-to-many (no unique constraint on profiles.user_id), even though
    // the app enforces one profile per user at the application level. Same
    // pattern as src/components/admin/UserTable.tsx's u.profiles?.[0].
    const profile = row.profiles?.[0];
    return {
      id: row.id,
      email: maskEmail(row.email),
      username: profile?.username ?? null,
      avatarUrl: profile?.avatar_url ?? null,
      planName: row.plans?.name ?? "free",
      createdAt: row.created_at,
    };
  });

  const payouts: AffiliatePayout[] = (payoutRows || []).map((row: any) => ({
    id: row.id,
    amount: Number(row.amount),
    currency: row.currency,
    status: row.status,
    requestedAt: row.requested_at,
    processedAt: row.processed_at,
    adminNote: row.admin_note,
  }));

  return {
    affiliateCode: me.affiliate_code,
    payoutMethod: me.affiliate_payout_method ?? null,
    payoutDetails: (me.affiliate_payout_details as Record<string, any>) ?? null,
    suspended: !!me.affiliate_suspended,
    settings: {
      enabled: settings.affiliateEnabled,
      commissionRatePct: Math.round(settings.affiliateCommissionRate * 10000) / 100,
      holdDays: settings.affiliateHoldDays,
      minPayoutXaf: settings.affiliateMinPayoutXaf,
      minPayoutUsd: settings.affiliateMinPayoutUsd,
    },
    totalsByCurrency,
    referralCount: referrals.length,
    activeReferralCount: referrals.filter((r) => r.planName !== "free").length,
    monthly,
    referrals,
    commissions,
    payouts,
  };
}

export async function saveAffiliatePayoutMethod(
  method: "mobile_money" | "paypal" | "bank",
  details: Record<string, any>
) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { error } = await supabase
    .from("users")
    .update({ affiliate_payout_method: method, affiliate_payout_details: details })
    .eq("id", user.id);
  if (error) throw new Error(error.message);
}

export async function requestAffiliatePayout(currency: "XAF" | "USD") {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("request_affiliate_payout", { p_currency: currency });
  if (error) throw new Error(error.message);
  return data;
}

// ============================================================================
// Admin-facing reads — /admin/affiliates
// ============================================================================

export type AdminAffiliatePayout = {
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
  affiliate: { id: string; email: string; username: string | null };
};

// --- Payout resolution — shared by the manual admin route and the Fapshi
// disbursement routes, so both ways a payout can end up "paid" or back in
// the pool keep the linked commissions in sync the exact same way. ---

/** Terminal: the affiliate has been paid, by whatever method. Commissions
 *  linked to this payout are locked in as paid. */
export async function markPayoutPaid(payoutId: string, opts: { adminId: string; note?: string | null }) {
  const admin = createAdminClient();
  const { error } = await admin
    .from("affiliate_payouts")
    .update({
      status: "paid",
      admin_note: opts.note ?? null,
      processed_at: new Date().toISOString(),
      processed_by: opts.adminId,
    })
    .eq("id", payoutId);
  if (error) throw new Error(error.message);

  await admin.from("affiliate_commissions").update({ status: "paid" }).eq("payout_id", payoutId);
}

/** Terminal: an admin is declining this specific request (wrong details,
 *  etc.) — hands the underlying commissions back to the available pool
 *  (unlinked, status back to 'pending') so the affiliate can simply
 *  request again rather than being stuck. */
export async function markPayoutRejected(payoutId: string, opts: { adminId: string; note?: string | null }) {
  const admin = createAdminClient();
  const { error } = await admin
    .from("affiliate_payouts")
    .update({
      status: "rejected",
      admin_note: opts.note ?? null,
      processed_at: new Date().toISOString(),
      processed_by: opts.adminId,
    })
    .eq("id", payoutId);
  if (error) throw new Error(error.message);

  await admin.from("affiliate_commissions").update({ status: "pending", payout_id: null }).eq("payout_id", payoutId);
}

/** A Fapshi disbursement has been initiated for this payout — money is in
 *  flight. Deliberately does NOT touch the linked commissions: they were
 *  already moved to 'requested' + linked to this payout_id the moment it
 *  was created (see request_affiliate_payout() in the migration), and
 *  stay exactly that way until this resolves one way or the other. */
export async function markPayoutProcessing(payoutId: string, fapshiTransId: string) {
  const admin = createAdminClient();
  const { error } = await admin
    .from("affiliate_payouts")
    .update({ status: "processing", fapshi_trans_id: fapshiTransId })
    .eq("id", payoutId);
  if (error) throw new Error(error.message);
}

/** A Fapshi disbursement came back FAILED/EXPIRED — the money never left,
 *  so this is not a rejection: the SAME payout row simply becomes
 *  retryable again. The linked commissions are left completely alone
 *  (still 'requested', still linked to this payout) — reverting THEM to
 *  'pending' here as well would double up: they'd become available for a
 *  brand new payout request while this one still exists, silently
 *  doubling the affiliate's claimable balance. */
export async function revertPayoutToRequested(payoutId: string, note?: string | null) {
  const admin = createAdminClient();
  const { error } = await admin
    .from("affiliate_payouts")
    .update({ status: "requested", admin_note: note ?? null })
    .eq("id", payoutId);
  if (error) throw new Error(error.message);
}

export type AdminAffiliateOverview = {
  totalsByCurrency: Record<string, { outstanding: number; paid: number }>;
  referredUserCount: number;
  affiliateCount: number;
  payouts: AdminAffiliatePayout[];
  topAffiliates: {
    id: string;
    email: string;
    username: string | null;
    referralCount: number;
    lifetimeByCurrency: Record<string, number>;
  }[];
};

export async function getAdminAffiliateOverview(): Promise<AdminAffiliateOverview> {
  const admin = createAdminClient();

  const [{ data: payoutRows }, { data: commissionRows }, { data: referredCountRows }] = await Promise.all([
    admin
      .from("affiliate_payouts")
      .select(
        "id, amount, currency, status, payout_method, payout_details, admin_note, requested_at, processed_at, fapshi_trans_id, users!affiliate_user_id(id, email, profiles(username))"
      )
      .order("requested_at", { ascending: false })
      .limit(300),
    admin
      .from("affiliate_commissions")
      .select("affiliate_user_id, amount, currency, status, users!affiliate_user_id(email, profiles(username))")
      .neq("status", "reversed")
      .limit(10000),
    admin.from("users").select("id, referred_by").not("referred_by", "is", null).limit(20000),
  ]);

  const totalsByCurrency: Record<string, { outstanding: number; paid: number }> = {};
  const byAffiliate = new Map<
    string,
    { email: string; username: string | null; lifetimeByCurrency: Record<string, number> }
  >();

  for (const row of commissionRows || []) {
    const currency = row.currency as string;
    const amount = Number(row.amount);
    totalsByCurrency[currency] ??= { outstanding: 0, paid: 0 };
    if (row.status === "paid") totalsByCurrency[currency].paid += amount;
    else totalsByCurrency[currency].outstanding += amount;

    const id = row.affiliate_user_id as string;
    // profiles comes back as an array here too — see the comment in
    // getMyAffiliateOverview()'s referrals mapping above.
    const entry = byAffiliate.get(id) ?? {
      email: (row as any).users?.email ?? "—",
      username: (row as any).users?.profiles?.[0]?.username ?? null,
      lifetimeByCurrency: {} as Record<string, number>,
    };
    entry.lifetimeByCurrency[currency] = (entry.lifetimeByCurrency[currency] || 0) + amount;
    byAffiliate.set(id, entry);
  }

  const referralCounts = new Map<string, number>();
  for (const row of referredCountRows || []) {
    const ref = row.referred_by as string;
    referralCounts.set(ref, (referralCounts.get(ref) || 0) + 1);
  }

  const topAffiliates = Array.from(byAffiliate.entries())
    .map(([id, v]) => ({
      id,
      email: v.email,
      username: v.username,
      referralCount: referralCounts.get(id) || 0,
      lifetimeByCurrency: v.lifetimeByCurrency,
    }))
    .sort((a, b) => {
      const totalA = Object.values(a.lifetimeByCurrency).reduce((s, n) => s + n, 0);
      const totalB = Object.values(b.lifetimeByCurrency).reduce((s, n) => s + n, 0);
      return totalB - totalA;
    })
    .slice(0, 20);

  const payouts: AdminAffiliatePayout[] = (payoutRows || []).map((row: any) => ({
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
    affiliate: { id: row.users?.id, email: row.users?.email ?? "—", username: row.users?.profiles?.[0]?.username ?? null },
  }));

  return {
    totalsByCurrency,
    referredUserCount: referredCountRows?.length || 0,
    affiliateCount: byAffiliate.size,
    payouts,
    topAffiliates,
  };
}
