import { NextResponse } from "next/server";
import { getCustomerFromCookie, isSameOrigin } from "@/lib/customer/session";
import { createAdminClient } from "@/lib/supabase/server";
import { openProtectionDispute, parseDisputeInput } from "@/lib/protection/disputeEngine";
import { buildProtectionDisputeDeps } from "@/lib/protection/disputeHttp";
import { createProtectionRateLimiter, withinProtectionLimit } from "@/lib/protection/checkoutRateLimit";

// Customer opens a dispute for their OWN Protection transaction: {protected, fulfillment_started,
// awaiting_confirmation} -> disputed. Requires a signed-in Ringo customer session (never a
// client-supplied customer id) and a same-origin request (CSRF) — same posture as the confirm route.
export const dynamic = "force-dynamic";

const STATUS: Record<string, number> = {
  not_authenticated: 401,
  forbidden: 403,
  invalid_request: 400,
  not_found: 404,
  unauthorized: 403,
  not_eligible: 409,
  conflict: 409,
  rate_limited: 429,
  internal_error: 500,
};
const fail = (code: string) => NextResponse.json({ error: code }, { status: STATUS[code] ?? 500 });

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    if (!isSameOrigin(request)) return fail("forbidden");
    const session = await getCustomerFromCookie();
    if (!session) return fail("not_authenticated");

    const body = await request.json().catch(() => null);
    const parsed = parseDisputeInput(body);
    if (!parsed.ok) return fail(parsed.code);

    const limiter = createProtectionRateLimiter(createAdminClient());
    const allowed = await withinProtectionLimit(limiter, console.warn, "protection_dispute_customer", session.customer.id);
    if (!allowed) return fail("rate_limited");

    const outcome = await openProtectionDispute(buildProtectionDisputeDeps(), params.id, session.customer.id, parsed.value);
    if (!outcome.ok) return fail(outcome.code);
    return NextResponse.json({ status: "disputed", disputeId: outcome.disputeId, alreadyOpen: outcome.alreadyOpen });
  } catch (err) {
    console.error("[protection-dispute] open failed:", (err as Error)?.message || err);
    return fail("internal_error");
  }
}
