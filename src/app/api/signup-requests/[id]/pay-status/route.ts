import { createAdminClient } from "@/lib/supabase/server";
import { fapshiGetStatus } from "@/lib/fapshi";
import { NextResponse } from "next/server";

// Public — same customer-facing pattern as the pay route this checks on.
// Never trust a claimed status from the client, always re-verify with an
// authenticated GET straight to Fapshi.
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const admin = createAdminClient();
  const { data: signupRequest } = await admin
    .from("signup_requests")
    .select("pending_fapshi_trans_id")
    .eq("id", params.id)
    .single();

  if (!signupRequest?.pending_fapshi_trans_id) {
    return NextResponse.json({ error: "No payment has been started for this request." }, { status: 404 });
  }

  try {
    const tx = await fapshiGetStatus(signupRequest.pending_fapshi_trans_id);
    return NextResponse.json({ status: tx.status, transId: tx.transId });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Could not check payment status." }, { status: 502 });
  }
}
