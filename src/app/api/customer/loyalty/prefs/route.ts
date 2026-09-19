import { NextResponse } from "next/server";
import { getCustomerFromCookie, isSameOrigin } from "@/lib/customer/session";
import { getLoyaltyPrefs, parsePrefsPatch, setLoyaltyPrefs } from "@/lib/loyalty/prefs";

// The signed-in customer's LOYALTY notification preferences. The customer id comes only from the
// session cookie. These are independent of marketing consent (per business, on the connection)
// and of the per-device push permission; this route never reads or writes either.
export async function GET() {
  const session = await getCustomerFromCookie();
  if (!session) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });

  const prefs = await getLoyaltyPrefs(session.customer.id);
  return NextResponse.json({ prefs, emailConfirmed: !!session.customer.email_verified_at }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Invalid request." }, { status: 403 });

  const session = await getCustomerFromCookie();
  if (!session) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });

  const patch = parsePrefsPatch(await request.json().catch(() => null));
  if (!patch) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const prefs = await setLoyaltyPrefs(session.customer.id, patch);
  if (!prefs) return NextResponse.json({ error: "server_error" }, { status: 500 });
  return NextResponse.json({ prefs }, { headers: { "Cache-Control": "no-store" } });
}
