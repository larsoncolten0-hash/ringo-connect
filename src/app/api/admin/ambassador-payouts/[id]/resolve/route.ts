import { assertAdmin } from "@/lib/assertAdmin";
import { createAdminClient } from "@/lib/supabase/server";
import { resolveUncertainPayout } from "@/lib/ambassador/adminPayouts";
import { NextResponse } from "next/server";

// Ambassador Program — an admin's explicit, noted, audited decision about a
// payout whose Fapshi outcome was UNCERTAIN, made after checking Fapshi's own
// dashboard: outcome "sent" (needs the Fapshi transaction id) or "not_sent".
// The database function enforces the state machine; this route never re-sends.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const admin = await assertAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.json().catch(() => null);
  const result = await resolveUncertainPayout(createAdminClient(), admin.id, params.id, { outcome: body?.outcome, note: body?.note, fapshiTransId: body?.fapshiTransId });
  if (!result.ok) return NextResponse.json({ code: result.code }, { status: result.status });
  return NextResponse.json({ ok: true, outcome: result.outcome });
}
