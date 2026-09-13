import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Saves (or refreshes) a browser's Web Push subscription for the signed-in
// user — called from src/lib/push/client.ts's enablePush(). Uses the
// regular per-request client, not the admin one: RLS on push_subscriptions
// (see the migration) already scopes this to the caller's own user_id,
// the same "let RLS be the real boundary" posture the rest of this app's
// owner-scoped writes use.
export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const subscription = body?.subscription;
  const endpoint = subscription?.endpoint;
  const p256dh = subscription?.keys?.p256dh;
  const auth = subscription?.keys?.auth;

  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: "Invalid subscription." }, { status: 400 });
  }

  // Upsert on endpoint (globally unique — see the migration) rather than
  // on user_id: the same browser resubscribing (e.g. after the keys
  // rotate) updates its own row instead of creating a duplicate, and a
  // subscription that somehow outlives a sign-out/sign-in as a different
  // user correctly gets reassigned rather than left orphaned.
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: user.id,
      endpoint,
      p256dh,
      auth,
      user_agent: typeof body?.userAgent === "string" ? body.userAgent.slice(0, 500) : null,
    },
    { onConflict: "endpoint" }
  );

  if (error) {
    console.error("push_subscriptions upsert failed:", error.message);
    return NextResponse.json({ error: "Could not save your subscription." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
