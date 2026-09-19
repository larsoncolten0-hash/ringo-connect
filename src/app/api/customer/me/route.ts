import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getCustomerFromCookie } from "@/lib/customer/session";
import { isUuid } from "@/lib/customer/connect";

// Read-only "who am I / am I connected to this profile" — what the public
// profile's Connect button asks on load. Returns the customer's first name
// only (never email/phone) and never varies by anything but the cookie.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const noStore = { headers: { "Cache-Control": "no-store" } };
  const session = await getCustomerFromCookie();
  if (!session) return NextResponse.json({ authenticated: false }, noStore);

  const profileId = new URL(request.url).searchParams.get("profile_id");
  let connected = false;
  if (isUuid(profileId)) {
    const { data } = await createAdminClient()
      .from("customer_connections")
      .select("id")
      .eq("customer_id", session.customer.id)
      .eq("profile_id", profileId)
      .eq("status", "active")
      .maybeSingle();
    connected = !!data;
  }

  return NextResponse.json({ authenticated: true, name: session.customer.name, connected }, noStore);
}
