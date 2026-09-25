// Create a product order. The browser supplies only a product id, a quantity and contact details;
// the profile, price, currency and totals are resolved server-side, and create_product_order() (a
// single database transaction) is authoritative for stock and the order rows. No stock arithmetic
// lives here.

import { RESERVATION_MINUTES } from "./constants";
import { checkCommerceEligibility } from "./eligibility";
import { fail, ok, type Result } from "./errors";
import { withinLimit } from "./rateLimit";
import { formatProductOrderNumber } from "./format";
import type { CheckoutDeps, OrderItemRow, OrderRow } from "./types";
import { parseCreateOrderInput } from "./validation";

/** What the client may see of an order. No phone, email, customer id or internal ids beyond the order's own. */
export interface OrderView {
  id: string;
  order_number: string;
  status: OrderRow["status"];
  currency: string;
  subtotal: number;
  total: number;
  expires_at: string;
  items: { name: string; image: string | null; quantity: number; unit_price: number; line_total: number }[];
}

export function toOrderView(order: OrderRow, items: OrderItemRow[]): OrderView {
  return {
    id: order.id,
    order_number: formatProductOrderNumber(order.order_number),
    status: order.status,
    currency: order.currency,
    subtotal: Number(order.subtotal),
    total: Number(order.total),
    expires_at: order.expires_at,
    items: items.map((i) => ({
      name: i.name_snapshot,
      image: i.image_snapshot,
      quantity: i.quantity,
      unit_price: Number(i.unit_price_snapshot),
      line_total: Number(i.line_total),
    })),
  };
}

export async function createProductOrder(
  deps: CheckoutDeps,
  raw: unknown,
  ctx: { customerId: string | null; clientKey?: string | null }
): Promise<Result<OrderView>> {
  const parsed = parseCreateOrderInput(raw);
  if (!parsed.ok) return fail(parsed.code);
  const input = parsed.value;

  const product = await deps.store.getProduct(input.productId);
  if (!product) return fail("product_unavailable");

  const [settings, profile] = await Promise.all([deps.store.getSettings(), deps.store.getProfile(product.profile_id)]);

  const blocked = checkCommerceEligibility({ settings, profile, product, quantity: input.quantity });
  if (blocked) return fail(blocked);

  // Abuse limit (per client, keyed-hash counted): stops one client reserving stock over and over.
  if (!(await withinLimit(deps, "order_ip", ctx.clientKey))) return fail("rate_limited");

  const created = await deps.store.createOrder({
    profileId: product.profile_id, // resolved from the product, never from the request
    productId: product.id,
    quantity: input.quantity,
    customerId: ctx.customerId, // from the verified customer session (or null for a guest)
    name: input.name,
    phone: input.phone,
    email: input.email,
    note: input.note,
    reservationMinutes: RESERVATION_MINUTES,
  });
  if (!created.ok) return fail(created.code);

  // Remember the customer's language for their receipt. Best effort and after the RPC (which is untouched):
  // if the optional column is not there yet this just logs and the receipt falls back to French.
  if (input.lang && deps.store.setOrderLanguage) {
    try {
      if (!(await deps.store.setOrderLanguage(created.order.id, input.lang))) deps.log("product_order_language_not_saved", { orderId: created.order.id });
    } catch {
      deps.log("product_order_language_not_saved", { orderId: created.order.id });
    }
  }

  return ok(toOrderView(created.order, [created.item]));
}
