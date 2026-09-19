import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { createCustomerSession, isSameOrigin, setCustomerSessionCookie } from "@/lib/customer/session";
import { checkStartRateLimits, getClientIp, hashIp, recordRegistrationAttempt } from "@/lib/customer/codes";
import {
  EMAIL_RE,
  PHONE_RE,
  connectCustomerToProfile,
  createUnconfirmedCustomer,
  getConnectableProfile,
} from "@/lib/customer/connect";

// Stay Connected for a NEW customer: name + phone + email → the customer exists,
// a session starts and the connection is made, all in this one request. No email
// is sent and no code is asked for; confirming the email is optional and happens
// later from the avatar menu.
//
// SECURITY: this must never sign anyone into an EXISTING account. If the email
// already belongs to a customer, nothing is created and the answer is
// `account_exists` — the form then falls back to the emailed-code sign-in
// (/connect/start), so knowing someone's email is never enough to open their My
// Ringo. (The trade-off: this route reveals that an email has an account. It's
// rate-limited per email and per IP like the code routes.)
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Invalid request." }, { status: 403 });

  const body = await request.json().catch(() => null);

  // Honeypot — identical-looking success, nothing stored.
  if (typeof body?.website === "string" && body.website.trim() !== "") {
    return NextResponse.json({ ok: true });
  }

  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 120) : "";
  const phone = typeof body?.phone === "string" ? body.phone.trim().slice(0, 40) : "";
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase().slice(0, 200) : "";
  const language: "en" | "fr" = body?.language === "en" ? "en" : "fr";
  // Only an explicit `true` counts as marketing consent.
  const marketingConsent = body?.marketing_consent === true;

  if (!name) return NextResponse.json({ error: "invalid_name" }, { status: 400 });
  if (!PHONE_RE.test(phone)) return NextResponse.json({ error: "invalid_phone" }, { status: 400 });
  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: "invalid_email" }, { status: 400 });

  const admin = createAdminClient();

  const profile = await getConnectableProfile(admin, body?.profile_id);
  if (!profile) return NextResponse.json({ error: "Profile not found." }, { status: 404 });

  const ip = getClientIp(request.headers);
  const ipHash = ip ? hashIp(ip) : null;

  // The 60-second resend cooldown is about emailing; only the hourly caps matter here.
  const limit = await checkStartRateLimits(admin, email, ipHash);
  if (limit === "email_hourly" || limit === "ip_hourly") return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  await recordRegistrationAttempt(admin, { email, ipHash, language });

  const created = await createUnconfirmedCustomer(admin, { email, name, phone, language });
  if (created.status === "exists") return NextResponse.json({ error: "account_exists" }, { status: 409 });
  if (created.status === "migration_pending") return NextResponse.json({ error: "server_error" }, { status: 503 });
  if (created.status === "error") return NextResponse.json({ error: "server_error" }, { status: 500 });

  const customerId = created.customer.id;
  const session = await createCustomerSession(admin, customerId, request.headers.get("user-agent"));

  const result = await connectCustomerToProfile(admin, {
    customer: { id: customerId, name, email, phone, emailConfirmed: false },
    profile,
    marketingConsent,
    source: "ringo_profile",
  });

  const response = NextResponse.json({
    ok: true,
    connected: result.ok,
    name,
    profileName: profile.name || profile.username,
  });
  setCustomerSessionCookie(response, session.token, session.expiresAt);
  return response;
}
