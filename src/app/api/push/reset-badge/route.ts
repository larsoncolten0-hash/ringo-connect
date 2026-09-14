import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Resets ONE device's home-screen badge counter to 0 — called by
// AppBadgeReset.tsx the moment that installed app (profile, dashboard,
// admin, or scanner PWA) is opened. Matched by `endpoint`, same posture
// as /api/push/unsubscribe: possessing that exact PushSubscription object
// in the browser is itself the only "authorization" needed, regardless of
// which owner kind (user/subscriber/order) created the row — an
// unauthenticated fan resetting their own profile-PWA badge is exactly
// the case this has to support, so this can't require a signed-in
// session the way /api/push/subscribe does.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const endpoint = body?.endpoint;
  if (!endpoint || typeof endpoint !== "string") {
    return NextResponse.json({ error: "Missing endpoint." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin.from("push_subscriptions").update({ badge_count: 0 }).eq("endpoint", endpoint);
  if (error) {
    console.error("push reset-badge failed:", error.message);
    return NextResponse.json({ error: "Could not reset badge." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
