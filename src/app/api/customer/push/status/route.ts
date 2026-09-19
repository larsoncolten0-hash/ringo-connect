import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getCustomerFromCookie, isSameOrigin } from "@/lib/customer/session";

// Whether THIS device (identified by its push endpoint) is registered for the
// signed-in customer's notifications. A browser can hold a push subscription
// that belongs to something else (e.g. the creator dashboard), so the local
// browser state alone must not be shown as "customer notifications on".
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Invalid request." }, { status: 403 });

  const session = await getCustomerFromCookie();
  if (!session) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (typeof body?.endpoint !== "string" || body.endpoint.length > 2000) {
    return NextResponse.json({ registered: false });
  }

  const { data } = await createAdminClient()
    .from("customer_push_subscriptions")
    .select("id")
    .eq("customer_id", session.customer.id)
    .eq("endpoint", body.endpoint)
    .maybeSingle();

  return NextResponse.json({ registered: !!data }, { headers: { "Cache-Control": "no-store" } });
}
