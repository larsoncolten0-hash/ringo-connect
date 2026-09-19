import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { createCustomerSession, isSameOrigin, revokeCustomerSessions, setCustomerSessionCookie } from "@/lib/customer/session";
import { verifyLoginCode } from "@/lib/customer/codes";
import {
  EMAIL_RE,
  connectCustomerToProfile,
  getConnectableProfile,
  syncMarketingSubscribers,
  upsertVerifiedCustomer,
} from "@/lib/customer/connect";

// The emailed-code path — used when the email typed on the Stay Connected form
// ALREADY has a customer account (a brand-new email never gets here: it is created
// directly, see /connect/register). The code check and its consumption are ONE
// atomic database call (row lock, attempt cap, email-wide failure ceiling, single
// use); every failure looks identical to the caller. Only after it passes do we
// reuse the customer, start the session and record the connection.
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Invalid request." }, { status: 403 });

  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase().slice(0, 200) : "";
  const code = typeof body?.code === "string" ? body.code.trim() : "";

  if (!EMAIL_RE.test(email) || !/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "invalid_code" }, { status: 400 });
  }

  const admin = createAdminClient();

  const verified = await verifyLoginCode(admin, email, code);
  if (!verified) return NextResponse.json({ error: "invalid_code" }, { status: 400 });

  const customer = await upsertVerifiedCustomer(admin, {
    email,
    name: verified.pendingName?.trim() || email.split("@")[0],
    phone: verified.pendingPhone,
    language: verified.language,
  });
  if (!customer) return NextResponse.json({ error: "server_error" }, { status: 500 });

  // Full row for the connect step (existing customers keep THEIR saved
  // name/phone, not what this form said).
  const { data: saved } = await admin.from("ringo_customers").select("id, name, email, phone").eq("id", customer.id).single();
  if (!saved) return NextResponse.json({ error: "server_error" }, { status: 500 });

  // This account was created without confirming the email, and the person who
  // just proved they own it is now signing in: every session that already exists
  // for it belongs to whoever typed the address at creation, who never proved
  // anything. Revoke them all before issuing this one.
  if (customer.wasUnconfirmed) await revokeCustomerSessions(admin, { customerId: customer.id });

  const session = await createCustomerSession(admin, saved.id, request.headers.get("user-agent"));

  // The profile is re-validated NOW (it may have been unpublished since the
  // code was requested) — never trusted from when the form was submitted.
  const profile = await getConnectableProfile(admin, verified.pendingProfileId);
  let connected = false;
  if (profile) {
    const result = await connectCustomerToProfile(admin, {
      customer: { ...saved, emailConfirmed: true },
      profile,
      marketingConsent: verified.pendingMarketingConsent,
      source: verified.pendingSource || "ringo_profile",
    });
    connected = result.ok;
  }
  // Marketing ticks made earlier against the unconfirmed email can now take effect.
  if (customer.wasUnconfirmed) await syncMarketingSubscribers(admin, saved);

  const response = NextResponse.json({
    ok: true,
    connected,
    name: saved.name,
    profileName: profile ? profile.name || profile.username : null,
  });
  setCustomerSessionCookie(response, session.token, session.expiresAt);
  return response;
}
