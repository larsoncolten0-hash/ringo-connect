import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getCustomerFromCookie, isSameOrigin } from "@/lib/customer/session";

// Push subscribe for a Ringo CUSTOMER — writes customer_push_subscriptions
// only, never the legacy push_subscriptions table. Same body shape the
// existing subscribeToPush() client helper already POSTs
// ({ subscription, userAgent }), authenticated by the customer session
// cookie; customer_id comes from the session, never the body.
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Invalid request." }, { status: 403 });

  const session = await getCustomerFromCookie();
  if (!session) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const subscription = body?.subscription;
  if (
    typeof subscription?.endpoint !== "string" ||
    subscription.endpoint.length > 2000 ||
    !subscription.endpoint.startsWith("https://") ||
    typeof subscription?.keys?.p256dh !== "string" ||
    typeof subscription?.keys?.auth !== "string"
  ) {
    return NextResponse.json({ error: "Invalid subscription." }, { status: 400 });
  }

  const { error } = await createAdminClient()
    .from("customer_push_subscriptions")
    .upsert(
      {
        customer_id: session.customer.id,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        user_agent: typeof body?.userAgent === "string" ? body.userAgent.slice(0, 300) : null,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "endpoint" }
    );

  if (error) {
    console.error("customer push subscribe failed:", error.message);
    return NextResponse.json({ error: "Could not save your subscription." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
