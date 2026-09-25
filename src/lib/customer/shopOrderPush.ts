import { createAdminClient } from "@/lib/supabase/server";
import { notifyCustomer } from "@/lib/customer/inbox";
import { formatProductOrderNumber } from "@/lib/productCheckout/format";
import { translations, type Locale } from "@/lib/i18n/translations";

// Tells a Ringo customer, on their My Ringo devices, that their Shop order was confirmed
// (paid). The recipient is resolved server-side only: first the customer the order was placed
// under (product_orders.customer_id, set from the signed-in session at checkout — see
// createOrder.ts), otherwise the customer whose VERIFIED email equals the order's email — the
// same reasoning and fallback notifyBookingConfirmed() already uses. Nothing is taken from the
// browser. Never throws, and never affects the settlement that triggered it.
export async function notifyShopOrderConfirmed(orderId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: order } = await admin
      .from("product_orders")
      .select("id, order_number, customer_id, customer_email, profile_id, profiles(name, username)")
      .eq("id", orderId)
      .maybeSingle();
    if (!order) return;

    let customerId: string | null = (order as any).customer_id ?? null;
    let locale: Locale = "fr";

    if (customerId) {
      const { data: c } = await admin.from("ringo_customers").select("preferred_language").eq("id", customerId).maybeSingle();
      locale = (c as any)?.preferred_language === "en" ? "en" : "fr";
    } else if ((order as any).customer_email) {
      const { data: c } = await admin
        .from("ringo_customers")
        .select("id, preferred_language")
        .ilike("email", String((order as any).customer_email).replace(/[\%_]/g, (m) => `\\${m}`))
        .not("email_verified_at", "is", null)
        .maybeSingle();
      if (c) {
        customerId = (c as any).id;
        locale = (c as any).preferred_language === "en" ? "en" : "fr";
      }
    }
    if (!customerId) return;

    const profile = (order as any).profiles;
    const sellerName = profile?.name || profile?.username || "";
    const n = translations[locale].customerPush.shopOrderConfirmed;
    await notifyCustomer(
      customerId,
      {
        category: "shop_order_confirmed",
        title: n.title,
        body: n.body(formatProductOrderNumber((order as any).order_number), sellerName),
        url: `/shop/orders/${orderId}`,
        data: { kind: "shop_order_confirmed" },
      },
      { profileId: (order as any).profile_id }
    );
  } catch (err) {
    console.error("notifyShopOrderConfirmed failed:", err);
  }
}
