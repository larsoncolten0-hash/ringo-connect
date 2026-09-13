import { sendEmail } from "@/lib/email/provider";
import { renderReceiptEmail } from "@/lib/email/renderReceiptEmail";
import { formatPrice } from "@/lib/currency";
import { formatOrderNumber, formatReceiptNumber } from "@/lib/receiptNumber";

// Called from every place a music order can become 'paid' — the automatic
// Fapshi confirmation (src/lib/musicOrderPayment.ts) and the artist's
// manual "Mark Paid" action (/api/music/orders/[id]/mark-paid) — so a fan
// gets exactly one receipt email regardless of which path paid the order.
//
// The claim (the conditional update below) IS the send-once guarantee:
// only the caller that actually flips receipt_email_sent_at from null
// proceeds to call the email provider, so two near-simultaneous triggers
// (e.g. two poll ticks both seeing a freshly-successful Fapshi charge)
// can never double-email the same order. A failed send past that point is
// not retried — best-effort, same posture as music_sale_earnings elsewhere
// in this schema.
//
// `client` is typed loosely (any Supabase client) since this runs both
// from server-side automatic confirmation (service-role admin client) and
// from an owner-authenticated request-scoped client (mark-paid route,
// where RLS already limits it to the caller's own orders).
//
// English-only for now, same as renderAnnouncementEmail — no per-fan
// locale is stored anywhere in the guest-checkout flow to render this in.
export async function sendMusicOrderReceiptEmail(client: any, orderId: string): Promise<void> {
  const { data: order } = await client
    .from("music_orders")
    .update({ receipt_email_sent_at: new Date().toISOString() })
    .eq("id", orderId)
    .is("receipt_email_sent_at", null)
    .not("customer_email", "is", null)
    .select("order_number, customer_email, customer_name, total, music_order_items(*), profiles(name, username, currency, about_email)")
    .maybeSingle();

  // Either already sent, no order found, or no email was ever collected
  // for this order — nothing to do (and nothing was claimed if the row
  // didn't match the filters above).
  if (!order || !order.customer_email) return;

  const profile = order.profiles as any;
  const currency = profile?.currency || "USD";
  const artistName = profile?.name || profile?.username || "the artist";
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://ringoconnectltd.com").replace(/\/$/, "");
  const hasTickets = (order.music_order_items || []).some((i: any) => i.item_type === "ticket");
  // The premium fan-facing receipt (see src/components/music/ReceiptPageView.tsx)
  // — it already links out to each purchased ticket's own QR pass and
  // covers Play/Download for a song/release too, so one link still covers
  // every item type in the order without enumerating per-item links here.
  const ctaUrl = profile?.username ? `${siteUrl}/m/${profile.username}/receipt/${orderId}` : null;
  const receiptNumber = formatReceiptNumber(order.order_number);

  const items = (order.music_order_items || []) as any[];
  const html = renderReceiptEmail({
    heading: hasTickets ? "Your ticket is confirmed 🎟️" : "Purchase confirmed",
    subheading: `Order ${formatOrderNumber(order.order_number)} · ${artistName}`,
    lines: items.map((i) => ({
      label: `${i.quantity > 1 ? `${i.quantity} × ` : ""}${i.name_snapshot}`,
      amount: formatPrice(i.line_total, currency),
    })),
    total: formatPrice(order.total, currency),
    ctaUrl,
    ctaLabel: hasTickets ? "View ticket & receipt" : "View your purchase",
    secondaryUrl: ctaUrl ? `${siteUrl}/api/music/orders/${orderId}/receipt-pdf` : null,
    secondaryLabel: `Download receipt (${receiptNumber})`,
    footerNote: `Thanks for supporting ${artistName}.`,
  });

  const result = await sendEmail({
    to: order.customer_email,
    subject: `Your receipt from ${artistName}`,
    html,
    replyTo: profile?.about_email || null,
    log: { emailType: hasTickets ? "music_ticket_receipt" : "music_order_receipt", resourceType: "music_order", resourceId: orderId },
  });

  if (!result.ok) {
    console.error(`music order receipt email failed for order ${orderId}:`, result.error);
  }
}
