import { assertAdmin } from "@/lib/assertAdmin";
import { createAdminClient } from "@/lib/supabase/server";
import { rejectPayout } from "@/lib/ambassador/adminPayouts";
import { NextResponse } from "next/server";

// Ambassador Program — Management declines a requested payout (reason required).
// The commissions return to the ordinary eligible balance inside the database
// function; nothing about the amount or recipient comes from the request.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const admin = await assertAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.json().catch(() => null);
  const result = await rejectPayout(createAdminClient(), admin.id, params.id, body?.reason);
  if (!result.ok) return NextResponse.json({ code: result.code }, { status: result.status });
  return NextResponse.json({ ok: true });
}
