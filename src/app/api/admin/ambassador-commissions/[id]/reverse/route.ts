import { assertAdmin } from "@/lib/assertAdmin";
import { createAdminClient } from "@/lib/supabase/server";
import { reverseCommission } from "@/lib/ambassador/adminPayouts";
import { NextResponse } from "next/server";

// Ambassador Program (Phase H) — reverse one commission ledger row through the
// approved ambassador_reverse_commission() function (a paid row is never
// edited; a NEW negative row is recorded). Admin-only; a reason is required.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const admin = await assertAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.json().catch(() => null);
  const result = await reverseCommission(createAdminClient(), admin.id, params.id, body?.reason);
  if (!result.ok) return NextResponse.json({ code: result.code }, { status: result.status });
  return NextResponse.json({ ok: true });
}
