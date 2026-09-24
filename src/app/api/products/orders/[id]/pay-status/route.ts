import { checkProductPayment } from "@/lib/productCheckout/checkPayment";
import { buildCheckoutDeps, internalError, respond } from "@/lib/productCheckout/http";

// force-dynamic for the same reason as the music pay-status route: this reads only a URL param, so it
// would otherwise be statically optimised and replay the first (pending) answer forever.
// Never trusts a status from the client: it asks Fapshi, settles a success exactly once, and returns
// one of pending | succeeded | failed | expired | review | not_started.
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    return respond(await checkProductPayment(buildCheckoutDeps(), params.id));
  } catch (err) {
    return internalError(err);
  }
}
