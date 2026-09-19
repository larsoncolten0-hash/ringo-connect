import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getCustomerFromCookie, isSameOrigin } from "@/lib/customer/session";

// Removes one of THIS customer's device subscriptions (matched by endpoint AND
// the session's customer id, so it can't delete anyone else's). Same body
// shape the existing unsubscribeFromPush() client helper posts.
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Invalid request." }, { status: 403 });

  const session = await getCustomerFromCookie();
  if (!session) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (typeof body?.endpoint !== "string" || body.endpoint.length > 2000) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const { error } = await createAdminClient()
    .from("customer_push_subscriptions")
    .delete()
    .eq("customer_id", session.customer.id)
    .eq("endpoint", body.endpoint);
  if (error) {
    console.error("customer push unsubscribe failed:", error.message);
    return NextResponse.json({ error: "Could not turn off notifications." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
