import { assertCanApproveRequests, canReviewerAccessRequest } from "@/lib/assertAdmin";
import { createAdminClient } from "@/lib/supabase/server";
import { fapshiGetStatus } from "@/lib/fapshi";
import { NextResponse } from "next/server";

// Same defensive pattern as the creator-facing checkout: never trust a
// claimed status from the client, always re-verify with an authenticated
// GET straight to Fapshi. There's no webhook in this admin-initiated
// flow at all — this polling is the only verification mechanism, so it
// matters even more here than in the self-service path.
//
// Public-facing pay-status (src/app/api/signup-requests/[id]/pay-status)
// hit a bug where Next.js statically cached this exact shape of route —
// no cookies read besides the auth check, no cache: "no-store" on the
// Fapshi fetch — so a stale status kept getting served forever. This
// route reads cookies via assertCanApproveRequests() (which forces
// dynamic rendering) and fapshiGetStatus() itself now sets
// cache: "no-store", so it isn't at risk of the same thing — but keep
// both of those true if this ever gets refactored.
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const admin = await assertCanApproveRequests();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const adminClient = createAdminClient();
  const { data: signupRequest } = await adminClient
    .from("signup_requests")
    .select("pending_fapshi_trans_id, referral_code")
    .eq("id", params.id)
    .single();

  if (!signupRequest?.pending_fapshi_trans_id) {
    return NextResponse.json({ error: "No charge has been started for this request." }, { status: 404 });
  }
  if (!canReviewerAccessRequest(admin, signupRequest.referral_code)) {
    return NextResponse.json({ error: "No charge has been started for this request." }, { status: 404 });
  }

  try {
    const tx = await fapshiGetStatus(signupRequest.pending_fapshi_trans_id);
    return NextResponse.json({ status: tx.status, transId: tx.transId });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Could not check payment status." }, { status: 502 });
  }
}