import { createClient } from "@/lib/supabase/server";
import { requestMusicPayout } from "@/lib/musicEarnings";
import { notifyAdmins } from "@/lib/push/send";
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

  const { currency } = await request.json().catch(() => ({}));
  if (!["XAF", "USD"].includes(currency)) {
    return NextResponse.json({ error: "Unsupported currency." }, { status: 400 });
  }

  try {
    const payout = await requestMusicPayout(currency);
    // Best-effort — see src/lib/push/send.ts. Admin needs to know an
    // artist is now waiting to be paid.
    await notifyAdmins({
      title: "Music payout requested",
      body: `${user.email} requested a payout of ${payout.amount} ${payout.currency}.`,
      url: "/admin/music-payouts",
    });
    return NextResponse.json({ ok: true, payout });
  } catch (err: any) {
    // The RPC's own exceptions (below minimum, no payout method set) are
    // meant to be shown to the artist as-is.
    return NextResponse.json({ error: err.message || "Could not request a payout." }, { status: 400 });
  }
}
