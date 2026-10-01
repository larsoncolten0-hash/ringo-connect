import { createAdminClient } from "@/lib/supabase/server";
import { translations } from "@/lib/i18n/translations";
import type { KnowledgeModule } from "../types";

// Business Toolkit Phase 4: inventory and stock control. It sits BESIDE bookkeeping, invoices and the Shop checkout, never inside them:
// the live balance is the product's own stock count (products.inventory_count), which the Shop checkout already reserves and releases.
//
// `status` is "partial" until the Phase 4 migration is applied and the feature is rolled out (then flip to "live"). `live` tells the model the
// truth for the platform it runs on, so a deploy ahead of the migration can never make Ringo AI promise something the user cannot open.
async function renderLiveAvailability(): Promise<string> {
  try {
    const { error } = await createAdminClient().from("bk_stock_movements").select("id", { head: true, count: "exact" }).limit(1);
    if (error) return "Live availability: Inventory (stock tracking) is NOT enabled on this platform yet. Tell the user it is not available yet; do not describe steps they cannot take.";
    return "Live availability: Inventory is enabled on this platform. A given user can use it only if they own a Business & E-commerce profile whose plan includes the Business Toolkit (an Inventory entry appears in the dashboard menu if so; if not, point them to Subscription to see the plans, and never state a price or plan name from memory).";
  } catch {
    return "Live availability could not be checked right now.";
  }
}

const en = translations.en.inventory.ui;
const fr = translations.fr.inventory.ui;
const both = (a: string, b: string) => `"${a}" / "${b}"`;

export const inventoryModule: KnowledgeModule = {
  id: "inventory",
  version: 1,
  title: "Inventory and stock control (Business Toolkit)",
  summary:
    "How many units of each physical Shop product the seller has: tracking, low-stock level, manual adjustments, damaged/lost, sold elsewhere, count corrections, restocking refunded Shop orders, and a full movement history. Not bookkeeping, not invoices, not accounting valuation.",
  appliesTo: {},
  status: "partial",
  whoCanUse: "The owner of a Business & E-commerce profile whose plan includes the Business Toolkit. Owner only: no staff or accountant access, not on demo profiles. Physical products only.",
  body: `
WHAT IT IS. The ${both(en.title, fr.title)} entry in the dashboard menu (/dashboard/inventory) lets a seller track how many units of each PHYSICAL product they have. It builds on the product's existing stock count: a product with no count is "unlimited" (${both(en.state.untracked, fr.state.untracked)}) and works exactly as before. Nothing is tracked until the seller chooses to start. Ringo never starts tracking by itself.

SELLER-ENTERED, NOT VERIFIED. Every count is the seller's own figure. Ringo does not count, audit or verify stock. NEVER say Ringo verified, confirmed or guarantees a stock level.

STARTING AND STOPPING. ${both(en.startTracking, fr.startTracking)} asks for an opening quantity. A product that already had a count from before (shown as ${both(en.state.legacy, fr.state.legacy)}) is adopted with ${both(en.adoptTracking, fr.adoptTracking)}, which keeps that number. The seller also sets a low-stock level (default 5, changeable per product; an untracked product has none). ${both(en.stopTracking, fr.stopTracking)} (with a confirmation) makes the product unlimited again with no stock limit at checkout; the movement history is kept.

RESERVED IS NOT SOLD. This is the most important distinction. When a customer creates a Shop order, the units are RESERVED (taken off the count) straight away, before payment. If the order expires or is cancelled, the units go back automatically. ${both(en.reserved, fr.reserved)} = held by Shop orders still awaiting payment. ${both(en.sold, fr.sold)} = units on orders that are paid or fulfilled since tracking started. Never call reserved units "sold", and never tell the seller Inventory deducts stock again when an order is paid: it does not. Inventory only reads and displays these figures.

SHOP SALES VS OTHER SALES. Only Shop orders move stock automatically (by the reservation above). Goods sold any other way (cash, a market, an invoice, a credit sale) do NOT change stock by themselves: issuing an invoice, recording a credit sale or recording an invoice payment never touches inventory. The seller records those units manually with the ${both(en.kind.sold_elsewhere, fr.kind.sold_elsewhere)} adjustment (a reason is required). Ringo does not change the invoice or any bookkeeping entry when they do.

ADJUSTMENTS. ${both(en.adjust, fr.adjust)}: stock received, manual increase, manual decrease, damaged, lost, sold elsewhere. ${both(en.correct, fr.correct)} sets the count to what the seller actually counted (a reason is required). Stock can never go below zero, and every change is saved with its reason and the balance before and after in the history (${both(en.historyTitle, fr.historyTitle)}). History cannot be edited or deleted, and it stays even if the product is later deleted.

REFUNDED ORDERS. ${both(en.restockTitle, fr.restockTitle)} is manual and only for Shop orders that are already marked refunded. The seller chooses how many items actually came back (partial is fine, never more than were ordered minus any already restocked) and it can only be done once for those units. Restocking does not change the order or any payment. Refunds themselves are not done in Inventory.

LATE PAYMENTS. If an order's reservation was already released (it expired) and the customer pays later, stock is NOT taken off again automatically. That stays the seller's decision after reviewing the payment; they can adjust the count manually.

PRODUCT EDITOR. In the product editor a tracked product's stock number is read-only and points to Inventory. Untracked products keep the editable number as before.

ESTIMATED VALUE. Optional and informational only: count times the unit cost the seller typed, in their profile currency. It is NOT an accounting valuation (no FIFO, no average cost), is not bookkeeping and never creates an entry. Products without a unit cost are left out.

SEPARATE FROM BOOKKEEPING AND INVOICES. Adjusting stock never creates a bookkeeping entry, an invoice, a receipt or a payment. Do not describe stock value as an asset in the books.

NOT AVAILABLE (say so plainly, no workarounds or dates): digital products, music merchandise, restaurant ingredients or menu stock, ticket or event capacity, other categories; low-stock email, SMS or WhatsApp alerts; automatic stock changes from invoices or credit sales; variants, multiple warehouses or purchase orders; staff or accountant access.

HOW TO ANSWER. Use the exact labels above in the user's language. If Inventory is not in the menu, their category or plan does not include it (or it is not enabled yet): say so and point to Subscription without quoting a price. You cannot see the user's own stock (there is no tool for it): guide them to the screen and never invent a number.
`.trim(),
  actions: [
    "Start tracking a physical product (or adopt its existing count) with a low-stock level",
    "See Out of stock / Low stock / In stock, with Reserved and Sold shown separately",
    "Increase, decrease, record damaged or lost, or record goods sold elsewhere",
    "Correct the count after a physical count",
    "Restock items from a refunded Shop order",
    "Stop tracking so a product is unlimited again",
  ],
  prerequisites: [
    "Owner of a Business & E-commerce profile (not a demo profile) on a plan with the Business Toolkit",
    "A physical product in the catalogue",
  ],
  limitations: [
    "Counts are entered by the seller and never verified by Ringo",
    "Reserved (unpaid Shop orders) is not Sold (paid); Inventory never takes stock off a second time",
    "Invoices and credit sales never change stock; the seller records them manually as sold elsewhere",
    "Physical Business & E-commerce products only; no low-stock messages; value is informational only",
  ],
  related: ["invoices", "receivables", "commerce", "plans"],
  live: renderLiveAvailability,
};
