import { assertAdmin } from "@/lib/assertAdmin";
import { createAdminClient } from "@/lib/supabase/server";
import { checkPayoutFapshi } from "@/lib/ambassador/adminPayouts";
import { NextResponse } from "next/server";

// Ambassador Program (Phase H) — admin payout action (check). Admin-only; the
// payout is identified by the URL id and everything else (recipient, amount,
// destination) is read from the payout row server-side.
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const admin = await assertAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const result = await checkPayoutFapshi(createAdminClient(), admin.id, params.id);
  if (!result.ok) return NextResponse.json({ code: result.code }, { status: result.status });
  return NextResponse.json(result);
}
