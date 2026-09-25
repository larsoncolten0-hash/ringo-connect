import { createAdminClient } from "@/lib/supabase/server";
import type { KnowledgeModule } from "../types";

// Ringo's own internal Mobile Money checkout for a Business & E-commerce-style catalog product
// (Buy Now), and everything downstream of a sale: the customer's receipt, the seller's earnings
// ledger, and the seller's payout. Distinct from Music's own checkout/payout flow (music.ts,
// payments.ts) — a music profile never uses this path (isMusicProfile() excludes it) — and from
// the general catalog module (catalog.ts), which covers a product's editorial fields, not payment.
//
// Non-secret admin toggles change from /admin/settings and /admin/price-controls, so they are
// NEVER written into `body` — `live` reads platform_settings at lookup time, same convention
// plans.ts already uses for plan limits/prices.
async function renderLiveCommerceSettings(): Promise<string> {
  const { data, error } = await createAdminClient()
    .from("platform_settings")
    .select("commerce_enabled, commerce_commission_rate, commerce_payout_hold_days, commerce_min_payout_xaf")
    .limit(1)
    .single();
  if (error || !data) return "Live commerce settings could not be loaded right now.";

  const enabled = data.commerce_enabled === true;
  const rate = data.commerce_commission_rate != null ? `${Math.round(Number(data.commerce_commission_rate) * 10000) / 100}%` : "not set";
  const hold = data.commerce_payout_hold_days ?? 3;
  const min = data.commerce_min_payout_xaf ?? 5000;
  return `Platform commerce switch: ${enabled ? "ON" : "OFF"}. Ringo's commission rate: ${rate}. Payout hold period: ${hold} day(s). Minimum payout: ${min} XAF.${
    enabled && data.commerce_commission_rate == null ? " NOTE: enabled but no commission rate is set, so checkout still can't activate for any seller." : ""
  }`;
}

export const commerceModule: KnowledgeModule = {
  id: "commerce",
  version: 1,
  title: "Shop checkout, receipts, earnings and payouts",
  summary: "Buy Now/Shop checkout via Mobile Money, customer receipts, seller earnings and seller payouts.",
  appliesTo: {},
  status: "live",
  whoCanUse: "Any non-music profile with a catalog product explicitly set to a Buy Now-type customer action, once Ringo's admin has commerce enabled platform-wide.",
  body: `
Ringo Shop lets a customer pay for a catalog product directly inside Ringo (Mobile Money via Fapshi), instead of the product's "Buy Now" button just linking elsewhere.

For a product's Buy Now button to actually use Ringo's own checkout, ALL of these must be true: the seller's store currency is XAF; the seller has explicitly chosen a purchase-type customer action for that product (not left it on the default wording); and Ringo's admin has commerce turned on platform-wide with a commission rate set (see the live settings below — this is a platform switch, not something a seller controls). Music profiles never use this flow; they have their own music/ticket checkout.

Customer side: paying creates a persistent receipt at /shop/orders/[id] showing items, totals, payment status and the seller, and (if an email was given) a receipt email. A signed-in My Ringo customer also gets an in-app + push notification and sees the purchase in their My Ringo activity.

Seller side: a new paid order sends the seller a bell + push notification ("New order") and appears in Dashboard → Shop, where they mark it fulfilled once handled. Each paid order creates one earnings record (gross, Ringo's commission, and the seller's net) in Dashboard → Shop → Earnings — these records never change afterwards. Once net earnings clear the hold period and reach the minimum payout, the seller can request a payout from that same page; this locks the exact eligible earnings into one payout request and notifies Ringo's admin team. Ringo's admin reviews the request, sends it (Mobile Money via Fapshi, using the payout method/number the seller already has on file for Ringo earnings generally — the same one used for Music/Affiliate payouts) or declines it, and the seller gets a notification once it's actually paid.
`.trim(),
  actions: [
    "Customer: pay for a Shop product with Mobile Money at checkout",
    "Customer: view/download their receipt at /shop/orders/[id]",
    "Seller: view and fulfill Shop orders in Dashboard → Shop",
    "Seller: view earnings and request a payout in Dashboard → Shop → Earnings",
    "Seller: set/update a payout method from Dashboard → Affiliate (shared across Music/Affiliate/Shop)",
  ],
  prerequisites: [
    "Store currency must be XAF",
    "The product's customer action must be explicitly set to a purchase-type wording (e.g. Buy Now), not left on the category default",
    "Ringo's admin must have commerce enabled platform-wide with a commission rate set",
    "A payout method (Mobile Money number, PayPal, or bank) must be on file before requesting a Shop payout",
  ],
  limitations: [
    "Music profiles use a separate purchase flow — this does not apply to them",
    "Only XAF is supported; no other currency can check out through Shop",
    "Payouts are reviewed and sent by a Ringo admin, not instant self-service disbursement",
    "Refunds and cancellations are handled by the Ringo team, not through any self-service button",
  ],
  related: ["catalog", "payments", "notifications_pwa"],
  live: renderLiveCommerceSettings,
};
