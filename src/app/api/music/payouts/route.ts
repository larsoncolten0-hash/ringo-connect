import { createClient, createAdminClient } from "@/lib/supabase/server";
import { requestMusicPayout } from "@/lib/musicEarnings";
import { sendPushAndBellToAdmins } from "@/lib/push/withBell";
import { formatPrice } from "@/lib/currency";
import { NextResponse } from "next/server";

// Mirrors /api/affiliate/payouts/route.ts exactly — requesting a payout is
// intentionally NOT computed here, it's a single atomic Postgres function
// (request_music_payout) that sums and locks eligible earnings in one
// transaction, so two rapid clicks can never both succeed against the same
// balance. See supabase/migrations/2026-09-20_music_payments.sql.
export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // Demo accounts (see supabase/migrations/2026-10-13_demo_accounts.sql)
  // must never end up in a real admin's payout queue expecting a real
  // Fapshi disbursement.
  const { data: demoProfile } = await supabase.from("profiles").select("is_demo").eq("user_id", user.id).maybeSingle();
  if (demoProfile?.is_demo) {
    return NextResponse.json({ code: "demo_payout_disabled", error: "Payout requests aren't available in demo mode." }, { status: 403 });
  }

  const { currency } = await request.json().catch(() => ({}));
  if (!["XAF", "USD"].includes(currency)) {
    return NextResponse.json({ error: "Unsupported currency." }, { status: 400 });
  }

  try {
    const payout = await requestMusicPayout(currency);
    // Admin client, not the request-scoped `supabase` above — an
    // artist's own session has no RLS access to the admin roster or to
    // other users' push_subscriptions rows.
    await sendPushAndBellToAdmins(createAdminClient(), {
      category: "payout_requested",
      title: "Music payout requested",
      body: `A ${formatPrice(payout?.amount, payout?.currency || currency)} payout was requested.`,
      url: "/admin/music-payouts",
    });
    return NextResponse.json({ ok: true, payout });
  } catch (err: any) {
    // The RPC's own exceptions (below minimum, no payout method set) are
    // meant to be shown to the artist as-is.
    return NextResponse.json({ error: err.message || "Could not request a payout." }, { status: 400 });
  }
}
