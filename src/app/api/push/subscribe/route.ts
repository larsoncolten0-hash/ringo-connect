import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Push subscribe for an authenticated Ringo Connect user — a creator
// enabling notifications from DashboardShell's header, or an admin from
// AdminShell's sidebar (see NotificationBell.tsx, used in both). A
// request-scoped client, not the admin client — RLS's "push_subscriptions
// owner all" policy is what actually restricts this write to the
// caller's own user_id, same pattern /api/orders/[id]/status already
// uses for an authenticated owner-scoped update.
export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const subscription = body?.subscription;
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return NextResponse.json({ error: "Invalid subscription." }, { status: 400 });
  }

  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: user.id,
      // Explicit nulls, not just omitted — an upsert's ON CONFLICT DO
      // UPDATE only touches the columns actually listed, so if this exact
      // endpoint was previously owned by a different kind (e.g. this
      // browser subscribed as a guest restaurant customer before this
      // user ever signed in), leaving these out would keep the old
      // owner column set too and trip the one-owner check constraint.
      subscriber_id: null,
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
    console.error("push subscribe failed:", error.message);
    return NextResponse.json({ error: "Could not save subscription." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
