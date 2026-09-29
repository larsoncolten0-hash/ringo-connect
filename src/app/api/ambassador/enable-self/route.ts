import { createClient, createAdminClient } from "@/lib/supabase/server";
import { enableSelfAsAmbassador } from "@/lib/ambassador/selfEnable";
import { NextResponse } from "next/server";

// A Team Leader adds their OWN account as an Ambassador (see
// src/lib/ambassador/selfEnable.ts). The person is the signed-in session user;
// the request body is not read at all, so nothing a client sends can choose the
// team, the code, the status or another person. Responses carry stable codes.
const STATUS: Record<string, number> = { not_team_leader: 403, team_inactive: 403, profile_inactive: 403, demo: 403, unavailable: 500 };

export async function POST() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ code: "unauthenticated" }, { status: 401 });

  const result = await enableSelfAsAmbassador(createAdminClient(), user.id);
  if (!result.ok) return NextResponse.json({ code: result.code }, { status: STATUS[result.code] ?? 400 });
  return NextResponse.json({ ok: true, salesCode: result.salesCode, already: result.already });
}
