import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { isSameOrigin } from "@/lib/customer/session";
import { EMAIL_RE } from "@/lib/customer/connect";
import { checkStartRateLimits, getClientIp, hashIp, issueLoginCode } from "@/lib/customer/codes";
import { sendCustomerVerificationEmail } from "@/lib/email/sendCustomerVerificationEmail";

// My Ringo sign-in for a customer who already exists (e.g. on a new phone).
// Same code table, hashing, single-live-code index and rate limits as
// Connect's /start — it just has no profile or form data. It NEVER creates a
// customer: a code is emailed only if the address already belongs to one.
//
// To avoid revealing whether an email is a customer, the response and the
// rate-limit behaviour are identical either way: for an unknown email a code
// row is still written (so cooldown/hourly limits trigger the same) but it is
// retired immediately and nothing is sent. A send failure is logged and the
// same generic success is returned.
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Invalid request." }, { status: 403 });

  const body = await request.json().catch(() => null);

  if (typeof body?.website === "string" && body.website.trim() !== "") {
    return NextResponse.json({ ok: true });
  }

  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase().slice(0, 200) : "";
  const language: "en" | "fr" = body?.language === "en" ? "en" : "fr";
  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: "invalid_email" }, { status: 400 });

  const admin = createAdminClient();

  const ip = getClientIp(request.headers);
  const ipHash = ip ? hashIp(ip) : null;

  const limit = await checkStartRateLimits(admin, email, ipHash);
  if (limit === "cooldown") return NextResponse.json({ error: "cooldown" }, { status: 429 });
  if (limit !== "ok") return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const { data: customer } = await admin.from("ringo_customers").select("id").eq("email", email).maybeSingle();

  const issued = await issueLoginCode(admin, {
    email,
    ipHash,
    language,
    name: null,
    phone: null,
    profileId: null,
    marketingConsent: false,
    source: "signin",
  });
  if (!issued.ok) return NextResponse.json({ error: "server_error" }, { status: 500 });

  if (customer) {
    const sent = await sendCustomerVerificationEmail(email, issued.code, language);
    if (!sent.ok) console.error("customer sign-in email failed:", sent.error);
  } else {
    await admin
      .from("customer_login_codes")
      .update({ consumed_at: new Date().toISOString() })
      .eq("email", email)
      .is("consumed_at", null);
  }

  return NextResponse.json({ ok: true });
}
