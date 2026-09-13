import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// One shared unsubscribe route for all three owner kinds (authenticated
// user, fan, guest order-watcher) — matched purely by `endpoint`, no
// separate auth check needed. A push endpoint is itself an unguessable,
// per-device secret URL the push service issued; knowing it is exactly
// the same "the token/id itself is the credential" reasoning this app
// already applies to unsubscribe_token and order ids elsewhere. The
// admin client is used because two of the three owner kinds
// (subscriber_id/order_id rows) have no RLS policy allowing a request-
// scoped client to touch them at all.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const endpoint = body?.endpoint;
  if (typeof endpoint !== "string" || !endpoint) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const admin = createAdminClient();
  await admin.from("push_subscriptions").delete().eq("endpoint", endpoint);

  return NextResponse.json({ ok: true });
}
