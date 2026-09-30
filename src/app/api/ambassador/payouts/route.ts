import { createClient, createAdminClient } from "@/lib/supabase/server";
import { requestMyPayout } from "@/lib/ambassador/payouts";
import { NextResponse } from "next/server";

// Ambassador Program — an Ambassador or Team Leader requests their own payout.
// The recipient is the signed-in session user. The body carries ONLY the role
// they are acting as: no amount (SQL sums the eligible rows), no destination
// (SQL reads the owner's private saved destination and enforces its 24-hour
// cooldown), no recipient id. Anything else in the body is ignored. Responses
// carry stable error codes (the client renders the bilingual text), never
// internal messages.
const STATUS: Record<string, number> = {
  invalid_role: 400,
  invalid_method: 400,
  invalid_details: 400,
  not_ambassador: 403,
  not_team_leader: 403,
  suspended: 403,
  pending_approval: 403,
  demo: 403,
  no_destination: 409,
  destination_cooling_down: 409,
  below_minimum: 409,
  nothing_eligible: 409,
  unavailable: 500,
};

export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ code: "unauthenticated" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const result = await requestMyPayout(createAdminClient(), user.id, { role: body?.role });
  if (!result.ok) return NextResponse.json({ code: result.code, minimum: result.minimum, usableAfter: result.usableAfter }, { status: STATUS[result.code] ?? 400 });
  return NextResponse.json({ ok: true, amount: result.amount });
}
