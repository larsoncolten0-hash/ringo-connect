import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Push subscribe for a fan — a community_subscribers row with no Ringo
// account at all. Authenticated purely by their own unsubscribe_token,
// the same unguessable-uuid credential /community/manage/[token] already
// uses for everything else that subscriber does. Admin client: there's
// no anon RLS policy on push_subscriptions for subscriber_id rows, same
// reasoning as every other community write going through the admin
// client keyed off this token.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const token = body?.token;
  const subscription = body?.subscription;

  if (typeof token !== "string" || !token) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return NextResponse.json({ error: "Invalid subscription." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: subscriber } = await admin
    .from("community_subscribers")
    .select("id")
    .eq("unsubscribe_token", token)
    .maybeSingle();

  if (!subscriber) {
    return NextResponse.json({ error: "Subscriber not found." }, { status: 404 });
  }

  const { error } = await admin.from("push_subscriptions").upsert(
    {
      subscriber_id: subscriber.id,
      // Explicit nulls — see subscribe/route.ts's matching comment: an
      // upsert's ON CONFLICT DO UPDATE only touches listed columns, so a
      // reused endpoint previously owned by a different kind would
      // otherwise trip the one-owner check constraint.
      user_id: null,
      order_id: null,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      user_agent: typeof body?.userAgent === "string" ? body.userAgent.slice(0, 300) : null,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "endpoint" }
  );

  if (error) {
    console.error("push subscribe (subscriber) failed:", error.message);
    return NextResponse.json({ error: "Could not save subscription." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
