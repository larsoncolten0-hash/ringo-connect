import { assertAdmin } from "@/lib/assertAdmin";
import { createAdminClient } from "@/lib/supabase/server";
import { fapshiGetStatus } from "@/lib/fapshi";
import { NextResponse } from "next/server";

// Same defensive pattern as the creator-facing checkout: never trust a
// claimed status from the client, always re-verify with an authenticated
// GET straight to Fapshi. There's no webhook in this admin-initiated
// flow at all — this polling is the only verification mechanism, so it
// matters even more here than in the self-service path.
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const admin = await assertAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const adminClient = createAdminClient();
  const { data: signupRequest } = await adminClient
    .from("signup_requests")
    .select("pending_fapshi_trans_id")
    .eq("id", params.id)
    .single();

  if (!signupRequest?.pending_fapshi_trans_id) {
    return NextResponse.json({ error: "No charge has been started for this request." }, { status: 404 });
  }

  try {
    const tx = await fapshiGetStatus(signupRequest.pending_fapshi_trans_id);
    return NextResponse.json({ status: tx.status, transId: tx.transId });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Could not check payment status." }, { status: 502 });
  }
}