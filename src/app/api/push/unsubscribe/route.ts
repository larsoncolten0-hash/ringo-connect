import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Removes a browser's Web Push subscription — called from
// src/lib/push/client.ts's disablePush(). The client has already called
// subscription.unsubscribe() locally by the time this runs; this just
// stops the server from trying to push to a browser that no longer wants
// it. RLS scopes the delete to the caller's own rows regardless, but the
// explicit .eq("user_id", ...) keeps the intent readable here.
export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { endpoint } = await request.json().catch(() => ({}));
  if (!endpoint) return NextResponse.json({ error: "Missing endpoint." }, { status: 400 });

  await supabase.from("push_subscriptions").delete().eq("user_id", user.id).eq("endpoint", endpoint);

  return NextResponse.json({ ok: true });
}
