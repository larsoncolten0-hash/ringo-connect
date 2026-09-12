import { assertAdmin } from "@/lib/assertAdmin";
import { createAdminClient } from "@/lib/supabase/server";
import { fapshiGetStatus } from "@/lib/fapshi";
import { markMusicPayoutPaid, revertMusicPayoutToRequested } from "@/lib/musicEarnings";
import { NextResponse } from "next/server";

// Mirrors /api/admin/affiliate/payouts/[id]/check/route.ts exactly.
// Re-checks a payout that's mid-flight at Fapshi ('processing') against
// Fapshi's own /payment-status endpoint and finalizes it. Only ever trusts
// what Fapshi's own API says when asked directly, never a client-supplied
// status.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const admin = await assertAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const adminClient = createAdminClient();
  const { data: payout } = await adminClient.from("music_payouts").select("id, status, fapshi_trans_id").eq("id", params.id).single();

  if (!payout) return NextResponse.json({ error: "Payout not found." }, { status: 404 });
  if (payout.status !== "processing" || !payout.fapshi_trans_id) {
    return NextResponse.json({ error: "This payout has no Fapshi disbursement in progress." }, { status: 400 });
  }

  try {
    const tx = await fapshiGetStatus(payout.fapshi_trans_id, { disbursement: true });

    if (tx.status === "SUCCESSFUL") {
      await markMusicPayoutPaid(payout.id, { adminId: admin.id, note: `Fapshi ${payout.fapshi_trans_id} confirmed successful.` });
    } else if (tx.status === "FAILED" || tx.status === "EXPIRED") {
      await revertMusicPayoutToRequested(
        payout.id,
        `Fapshi disbursement ${tx.status.toLowerCase()}${tx.reason ? `: ${tx.reason}` : ""} — eligible to retry.`
      );
    }
    // CREATED: still in flight, nothing to do yet — the admin can check again shortly.

    await adminClient.from("admin_audit_log").insert({
      admin_id: admin.id,
      action: "check_music_payout_fapshi",
      details: { payoutId: payout.id, transId: payout.fapshi_trans_id, fapshiStatus: tx.status },
    });

    return NextResponse.json({ ok: true, status: tx.status });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Could not check the Fapshi transaction." }, { status: 502 });
  }
}
