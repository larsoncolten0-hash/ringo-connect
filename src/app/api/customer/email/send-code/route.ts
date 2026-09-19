import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getCustomerFromCookie, isSameOrigin } from "@/lib/customer/session";
import { checkStartRateLimits, getClientIp, hashIp, issueLoginCode } from "@/lib/customer/codes";
import { sendCustomerVerificationEmail } from "@/lib/email/sendCustomerVerificationEmail";

// OPTIONAL: a signed-in customer asks us to email a code to THEIR OWN address so
// they can confirm it. The address comes from the session, never from the request
// body, so this can't be used to mail codes to arbitrary people. Confirming or not
// changes nothing about how the account works.
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Invalid request." }, { status: 403 });

  const session = await getCustomerFromCookie();
  if (!session) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });

  const { customer } = session;
  if (customer.email_verified_at) return NextResponse.json({ ok: true, already: true });

  const body = await request.json().catch(() => null);
  const language: "en" | "fr" = body?.language === "en" ? "en" : customer.preferred_language === "en" ? "en" : "fr";

  const admin = createAdminClient();
  const ip = getClientIp(request.headers);
  const ipHash = ip ? hashIp(ip) : null;

  const limit = await checkStartRateLimits(admin, customer.email, ipHash);
  if (limit === "cooldown") return NextResponse.json({ error: "cooldown" }, { status: 429 });
  if (limit !== "ok") return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const issued = await issueLoginCode(admin, {
    email: customer.email,
    ipHash,
    language,
    name: null,
    phone: null,
    profileId: null,
    marketingConsent: false,
    source: "confirm",
  });
  if (!issued.ok) return NextResponse.json({ error: "server_error" }, { status: 500 });

  const sent = await sendCustomerVerificationEmail(customer.email, issued.code, language);
  if (!sent.ok) {
    console.error("customer email-confirmation send failed:", sent.error);
    return NextResponse.json({ error: "email_failed" }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
