import { sendEmail } from "@/lib/email/provider";
import { renderReceiptEmail } from "@/lib/email/renderReceiptEmail";
import { formatPrice } from "@/lib/currency";
import type { OrderStatus } from "@/lib/orderStatus";

// Called once per real status transition, from /api/orders/[id]/status —
// that route's own `.neq("status", status)` update guard is what makes
// this safe without any dedupe logic of its own here: unlike the other
// receipt senders (which can be reached from more than one trigger path,
// e.g. automatic Fapshi confirmation vs. a manual "Mark Paid" click), a
// status change only ever has this one call site to guard against.
//
// Not sent for 'pending' (the existing "order placed" receipt already
// covers that moment — see sendRestaurantOrderReceiptEmail) or 'refunded'
// (no code path sets that status yet).
const STATUS_COPY: Partial<Record<OrderStatus, { heading: string; footerNote: (name: string) => string }>> = {
  accepted: {
    heading: "Order accepted",
    footerNote: (name) => `${name} has accepted your order and will start preparing it soon.`,
  },
  preparing: { heading: "Order in progress", footerNote: (name) => `${name} is preparing your order now.` },
  ready: { heading: "Order ready", footerNote: (name) => `Your order from ${name} is ready.` },
  served: { heading: "Order served", footerNote: (name) => `Enjoy your meal from ${name}!` },
  completed: { heading: "Order completed", footerNote: (name) => `Thanks for ordering from ${name}.` },
  cancelled: { heading: "Order cancelled", footerNote: (name) => `${name} cancelled your order.` },
};

export async function sendRestaurantOrderStatusEmail(client: any, orderId: string, status: OrderStatus): Promise<void> {
  const copy = STATUS_COPY[status];
  if (!copy) return;

  const { data: order } = await client
    .from("orders")
    .select("order_number, customer_email, total, delivery_fee, order_items(*), profiles(name, username, currency)")
    .eq("id", orderId)
    .not("customer_email", "is", null)
    .maybeSingle();

  if (!order || !order.customer_email) return;

  const profile = order.profiles as any;
  const currency = profile?.currency || "USD";
  const restaurantName = profile?.name || profile?.username || "the restaurant";

  const items = (order.order_items || []) as any[];
  const lines = items.map((i) => ({
    label: `${i.quantity} × ${i.item_name_snapshot}`,
    amount: formatPrice(i.line_total, currency),
  }));
  if (order.delivery_fee > 0) {
    lines.push({ label: "Delivery fee", amount: formatPrice(order.delivery_fee, currency) });
  }

  const html = renderReceiptEmail({
    heading: copy.heading,
    subheading: `Order #${order.order_number} · ${restaurantName}`,
    lines,
    total: formatPrice(order.total, currency),
    footerNote: copy.footerNote(restaurantName),
  });

  const result = await sendEmail({
    to: order.customer_email,
    subject: `${copy.heading} — ${restaurantName}`,
    html,
  });

  if (!result.ok) {
    console.error(`restaurant order status email failed for order ${orderId} (${status}):`, result.error);
  }
}
