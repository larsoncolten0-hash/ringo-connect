import { assertAdmin } from "@/lib/assertAdmin";
import { createAdminClient } from "@/lib/supabase/server";
import { getAmbassadorPayoutMinimum, setAmbassadorPayoutMinimum } from "@/lib/ambassador/settings";
import { NextResponse } from "next/server";

// Ambassador Program — read/change the minimum payout (platform_settings.
// ambassador_min_payout_xaf). Admin-only. This only edits the setting; the
// database function is what enforces it on every payout request.
export async function GET() {
  const admin = await assertAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json({ minPayoutXaf: await getAmbassadorPayoutMinimum(createAdminClient()) });
}

export async function POST(request: Request) {
  const admin = await assertAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.json().catch(() => null);
  const result = await setAmbassadorPayoutMinimum(createAdminClient(), admin.id, body?.minPayoutXaf);
  if (!result.ok) return NextResponse.json({ code: result.code }, { status: result.code === "invalid_minimum" ? 400 : 500 });
  return NextResponse.json({ ok: true, minPayoutXaf: result.minimum });
}
