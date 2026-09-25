import { createAdminClient } from "@/lib/supabase/server";
import { sendPushAndBellToUser } from "@/lib/push/withBell";

// Tells a seller, on their Ringo dashboard bell + devices, that their Shop got a new paid order —
// the seller-side equivalent of notifyShopOrderConfirmed()/sendShopOrderReceiptEmail() (customer-
// side, Increment 5B). Reuses the exact same infrastructure the music/booking "New order" alerts
// already use (sendPushAndBellToUser -> notifications + push_subscriptions), never a second
// notification system. Never throws, and never affects the settlement that triggered it.
//
// Called from the existing onOrderPaid hook (settleProductPayment -> buildCheckoutDeps), which
// already only fires once per order (the caller that actually flips it to paid) — so this needs
// no guard column of its own to stay duplicate-safe, same reasoning already documented for the
// customer-side senders in http.ts.
export async function notifySellerNewShopOrder(orderId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: order } = await admin
      .from("product_orders")
      .select("id, profile_id, customer_name, profiles(user_id), product_order_items(name_snapshot, quantity)")
      .eq("id", orderId)
      .maybeSingle();
    if (!order) return;

    const profile = (order as any).profiles;
    const userId: string | null = profile?.user_id ?? null;
    if (!userId) return;

    const items = ((order as any).product_order_items || []) as { name_snapshot: string; quantity: number }[];
    const itemSummary =
      items.length === 1 ? `${items[0].quantity}× ${items[0].name_snapshot}` : `${items.length} item${items.length === 1 ? "" : "s"}`;

    await sendPushAndBellToUser(admin, userId, {
      category: "order_new",
      title: "New order",
      body: `${(order as any).customer_name} ordered ${itemSummary}`,
      url: `/dashboard/shop/${orderId}`,
    });
  } catch (err) {
    console.error("notifySellerNewShopOrder failed:", err);
  }
}
