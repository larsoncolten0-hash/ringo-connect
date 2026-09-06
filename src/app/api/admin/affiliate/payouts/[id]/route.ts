import { assertAdmin } from "@/lib/assertAdmin";
import { createAdminClient } from "@/lib/supabase/server";
import { markPayoutPaid, markPayoutRejected } from "@/lib/affiliate";
import { NextResponse } from "next/server";

// Manual resolution — an admin attesting a payout was completed (or
// declining it) by their own action, as opposed to the automated Fapshi
// disbursement flow in ./send and ./check. Works from either 'requested'
// or 'processing' (e.g. a Fapshi payout that's stuck, or one the admin
// completed some other way) — never from an already-terminal state.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const admin = await assertAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { action, note } = await request.json().catch(() => ({}));
  if (!["paid", "rejected"].includes(action)) {
    return NextResponse.json({ error: "Invalid action." }, { status: 400 });
  }

  const adminClient = createAdminClient();

  const { data: payout } = await adminClient.from("affiliate_payouts").select("id, status").eq("id", params.id).single();
  if (!payout) return NextResponse.json({ error: "Payout not found." }, { status: 404 });
  if (!["requested", "processing"].includes(payout.status)) {
    return NextResponse.json({ error: "This payout has already been processed." }, { status: 400 });
  }

  try {
    if (action === "paid") {
      await markPayoutPaid(params.id, { adminId: admin.id, note: note || null });
    } else {
      await markPayoutRejected(params.id, { adminId: admin.id, note: note || null });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Could not update this payout." }, { status: 500 });
  }

  await adminClient.from("admin_audit_log").insert({
    admin_id: admin.id,
    action: "resolve_affiliate_payout",
    details: { payoutId: params.id, resolution: action, note: note || null },
  });

  return NextResponse.json({ ok: true });
}
