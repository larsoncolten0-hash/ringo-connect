import { createAdminClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/email/provider";
import { renderReceiptEmail } from "@/lib/email/renderReceiptEmail";
import { formatPrice } from "@/lib/currency";
import { formatProductOrderNumber } from "@/lib/productCheckout/format";
import { translations, type Locale } from "@/lib/i18n/translations";

// Called from the existing onOrderPaid hook (settleProductPayment -> buildCheckoutDeps), so a
// customer gets exactly one receipt email regardless of how many times that hook is ever
// invoked for the same order. The conditional update below (claiming receipt_email_sent_at) IS
// the send-once guarantee — only the caller that actually flips it from null proceeds to call
// the email provider — same pattern already used by sendMusicOrderReceiptEmail.
//
// Bilingual: uses the verified customer's `preferred_language` when the order is linked to one
// (product_orders.customer_id), otherwise falls back to French — the same convention
// notifyBookingConfirmed() already uses for a guest purchase with no verified identity.
export async function sendShopOrderReceiptEmail(orderId: string): Promise<void> {
  const admin = createAdminClient();

  const { data: order } = await admin
    .from("product_orders")
    .update({ receipt_email_sent_at: new Date().toISOString() })
    .eq("id", orderId)
    .is("receipt_email_sent_at", null)
    .not("customer_email", "is", null)
    .select(
      `order_number, customer_email, customer_id, total, currency,
       product_order_items(name_snapshot, quantity, line_total),
       profiles(name, username, about_email)`
    )
    .maybeSingle();

  // Either already sent, no order found, or no email was ever collected for this order —
  // nothing to do (and nothing was claimed if the row didn't match the filters above).
  if (!order || !order.customer_email) return;

  let locale: Locale = "fr";
  if (order.customer_id) {
    const { data: c } = await admin.from("ringo_customers").select("preferred_language").eq("id", order.customer_id).maybeSingle();
    locale = (c as any)?.preferred_language === "en" ? "en" : "fr";
  }

  const profile = order.profiles as any;
  const sellerName = profile?.name || profile?.username || "";
  const currency = order.currency;
  const orderNumber = formatProductOrderNumber(order.order_number);
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://ringoconnectltd.com").replace(/\/$/, "");
  const ctaUrl = `${siteUrl}/shop/orders/${orderId}`;

  const items = (order.product_order_items || []) as any[];
  const n = translations[locale].shopReceipt.email;

  const html = renderReceiptEmail({
    heading: n.heading,
    subheading: n.subheading(orderNumber, sellerName),
    lines: items.map((i) => ({
      label: `${i.quantity > 1 ? `${i.quantity} × ` : ""}${i.name_snapshot}`,
      amount: formatPrice(i.line_total, currency),
    })),
    total: formatPrice(order.total, currency),
    totalLabel: n.totalLabel,
    ctaUrl,
    ctaLabel: n.ctaLabel,
    footerNote: n.footerNote(sellerName),
  });

  const result = await sendEmail({
    to: order.customer_email,
    subject: n.subject(sellerName),
    html,
    replyTo: profile?.about_email || null,
    log: { emailType: "shop_order_receipt", resourceType: "product_order", resourceId: orderId },
  });

  if (!result.ok) {
    console.error(`shop order receipt email failed for order ${orderId}:`, result.error);
  }
}
