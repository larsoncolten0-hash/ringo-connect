import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getCustomerFromCookie, isSameOrigin } from "@/lib/customer/session";
import { connectCustomerToProfile, getConnectableProfile } from "@/lib/customer/connect";

// Connect for an ALREADY signed-in customer — one tap, no form. The
// customer id comes only from the session cookie; the profile is
// re-validated server-side (must exist and be published).
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Invalid request." }, { status: 403 });

  const session = await getCustomerFromCookie();
  if (!session) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const admin = createAdminClient();

  const profile = await getConnectableProfile(admin, body?.profile_id);
  if (!profile) return NextResponse.json({ error: "Profile not found." }, { status: 404 });

  const result = await connectCustomerToProfile(admin, {
    customer: { ...session.customer, emailConfirmed: !!session.customer.email_verified_at },
    profile,
    // Only an explicit `true` counts; anything else is "no consent".
    marketingConsent: body?.marketing_consent === true,
    source: "ringo_profile",
  });
  if (!result.ok) return NextResponse.json({ error: "Could not connect — try again." }, { status: 500 });

  return NextResponse.json({ ok: true, profileName: profile.name || profile.username });
}
