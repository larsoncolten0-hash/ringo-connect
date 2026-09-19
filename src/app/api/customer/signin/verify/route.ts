import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { createCustomerSession, isSameOrigin, revokeCustomerSessions, setCustomerSessionCookie } from "@/lib/customer/session";
import { verifyLoginCode } from "@/lib/customer/codes";
import { EMAIL_RE, syncMarketingSubscribers } from "@/lib/customer/connect";

// Confirms a My Ringo sign-in code and starts a customer session. Uses the
// same atomic database check as Connect (row lock, attempt caps, single
// use). Only an EXISTING customer can sign in here — this route never
// creates one. Every failure looks identical to the caller.
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

  const { data: customer } = await admin
    .from("ringo_customers")
    .select("id, name, email, phone, email_verified_at")
    .eq("email", email)
    .maybeSingle();
  if (!customer) return NextResponse.json({ error: "invalid_code" }, { status: 400 });

  const now = new Date().toISOString();
  const wasUnconfirmed = !customer.email_verified_at;
  await admin
    .from("ringo_customers")
    .update({ last_login_at: now, ...(wasUnconfirmed ? { email_verified_at: now } : {}) })
    .eq("id", customer.id);

  // The account was created without confirming the email; the person who just
  // proved they own it is signing in. Any session that already exists belongs to
  // whoever typed the address at creation (who never proved anything), so revoke
  // them all before issuing this one.
  if (wasUnconfirmed) await revokeCustomerSessions(admin, { customerId: customer.id });

  const session = await createCustomerSession(admin, customer.id, request.headers.get("user-agent"));

  // Marketing ticks made against the unconfirmed email can take effect now.
  if (wasUnconfirmed) await syncMarketingSubscribers(admin, customer);

  const response = NextResponse.json({ ok: true });
  setCustomerSessionCookie(response, session.token, session.expiresAt);
  return response;
}
