import { getClientIp } from "@/lib/customer/codes";
import { getCustomerFromCookie, isSameOrigin } from "@/lib/customer/session";
import { createProductOrder } from "@/lib/productCheckout/createOrder";
import { buildCheckoutDeps, internalError, respond } from "@/lib/productCheckout/http";

// Create a product order (guest-friendly). The browser sends ONLY: product_id, quantity,
// customer_name, customer_phone and optional customer_email / note. The profile, price, currency and
// totals are resolved server-side and create_product_order() (one database transaction) reserves the
// stock and writes the order. No price, total, currency or profile id is ever read from the body.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);

    // An optional signed-in Ringo customer is linked to the order. The id comes from the session
    // cookie, never the body, and only for a same-origin request (CSRF). Guests are unaffected and
    // Connect is never required.
    let customerId: string | null = null;
    if (isSameOrigin(request)) {
      const session = await getCustomerFromCookie();
      customerId = session?.customer.id ?? null;
    }

    return respond(await createProductOrder(buildCheckoutDeps(), body, { customerId, clientKey: getClientIp(request.headers) }), 201);
  } catch (err) {
    return internalError(err);
  }
}
