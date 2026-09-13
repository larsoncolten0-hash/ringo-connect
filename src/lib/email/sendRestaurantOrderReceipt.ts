import { sendEmail } from "@/lib/email/provider";
import { renderReceiptEmail } from "@/lib/email/renderReceiptEmail";
import { formatPrice } from "@/lib/currency";

// Called once, right after a restaurant order is placed (see /api/orders)
// — unlike music orders, a restaurant order has no "wait for payment"
// gate to hook: food gets prepared regardless of payment_status (mostly
// pay-in-person), so "order placed" is the right moment for a receipt,
// not "order paid".
//
// The claim (the conditional update below) still guards against ever
// double-sending if this is ever called from more than one place later —
// same send-once pattern as sendMusicOrderReceiptEmail. A failed send is
// not retried — best-effort, consistent with the rest of this app's
// transactional-email posture.
export async function sendRestaurantOrderReceiptEmail(client: any, orderId: string): Promise<void> {
  const { data: order } = await client
    .from("orders")
    .update({ receipt_email_sent_at: new Date().toISOString() })
    .eq("id", orderId)
    .is("receipt_email_sent_at", null)
    .not("customer_email", "is", null)
    .select("order_number, customer_email, customer_name, total, delivery_fee, order_items(*), profiles(name, username, currency)")
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
    heading: "Order received",
    subheading: `Order #${order.order_number} · ${restaurantName}`,
    lines,
    total: formatPrice(order.total, currency),
    footerNote: `Thanks for ordering from ${restaurantName}.`,
  });

  const result = await sendEmail({
    to: order.customer_email,
    subject: `Your order from ${restaurantName}`,
    html,
  });

  if (!result.ok) {
    console.error(`restaurant order receipt email failed for order ${orderId}:`, result.error);
  }
}
