import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { clearCustomerSessionCookie, getCustomerFromCookie, isSameOrigin, revokeCustomerSessions } from "@/lib/customer/session";

// Revokes this device's session, or every session with { all: true }
// ("sign out everywhere"). Always clears the cookie, even if the session
// was already gone.
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Invalid request." }, { status: 403 });

  const body = await request.json().catch(() => null);
  const session = await getCustomerFromCookie();

  if (session) {
    const admin = createAdminClient();
    if (body?.all === true) await revokeCustomerSessions(admin, { customerId: session.customer.id });
    else await revokeCustomerSessions(admin, { sessionId: session.sessionId });
  }

  const response = NextResponse.json({ ok: true });
  clearCustomerSessionCookie(response);
  return response;
}
