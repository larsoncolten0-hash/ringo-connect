import { getClientIp } from "@/lib/customer/codes";
import { initiateProtectionPayment } from "@/lib/protection/initiatePayment";
import { buildProtectionCheckoutDeps, internalError, respond } from "@/lib/protection/checkoutHttp";

// Start the Fapshi payment for a Ringo Protection transaction. Body: { phone, medium } only — the
// amount (product + Protection fee) is always read from the transaction's own snapshot. Public like
// the other guest checkout routes: the transaction id is unguessable, and every check (status,
// expiry, eligibility, one live attempt, attempt cap) runs server-side.
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const body = await request.json().catch(() => null);
    return respond(await initiateProtectionPayment(buildProtectionCheckoutDeps(), params.id, body, { clientKey: getClientIp(request.headers) }));
  } catch (err) {
    return internalError(err);
  }
}
