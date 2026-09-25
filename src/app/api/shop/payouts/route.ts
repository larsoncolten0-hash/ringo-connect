import { createClient, createAdminClient } from "@/lib/supabase/server";
import { requestShopPayout } from "@/lib/shopPayouts";
import { sendPushAndBellToAdmins } from "@/lib/push/withBell";
import { formatPrice } from "@/lib/currency";
import { NextResponse } from "next/server";

// Mirrors /api/music/payouts/route.ts exactly. Requesting a payout is intentionally NOT computed
// here — it's a single atomic Postgres function (request_commerce_payout) that sums and locks
// eligible earnings in one transaction, so two rapid clicks can never both succeed against the
// same balance. See supabase/migrations/2026-11-05_shop_payouts.sql. No currency in the request
// body: Shop is XAF-only, and the amount itself is always server/RPC-computed from the seller's
// own eligible commerce_sale_earnings rows — never anything the client can influence.
export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // Demo accounts (see supabase/migrations/2026-10-13_demo_accounts.sql) must never end up in a
  // real admin's payout queue expecting a real Fapshi disbursement. In practice a demo profile
  // can never have real commerce_sale_earnings either (checkout is already blocked for demo
  // profiles), but this keeps the error message honest instead of "no eligible earnings."
  const { data: demoProfile } = await supabase.from("profiles").select("is_demo").eq("user_id", user.id).maybeSingle();
  if (demoProfile?.is_demo) {
    return NextResponse.json({ code: "demo_payout_disabled", error: "Payout requests aren't available in demo mode." }, { status: 403 });
  }

  try {
    const payout = await requestShopPayout();
    // Admin client, not the request-scoped `supabase` above — a seller's own session has no RLS
    // access to the admin roster or to other users' push_subscriptions rows.
    await sendPushAndBellToAdmins(createAdminClient(), {
      category: "payout_requested",
      title: "Shop payout requested",
      body: `A ${formatPrice(payout?.amount, payout?.currency || "XAF")} Shop payout was requested.`,
      url: "/admin/shop-payouts",
    });
    return NextResponse.json({ ok: true, payout });
  } catch (err: any) {
    // The RPC's own exceptions (below minimum, no payout method set) are meant to be shown to
    // the seller as-is.
    return NextResponse.json({ error: err.message || "Could not request a payout." }, { status: 400 });
  }
}
