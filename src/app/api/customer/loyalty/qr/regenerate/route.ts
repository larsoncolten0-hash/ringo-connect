import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getCustomerFromCookie, isSameOrigin } from "@/lib/customer/session";
import { getCustomerQrPayload } from "@/lib/loyalty/qr";

// Replace the signed-in customer's Ringo QR. The customer comes ONLY from the session cookie;
// the request body is ignored entirely, so there is nothing a browser could send to rotate
// someone else's code. Only the QR changes: identity, connections, rewards, packages and
// history are untouched. The new code is drawn by the server on the next page load and is never
// returned from here.
const MAX_ROTATIONS_PER_HOUR = 10;

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Invalid request." }, { status: 403 });

  const session = await getCustomerFromCookie();
  if (!session) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });

  const admin = createAdminClient();

  // Each rotation keeps its (revoked) row, so cap how fast a customer can churn them.
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await admin
    .from("customer_qr_codes")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", session.customer.id)
    .gte("created_at", since);
  if ((count ?? 0) >= MAX_ROTATIONS_PER_HOUR) return NextResponse.json({ error: "too_many" }, { status: 429 });

  try {
    await getCustomerQrPayload(session.customer.id, { rotate: true }, admin);
  } catch (err) {
    console.error("customer QR regenerate failed:", (err as any)?.message ?? "unknown error");
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
