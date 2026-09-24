import { initiateProductPayment } from "@/lib/productCheckout/initiatePayment";
import { buildCheckoutDeps, internalError, respond } from "@/lib/productCheckout/http";

// Start the Fapshi payment for an order. Body: { phone, medium } only — the amount and currency are
// always read from the order itself. Public like the other guest checkout routes: the order id is
// unguessable, and every check (status, expiry, eligibility, one live attempt, attempt cap) runs
// server-side.
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const body = await request.json().catch(() => null);
    return respond(await initiateProductPayment(buildCheckoutDeps(), params.id, body));
  } catch (err) {
    return internalError(err);
  }
}
