import { checkProtectionPayment } from "@/lib/protection/checkPayment";
import { buildProtectionCheckoutDeps, internalError, respond } from "@/lib/protection/checkoutHttp";

// force-dynamic for the same reason as the product-order pay-status route: this reads only a URL
// param, so it would otherwise be statically optimised and replay the first (pending) answer
// forever. Never trusts a status from the client: it asks Fapshi, settles a success exactly once,
// and returns one of pending | succeeded | failed | expired | not_started.
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    return respond(await checkProtectionPayment(buildProtectionCheckoutDeps(), params.id));
  } catch (err) {
    return internalError(err);
  }
}
