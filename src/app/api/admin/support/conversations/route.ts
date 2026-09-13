import { assertAdmin } from "@/lib/assertAdmin";
import { createAdminClient } from "@/lib/supabase/server";
import { listAdminConversations } from "@/lib/support";
import { NextResponse } from "next/server";

// The admin support inbox's list — every creator who has ever messaged
// (or been messaged), newest activity first. Polled by
// SupportInboxView.tsx for a live-feeling list without a Realtime
// dependency, same posture as every other "live" view in this app (see
// RestaurantOrdersView.tsx's own comment on why). Shares its shaping
// logic with the page's own initial server-rendered fetch — see
// src/lib/support.ts.
export async function GET() {
  const adminUser = await assertAdmin();
  if (!adminUser) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const conversations = await listAdminConversations(createAdminClient());
  return NextResponse.json({ conversations });
}
