import { createAdminClient } from "@/lib/supabase/server";
import { notifyCustomer } from "@/lib/customer/inbox";
import { formatProductOrderNumber } from "@/lib/productCheckout/format";
import { translations, type Locale } from "@/lib/i18n/translations";

// Ringo Protection — Phase 5 customer notifications. Reuses the EXACT SAME infrastructure
// notifyShopOrderConfirmed() already uses (notifyCustomer -> customer_notifications + push), with the
// same customer-resolution fallback (order.customer_id, else a verified-email match) — never a
// second notification system. Never throws, and never affects the state transition that triggered it
// (see fulfillment.ts's own try/catch around each call).

async function resolveOrder(admin: any, orderId: string) {
  const { data: order } = await admin
    .from("product_orders")
    .select("id, order_number, customer_id, customer_email, profile_id, profiles(name, username)")
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
  if (!customerId) return null;

  const profile = order.profiles as any;
  return { customerId, locale, sellerName: profile?.name || profile?.username || "", profileId: order.profile_id, orderNumber: formatProductOrderNumber(order.order_number) };
}

/** Fires when a Protection transaction moves protected -> fulfillment_started. */
export async function notifyCustomerProtectionFulfillmentStarted(orderId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const resolved = await resolveOrder(admin, orderId);
    if (!resolved) return;
    const n = translations[resolved.locale].customerPush.protectionFulfillmentStarted;
    await notifyCustomer(
      resolved.customerId,
      { category: "protection_fulfillment_started", title: n.title, body: n.body(resolved.orderNumber, resolved.sellerName), url: `/shop/orders/${orderId}`, data: { kind: "protection_fulfillment_started" } },
      { profileId: resolved.profileId }
    );
  } catch (err) {
    console.error("notifyCustomerProtectionFulfillmentStarted failed:", err);
  }
}

/** Fires when a Protection transaction moves fulfillment_started -> awaiting_confirmation. */
export async function notifyCustomerProtectionAwaitingConfirmation(orderId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const resolved = await resolveOrder(admin, orderId);
    if (!resolved) return;
    const n = translations[resolved.locale].customerPush.protectionAwaitingConfirmation;
    await notifyCustomer(
      resolved.customerId,
      { category: "protection_awaiting_confirmation", title: n.title, body: n.body(resolved.orderNumber, resolved.sellerName), url: `/shop/orders/${orderId}`, data: { kind: "protection_awaiting_confirmation" } },
      { profileId: resolved.profileId }
    );
  } catch (err) {
    console.error("notifyCustomerProtectionAwaitingConfirmation failed:", err);
  }
}
