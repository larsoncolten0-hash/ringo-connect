import { createClient, createAdminClient } from "@/lib/supabase/server";
import { addPendingAmbassador } from "@/lib/ambassador/teamMembers";
import { NextResponse } from "next/server";

// A Team Leader adds an existing Ringo account to THEIR team as a PENDING
// Ambassador (see src/lib/ambassador/teamMembers.ts). The Team Leader is the
// signed-in session user; the body contributes only a username. It cannot
// choose the team, the status, the code, or anyone's permissions — the new
// Ambassador can do nothing until Ringo Management approves them. Responses
// carry stable codes and never any personal data about the person added.
const STATUS: Record<string, number> = {
  not_team_leader: 403,
  team_inactive: 403,
  invalid_username: 400,
  user_not_found: 404,
  cannot_add_self: 400,
  already_ambassador: 409,
  account_unavailable: 409,
  too_many_pending: 429,
  unavailable: 500,
};

export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ code: "unauthenticated" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const result = await addPendingAmbassador(createAdminClient(), user.id, body?.username);
  if (!result.ok) return NextResponse.json({ code: result.code }, { status: STATUS[result.code] ?? 400 });
  return NextResponse.json({ ok: true, username: result.username });
}
