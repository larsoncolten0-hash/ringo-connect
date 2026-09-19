import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { isSameOrigin } from "@/lib/customer/session";
import { EMAIL_RE, PHONE_RE, getConnectableProfile } from "@/lib/customer/connect";
import { checkStartRateLimits, getClientIp, hashIp, issueLoginCode } from "@/lib/customer/codes";
import { sendCustomerVerificationEmail } from "@/lib/email/sendCustomerVerificationEmail";

// Step 1 of Stay Connected: validate the form, then email a one-time code.
// NOTHING is written to ringo_customers here — the visitor's typed name/
// phone/email are parked on the login-code row and only applied after the
// code is confirmed (so typing someone else's email can't create or edit
// their identity). The response never reveals whether the email already
// belongs to a customer.
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Invalid request." }, { status: 403 });

  const body = await request.json().catch(() => null);

  // Honeypot — identical-looking success, nothing stored or sent.
  if (typeof body?.website === "string" && body.website.trim() !== "") {
    return NextResponse.json({ ok: true });
  }

  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 120) : "";
  const phone = typeof body?.phone === "string" ? body.phone.trim().slice(0, 40) : "";
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase().slice(0, 200) : "";
  const language: "en" | "fr" = body?.language === "en" ? "en" : "fr";
  const marketingConsent = body?.marketing_consent === true;

  if (!name) return NextResponse.json({ error: "invalid_name" }, { status: 400 });
  if (!PHONE_RE.test(phone)) return NextResponse.json({ error: "invalid_phone" }, { status: 400 });
  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: "invalid_email" }, { status: 400 });

  const admin = createAdminClient();

  const profile = await getConnectableProfile(admin, body?.profile_id);
  if (!profile) return NextResponse.json({ error: "Profile not found." }, { status: 404 });

  const ip = getClientIp(request.headers);
  const ipHash = ip ? hashIp(ip) : null;

  const limit = await checkStartRateLimits(admin, email, ipHash);
  if (limit === "cooldown") return NextResponse.json({ error: "cooldown" }, { status: 429 });
  if (limit !== "ok") return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const issued = await issueLoginCode(admin, {
    email,
    ipHash,
    language,
    name,
    phone,
    profileId: profile.id,
    marketingConsent,
    source: "ringo_profile",
  });
  if (!issued.ok) return NextResponse.json({ error: "server_error" }, { status: 500 });

  const sent = await sendCustomerVerificationEmail(email, issued.code, language);
  if (!sent.ok) {
    console.error("customer verification email failed:", sent.error);
    return NextResponse.json({ error: "email_failed" }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
