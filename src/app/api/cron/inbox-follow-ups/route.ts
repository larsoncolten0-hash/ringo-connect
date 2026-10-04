import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { notifyUser } from "@/lib/notifications";
import { runFollowUps } from "@/lib/inbox/automation";

// Daily cron: WhatsApp Inbox follow-up reminders. Same CRON_SECRET bearer-auth pattern as every other cron route in this project.
// It sends NOTHING to any customer. inbox_claim_follow_ups() atomically claims each unanswered customer message exactly once (so overlapping or
// retried runs never remind twice) and returns who to tell; this route then raises one in-app notification per owner-conversation.
// A profile that has not enabled follow-up reminders is never included (the database decides).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
  try {
    const { claimed, notified } = await runFollowUps({ admin, notify: notifyUser });
    return NextResponse.json({ claimed, notified });
  } catch {
    return NextResponse.json({ error: "claim_failed" }, { status: 500 });
  }
}
