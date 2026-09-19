import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getCustomerFromCookie, isSameOrigin } from "@/lib/customer/session";
import { verifyLoginCode } from "@/lib/customer/codes";
import { syncMarketingSubscribers } from "@/lib/customer/connect";

// OPTIONAL: confirms the code sent by /email/send-code. Same atomic database
// check as every other code (row lock, attempt caps, single use), run against the
// SESSION customer's own email — the body only carries the six digits. On success
// the email is marked confirmed and any marketing ticks made while it was
// unconfirmed can take effect.
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Invalid request." }, { status: 403 });

  const session = await getCustomerFromCookie();
  if (!session) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });

  const { customer } = session;
  if (customer.email_verified_at) return NextResponse.json({ ok: true, already: true });

  const body = await request.json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!/^\d{6}$/.test(code)) return NextResponse.json({ error: "invalid_code" }, { status: 400 });

  const admin = createAdminClient();
  const verified = await verifyLoginCode(admin, customer.email, code);
  if (!verified) return NextResponse.json({ error: "invalid_code" }, { status: 400 });

  const { error } = await admin
    .from("ringo_customers")
    .update({ email_verified_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", customer.id);
  if (error) {
    console.error("customer email confirm update failed:", error.message);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }

  await syncMarketingSubscribers(admin, customer);
  return NextResponse.json({ ok: true });
}
