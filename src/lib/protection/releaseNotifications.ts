import { createAdminClient } from "@/lib/supabase/server";
import { notifyCustomer } from "@/lib/customer/inbox";
import { sendPushAndBellToUser } from "@/lib/push/withBell";
import { formatProductOrderNumber } from "@/lib/productCheckout/format";
import { translations, type Locale } from "@/lib/i18n/translations";

// Ringo Protection — Phase 6 release notifications. Reuses the EXACT SAME infrastructure Phase 4/5
// already use (notifyCustomer / sendPushAndBellToUser) — never a second notification system. Never
// throws, and never affects the release that triggered it (see release.ts's own try/catch).

/** Fires once, only for the caller that actually released the transaction. */
export async function notifyCustomerProtectionReleased(orderId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: order } = await admin
      .from("product_orders")
      .select("id, order_number, customer_id, customer_email, profile_id, profiles(name, username)")
      .eq("id", orderId)
      .maybeSingle();
    if (!order) return;

    let customerId: string | null = order.customer_id ?? null;
    let locale: Locale = "fr";
    if (customerId) {
      const { data: c } = await admin.from("ringo_customers").select("preferred_language").eq("id", customerId).maybeSingle();
      locale = c?.preferred_language === "en" ? "en" : "fr";
    } else if (order.customer_email) {
      const { data: c } = await admin
        .from("ringo_customers")
        .select("id, preferred_language")
        .ilike("email", String(order.customer_email).replace(/[\%_]/g, (m: string) => `\\${m}`))
        .not("email_verified_at", "is", null)
        .maybeSingle();
      if (c) {
        customerId = c.id;
        locale = c.preferred_language === "en" ? "en" : "fr";
      }
    }
    if (!customerId) return;

    const profile = order.profiles as any;
    const n = translations[locale].customerPush.protectionReleased;
    await notifyCustomer(
      customerId,
      { category: "protection_released", title: n.title, body: n.body(formatProductOrderNumber(order.order_number), profile?.name || profile?.username || ""), url: `/shop/orders/${orderId}`, data: { kind: "protection_released" } },
      { profileId: order.profile_id }
    );
  } catch (err) {
    console.error("notifyCustomerProtectionReleased failed:", err);
  }
}

/** Fires once, only for the caller that actually released the transaction. */
export async function notifySellerProtectionReleased(orderId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: order } = await admin.from("product_orders").select("id, customer_name, profiles(user_id)").eq("id", orderId).maybeSingle();
    if (!order) return;
    const userId: string | null = (order.profiles as any)?.user_id ?? null;
    if (!userId) return;

    await sendPushAndBellToUser(admin, userId, {
      category: "protection_released",
      title: "Protection funds released",
      body: `${order.customer_name}'s protected order is released — see your Shop earnings.`,
      url: `/dashboard/shop/${orderId}`,
    });
  } catch (err) {
    console.error("notifySellerProtectionReleased failed:", err);
  }
}
