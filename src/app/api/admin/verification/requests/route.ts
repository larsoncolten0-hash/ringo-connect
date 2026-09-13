import { assertAdmin } from "@/lib/assertAdmin";
import { createAdminClient } from "@/lib/supabase/server";
import { listVerificationRequests } from "@/lib/verification";
import { NextResponse } from "next/server";

// The admin verification queue's list — polled by
// VerificationRequestsView.tsx for a live-feeling list without a
// Realtime dependency, same posture as the support inbox
// (see src/app/api/admin/support/conversations/route.ts's own comment).
export async function GET() {
  const adminUser = await assertAdmin();
  if (!adminUser) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const requests = await listVerificationRequests(createAdminClient());
  return NextResponse.json({ requests });
}
