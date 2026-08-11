import { createClient } from "@/lib/supabase/server";
import { fapshiGetStatus } from "@/lib/fapshi";
import { applySuccessfulPayment, markFailedPayment } from "@/lib/applyPayment";
import { NextResponse } from "next/server";

export async function GET(request: Request, { params }: { params: { transId: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const tx = await fapshiGetStatus(params.transId);

    if (tx.status === "SUCCESSFUL") {
      await applySuccessfulPayment({ provider: "fapshi", providerTransactionId: params.transId });
    } else if (tx.status === "FAILED" || tx.status === "EXPIRED") {
      await markFailedPayment("fapshi", params.transId);
    }

    return NextResponse.json({ status: tx.status });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Could not check payment status" }, { status: 502 });
  }
}