import { createClient, createAdminClient } from "@/lib/supabase/server";
import { requestAffiliatePayout } from "@/lib/affiliate";
import { sendPushToAdmins } from "@/lib/push/send";
import { formatPrice } from "@/lib/currency";
import { NextResponse } from "next/server";

// Requesting a payout is intentionally NOT computed here — it's a single
// atomic Postgres function (request_affiliate_payout) that sums and locks
// the eligible commissions in one transaction, so two rapid clicks (or a
// double-submit) can never both succeed against the same balance. See
// supabase/migrations/2026-09-06_affiliate_system.sql.
export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { currency } = await request.json().catch(() => ({}));
  if (!["XAF", "USD"].includes(currency)) {
    return NextResponse.json({ error: "Unsupported currency." }, { status: 400 });
  }

  try {
    const payout = await requestAffiliatePayout(currency);
    // Admin client, not the request-scoped `supabase` above — an
    // affiliate's own session has no RLS access to the admin roster or to
    // other users' push_subscriptions rows.
    await sendPushToAdmins(createAdminClient(), {
      category: "payout_requested",
      title: "Affiliate payout requested",
      body: `A ${formatPrice(payout?.amount, payout?.currency || currency)} payout was requested.`,
      url: "/admin/affiliates",
    });
    return NextResponse.json({ ok: true, payout });
  } catch (err: any) {
    // The RPC's own exceptions (below minimum, no payout method set) are
    // meant to be shown to the affiliate as-is.
    return NextResponse.json({ error: err.message || "Could not request a payout." }, { status: 400 });
  }
}
