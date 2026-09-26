import { createAdminClient } from "@/lib/supabase/server";
import { notifyCustomer } from "@/lib/customer/inbox";
import { sendPushAndBellToUser } from "@/lib/push/withBell";
import { notifyAdmins } from "@/lib/notifications";
import { formatProductOrderNumber } from "@/lib/productCheckout/format";
import { translations, type Locale } from "@/lib/i18n/translations";

// Ringo Protection — Phase 7 dispute notifications. Reuses the EXACT SAME infrastructure every
// prior Protection phase already uses (notifyCustomer, sendPushAndBellToUser, and — new to this
// phase but pre-existing in the codebase — notifyAdmins for the admin bell). Never throws, and never
// affects the dispute action that triggered it.

async function resolveOrder(admin: any, orderId: string) {
  const { data: order } = await admin
    .from("product_orders")
    .select("id, order_number, customer_id, customer_email, profile_id, customer_name, profiles(name, username, user_id)")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return null;

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
  const profile = order.profiles as any;
  return { customerId, locale, sellerName: profile?.name || profile?.username || "", sellerUserId: profile?.user_id ?? null, profileId: order.profile_id, customerName: order.customer_name, orderNumber: formatProductOrderNumber(order.order_number) };
}

/** Customer: confirmation that their dispute was opened. Seller: notified their order is disputed. Admin: bell entry for review. */
export async function notifyProtectionDisputeOpened(orderId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const resolved = await resolveOrder(admin, orderId);
    if (!resolved) return;

    if (resolved.sellerUserId) {
      await sendPushAndBellToUser(admin, resolved.sellerUserId, {
        category: "protection_disputed",
        title: "Order disputed",
        body: `${resolved.customerName}'s protected order ${resolved.orderNumber} has been disputed.`,
        url: `/dashboard/shop/${orderId}`,
      });
    }

    await notifyAdmins({
      type: "protection_dispute_opened",
      title: "New Ringo Protection dispute",
      body: `Order ${resolved.orderNumber} (${resolved.sellerName}) has an open dispute needing review.`,
      link: `/admin/protection/disputes`,
    });
  } catch (err) {
    console.error("notifyProtectionDisputeOpened failed:", err);
  }
}

/** Customer + seller: the dispute was resolved toward release (the actual release notification —
 *  "funds released" — already fires from release.ts's own onReleased hook; this is the DISPUTE
 *  resolution notice specifically, so a customer/seller who only watches dispute status also learns
 *  the outcome). */
export async function notifyProtectionDisputeResolvedRelease(orderId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const resolved = await resolveOrder(admin, orderId);
    if (!resolved || !resolved.customerId) return;
    const n = translations[resolved.locale].customerPush.protectionDisputeResolvedRelease;
    await notifyCustomer(
      resolved.customerId,
      { category: "protection_dispute_resolved", title: n.title, body: n.body(resolved.orderNumber, resolved.sellerName), url: `/shop/orders/${orderId}`, data: { kind: "protection_dispute_resolved_release" } },
      { profileId: resolved.profileId }
    );
  } catch (err) {
    console.error("notifyProtectionDisputeResolvedRelease failed:", err);
  }
}

/** Customer: the dispute was resolved toward a refund REQUEST — never claims money was returned. */
export async function notifyProtectionDisputeResolvedRefund(orderId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const resolved = await resolveOrder(admin, orderId);
    if (!resolved || !resolved.customerId) return;
    const n = translations[resolved.locale].customerPush.protectionRefundRequested;
    await notifyCustomer(
      resolved.customerId,
      { category: "protection_refund_requested", title: n.title, body: n.body(resolved.orderNumber, resolved.sellerName), url: `/shop/orders/${orderId}`, data: { kind: "protection_refund_requested" } },
      { profileId: resolved.profileId }
    );
  } catch (err) {
    console.error("notifyProtectionDisputeResolvedRefund failed:", err);
  }
}
