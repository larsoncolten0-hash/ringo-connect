import { createClient, createAdminClient } from "@/lib/supabase/server";
import { saveMyDestination } from "@/lib/ambassador/payouts";
import { NextResponse } from "next/server";

// Ambassador Program — an Ambassador or Team Leader saves/changes their OWN
// private payout destination. The owner is the signed-in session user; the body
// carries the role they act as and the destination itself. The response
// contains only the MASKED label and the cooldown time — the full destination
// is never sent back to the browser, and is never logged.
const STATUS: Record<string, number> = {
  invalid_role: 400,
  invalid_method: 400,
  invalid_details: 400,
  not_ambassador: 403,
  not_team_leader: 403,
  suspended: 403,
  pending_approval: 403,
  unavailable: 500,
};

export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ code: "unauthenticated" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const result = await saveMyDestination(createAdminClient(), user.id, { role: body?.role, method: body?.method, details: body?.details });
  if (!result.ok) return NextResponse.json({ code: result.code }, { status: STATUS[result.code] ?? 400 });
  return NextResponse.json({ ok: true, maskedLabel: result.maskedLabel, changed: result.changed, coolingDown: result.coolingDown, usableAfter: result.usableAfter });
}
