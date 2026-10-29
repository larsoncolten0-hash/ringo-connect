import { NextResponse } from "next/server";
import { getCustomerFromCookie, isSameOrigin } from "@/lib/customer/session";
import { createAdminClient } from "@/lib/supabase/server";
import { ensureCommunityMember } from "@/lib/customer/connect";
import { getConsent, putConsent, type ConsentCtx } from "@/lib/customer/consentHandlers";

export const dynamic = "force-dynamic";

// The signed-in My Ringo customer's marketing consent, per connected profile and per channel (email, push).
//   GET                                   what the customer has agreed to, for every active connection
//   PUT { profile_id, channel, enabled }  agree (needs an active connection; FAILS CLOSED if the consent ledger cannot record it) or withdraw (always works)
// The customer comes from the My Ringo cookie only. A write must come from this site. Responses are never cached. Nothing here sends a message.
const MAX_BODY_CHARS = 1_000;
const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function ctxOr401(): Promise<ConsentCtx | null> {
  const session = await getCustomerFromCookie();
  if (!session) return null;
  return { customer: session.customer, db: createAdminClient() as unknown as ConsentCtx["db"], ensureMember: ensureCommunityMember as ConsentCtx["ensureMember"] };
}

export async function GET() {
  const ctx = await ctxOr401();
  if (!ctx) return json({ ok: false, error: "not_signed_in" }, 401);
  try {
    const r = await getConsent(ctx);
    return json(r.body, r.status);
  } catch {
    console.error(JSON.stringify({ scope: "customer_consent", result: "handler_error" }));
    return json({ ok: false, error: "server_error" }, 500);
  }
}

export async function PUT(request: Request) {
  if (!isSameOrigin(request)) return json({ ok: false, error: "forbidden" }, 403);
  const ctx = await ctxOr401();
  if (!ctx) return json({ ok: false, error: "not_signed_in" }, 401);
  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_CHARS) return json({ ok: false, error: "invalid_body" }, 413);
    body = raw.trim() === "" ? {} : JSON.parse(raw);
  } catch {
    return json({ ok: false, error: "invalid_body" }, 400);
  }
  try {
    const r = await putConsent(ctx, body);
    return json(r.body, r.status);
  } catch {
    console.error(JSON.stringify({ scope: "customer_consent", result: "handler_error" }));
    return json({ ok: false, error: "server_error" }, 500);
  }
}
