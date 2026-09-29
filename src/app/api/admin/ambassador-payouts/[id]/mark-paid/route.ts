import { assertAdmin } from "@/lib/assertAdmin";
import { createAdminClient } from "@/lib/supabase/server";
import { markPayoutPaidManually } from "@/lib/ambassador/adminPayouts";
import { NextResponse } from "next/server";

// Ambassador Program (Phase H) — admin payout action (mark-paid). Admin-only; the
// payout is identified by the URL id and everything else (recipient, amount,
// destination) is read from the payout row server-side.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const admin = await assertAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.json().catch(() => null);
  const result = await markPayoutPaidManually(createAdminClient(), admin.id, params.id, body?.note);
  if (!result.ok) return NextResponse.json({ code: result.code }, { status: result.status });
  return NextResponse.json(result);
}
