import { customerRoute } from "@/lib/retention/route";
import { offersForCustomer } from "@/lib/retention/promotions";

export const dynamic = "force-dynamic";

// GET the live offers this signed-in customer may see: only from profiles where their EFFECTIVE marketing consent is on (email or push), only for their segment. The customer comes from the cookie.
export const GET = (request: Request) =>
  customerRoute(request, { write: false }, async (ctx) => {
    const items = await offersForCustomer(ctx.db, { id: ctx.customer.id, emailConfirmed: !!ctx.customer.email_verified_at });
    return { status: 200, body: { ok: true, items } };
  });
