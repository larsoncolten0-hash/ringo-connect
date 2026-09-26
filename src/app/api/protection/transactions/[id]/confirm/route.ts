import { NextResponse } from "next/server";
import { getCustomerFromCookie, isSameOrigin } from "@/lib/customer/session";
import { releaseProtectionTransaction } from "@/lib/protection/release";
import { buildProtectionReleaseDeps } from "@/lib/protection/releaseHttp";

// Customer confirms they received a Protection-protected order: awaiting_confirmation -> released,
// followed by exactly one commerce_sale_earnings row (see release.ts). Requires a signed-in Ringo
// customer session (never a client-supplied customer id) and a same-origin request (CSRF), same
// posture as every other customer-session-authenticated route in this codebase. The transaction id
// is the only input; every other value (amount, currency, order, seller) comes from the server's own
// snapshot.
export const dynamic = "force-dynamic";

const STATUS: Record<string, number> = {
  not_authenticated: 401,
  forbidden: 403,
  not_found: 404,
  unauthorized: 403,
  not_eligible: 409,
  earnings_failed: 502,
  conflict: 409,
  internal_error: 500,
};
const fail = (code: string) => NextResponse.json({ error: code }, { status: STATUS[code] ?? 500 });

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    if (!isSameOrigin(request)) return fail("forbidden");
    const session = await getCustomerFromCookie();
    if (!session) return fail("not_authenticated");

    const outcome = await releaseProtectionTransaction(buildProtectionReleaseDeps(), params.id, { type: "customer", customerId: session.customer.id });
    if (!outcome.ok) return fail(outcome.code);
    return NextResponse.json({ status: outcome.status, alreadyReleased: outcome.alreadyReleased });
  } catch (err) {
    console.error("[protection-release] confirm failed:", (err as Error)?.message || err);
    return fail("internal_error");
  }
}
