import { assertAdmin } from "@/lib/assertAdmin";
import { createAdminClient } from "@/lib/supabase/server";
import { getAdminNavCounts } from "@/lib/adminNavCounts";
import { NextResponse } from "next/server";

// Polled by AdminShell every 15s so the nav's badges (Support,
// Requests, Verification, Affiliates, Music payouts) stay current no
// matter which admin page is actually open — same "no Realtime
// dependency" posture as the rest of this app's "live" views.
export async function GET() {
  const adminUser = await assertAdmin();
  if (!adminUser) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const counts = await getAdminNavCounts(createAdminClient());
  return NextResponse.json(counts);
}
