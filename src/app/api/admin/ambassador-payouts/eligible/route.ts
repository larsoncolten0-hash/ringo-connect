import { assertAdmin } from "@/lib/assertAdmin";
import { createAdminClient } from "@/lib/supabase/server";
import { markCommissionsEligible } from "@/lib/ambassador/adminPayouts";
import { NextResponse } from "next/server";

// Ambassador Program (Phase H) — Management releases earned commissions for
// payout. Admin-only; the acting admin id comes from the session.
export async function POST(request: Request) {
  const admin = await assertAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.json().catch(() => null);
  const result = await markCommissionsEligible(createAdminClient(), admin.id, body?.ledgerIds);
  if (!result.ok) return NextResponse.json({ code: result.code }, { status: result.status });
  return NextResponse.json({ ok: true, count: result.count });
}
