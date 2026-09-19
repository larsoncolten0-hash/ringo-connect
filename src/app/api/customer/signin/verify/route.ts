import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { createCustomerSession, isSameOrigin, setCustomerSessionCookie } from "@/lib/customer/session";
import { verifyLoginCode } from "@/lib/customer/codes";
import { EMAIL_RE } from "@/lib/customer/connect";

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

  const { data: customer } = await admin.from("ringo_customers").select("id").eq("email", email).maybeSingle();
  if (!customer) return NextResponse.json({ error: "invalid_code" }, { status: 400 });

  await admin.from("ringo_customers").update({ last_login_at: new Date().toISOString() }).eq("id", customer.id);

  const session = await createCustomerSession(admin, customer.id, request.headers.get("user-agent"));

  const response = NextResponse.json({ ok: true });
  setCustomerSessionCookie(response, session.token, session.expiresAt);
  return response;
}
