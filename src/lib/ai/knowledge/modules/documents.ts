import { createAdminClient } from "@/lib/supabase/server";
import { translations } from "@/lib/i18n/translations";
import type { KnowledgeModule } from "../types";

// Business Toolkit Phase 2: invoices, seller-recorded payment receipts (RCT-), PDFs and secure share links — plus the
// platform's own Shop receipt PDF (RCP-). Distinct from Ringo's verified Shop checkout (commerce.ts), which is a different
// payment path with different receipts.
//
// `status` is "partial": the code ships with this module, but the feature only works for a user once the Phase 2 database
// migration is applied AND their plan includes the Business Toolkit. Flip it to "live" when the rollout is complete. Until then
// `live` (below) tells the model the truth for the platform it is running on, so a deploy that is ahead of the migration can
// never make Ringo AI promise something the user cannot open.
async function renderLiveAvailability(): Promise<string> {
  try {
    const { error } = await createAdminClient().from("bk_documents").select("id", { head: true, count: "exact" }).limit(1);
    if (error) return "Live availability: the Invoices feature is NOT enabled on this platform yet. Tell the user it is not available yet; do not describe steps they cannot take.";
    return "Live availability: the Invoices feature is enabled on this platform. A given user can use it only if they own a Business & E-commerce profile whose plan includes the Business Toolkit (Dashboard → Invoices appears in their menu if so; if it does not, point them to Subscription to see the plans, and never state a price or plan name from memory).";
  } catch {
    return "Live availability could not be checked right now.";
  }
}

const en = translations.en;
const fr = translations.fr;
const both = (pick: (t: typeof translations.en) => string) => `"${pick(en)}" / "${pick(fr)}"`;

export const documentsModule: KnowledgeModule = {
  id: "invoices",
  version: 1,
  title: "Invoices, payment receipts, PDFs and share links (Business Toolkit)",
  summary:
    "Create, issue, void and correct invoices; record payments received by the business and get RCT receipts; download PDFs; share a secure link; plus the PDF of a Shop receipt (RCP). Not online invoice payment.",
  appliesTo: {},
  status: "partial",
  whoCanUse:
    "The owner of a Business & E-commerce profile whose plan includes the Business Toolkit. Owner only: no staff or accountant access, and not available on demo profiles.",
  body: `
WHAT IT IS. In the Business Toolkit, a Business & E-commerce owner can create professional invoices for their own customers, record the payments the business receives, and give the customer a PDF or a secure link. Find it at Dashboard → ${both((t) => t.nav.documents)} (/dashboard/documents). It is separate from the Shop checkout: nothing here moves money through Ringo.

SET-UP. The "${en.documents.ui.tabBusiness}" / "${fr.documents.ui.tabBusiness}" tab holds the business's details printed on every document (name, legal name, address, phone, email, tax ID, registration number, default payment terms). Tax is OPTIONAL and OFF by default: it only appears if the business sets a tax label and rate, and then it can be switched on per invoice. Ringo documents are NOT tax-certified and Ringo makes no claim that they satisfy any tax or legal requirement; never tell a user an invoice is "compliant", "certified" or "official for the tax authority". Currency is the store currency; amounts are exact (no rounding on what the user types).

DRAFT vs ISSUED. A new invoice starts as a DRAFT: it can be edited or discarded, and it has no number (drafts use up no numbers). When the owner presses ${both((t) => t.documents.ui.issue)} it becomes ISSUED: it gets its number (INV-YYYY-NNNN, sequential per business and per year, never reused), its customer, lines, amounts and wording are frozen, and a tamper-evident fingerprint is stored. An issued invoice can NEVER be edited; to change one, void it and create a corrected invoice (see below).

SELLER-RECORDED PAYMENTS. When a customer pays the business directly (cash, mobile money to the business's own number, bank transfer, card, other), the owner presses ${both((t) => t.documents.ui.recordPayment)} on the issued invoice and enters the amount, date, method and optional reference. This creates a payment receipt numbered RCT-YYYY-NNNN, adds ONE sale entry to the business's bookkeeping ledger automatically (the owner must not also enter it by hand), and moves the invoice to PARTIALLY PAID or PAID. The invoice balance is always total minus the payments recorded so far; a payment cannot exceed the balance. Partial payments are allowed: each one gets its own RCT receipt and the balance after it is printed on that receipt.

IMPORTANT WORDING RULE. A payment recorded on an invoice is "recorded by the business". Ringo did NOT verify it, confirm it, receive it, or hold the money, because the owner typed it in after being paid outside Ringo. NEVER say, imply or agree that Ringo verified, confirmed, guaranteed or protected a seller-recorded invoice payment, or that an RCT receipt proves Ringo saw the money. If asked "has Ringo verified this payment?" for an invoice payment, the answer is no: it is recorded by the business and Ringo has not verified it.

THE TWO KINDS OF RECEIPT AND PAYMENT. (1) Ringo-verified commerce payments: a customer pays for a Shop product at Ringo's own checkout with Mobile Money; Ringo's server confirms it with the payment provider; the customer gets a platform Shop receipt numbered RCP-…, and the seller's earnings and payout flow applies (see the commerce topic). (2) Seller-recorded invoice payments: described above, RCT- receipts, no verification, no earnings/payout flow. Never mix them: an RCP receipt is not an invoice, an RCT receipt is not a Shop receipt, and an invoice payment never creates a Shop order, earning or payout.

PLATFORM SHOP RECEIPT PDF. For an existing Shop order that was paid through Ringo checkout, the customer's receipt page (/shop/orders/[id]) shows a ${both((t) => t.shopReceipt.downloadPdf)} button, and the seller can download the same receipt from the order's page (Dashboard → Shop), button ${both((t) => t.shopOrders.downloadReceiptPdf)}. It is just a PDF of the existing RCP receipt, keeps the RCP number, is available for any paid Shop order (it does not need the Business Toolkit), is not an invoice, and creates no new record. An unpaid order has no PDF.

VOIDING. An invoice can be voided (a reason is required) only while NO payment is recorded on it; its number stays in the history and is never reused. To void an invoice that has payments, first void each payment (reason required): voiding a payment also voids its RCT receipt and its bookkeeping sale entry together and moves the invoice back to the right state. Such an entry must be voided from the invoice, not from the bookkeeping ledger (the ledger refuses it). Nothing is ever deleted.

CORRECTED INVOICES. For a voided (previously issued) invoice, ${both((t) => t.documents.ui.correct)} opens a new draft pre-filled from it; once issued it gets a NEW number and is linked to the voided one. A voided invoice can be corrected only once.

PDF DOWNLOADS. ${both((t) => t.documents.ui.downloadPdf)} on an invoice or receipt gives a PDF in the language chosen for that document (English or French). An issued document always produces the identical PDF, and it is refused if its stored content no longer matches the fingerprint taken at issue. The PDF uses standard fonts, so characters outside the Latin alphabet (emoji, other scripts) cannot be printed and appear as a placeholder on the PDF only; the text stays unchanged in the app.

SECURE SHARE LINKS. On an issued invoice or an RCT receipt, ${both((t) => t.documents.ui.share.button)} creates a private link of the form /d/… that the customer opens WITHOUT a Ringo account to view the document and download its PDF. The link is long, random and unguessable, and does not contain the document number or any identifier. It is shown ONCE, when created (Ringo stores only a one-way fingerprint of it, so it cannot be shown again; if lost, create a new one). The owner chooses how long it stays valid (1 to 90 days, 14 by default), can have up to 5 active links per document, and can revoke any link at any time. An expired, revoked or wrong link all show the same "not available" page and reveal nothing. Ringo does NOT send the link: the owner copies it (or uses their phone's share sheet) and sends it to the customer themselves, for example on WhatsApp. Drafts and voided invoices cannot get new links. Do not promise delivery, read receipts or reminders.

NOT IN THIS VERSION (say so plainly; do not invent workarounds or dates): quotations/estimates; online payment of an invoice (a customer cannot pay an invoice through Ringo: the owner records the payment after being paid elsewhere); automatic WhatsApp, SMS or email sending of invoices; staff or accountant access; recurring invoices; supplier management and purchase orders; inventory; tax filing or tax-compliance features. DEBT/CREDIT BOUNDARY: an unpaid invoice balance is just the invoice's balance; it does not create a debt record, an automatic reminder or a customer credit line. Debt and credit management is a separate, later part of the Business Toolkit; do not say it exists or that invoices feed it today.

HOW TO ANSWER. Use the exact button labels above (English / French) in the user's language. If the user cannot see ${both((t) => t.nav.documents)} in their menu, it is because their profile category or plan does not include it: say so and point to Subscription, without quoting a price from memory. If you cannot see the user's own invoices (there is no tool for them), say you cannot look at their documents and guide them to the screen instead.
`.trim(),
  actions: [
    "Create, edit and discard draft invoices; issue them to get an INV number",
    "Record a payment received by the business and get an RCT receipt",
    "Void a payment or an unpaid invoice (with a reason); create a corrected invoice",
    "Download an invoice or receipt as a PDF (English or French)",
    "Create, copy, share and revoke a secure share link for an issued document",
    "Download the PDF of an existing paid Shop (RCP) receipt (customer and seller)",
  ],
  prerequisites: [
    "Owner of a Business & E-commerce profile (not a demo profile)",
    "A plan that includes the Business Toolkit",
    "The business's details filled in under the Business details tab for professional-looking documents",
  ],
  limitations: [
    "Invoice payments are recorded by the business, never verified by Ringo",
    "No online invoice payment, quotations, automatic WhatsApp/SMS/email sending, staff access or recurring invoices",
    "Not tax-certified; tax is optional and off by default",
    "No debt/credit workflow yet (a later phase)",
  ],
  related: ["commerce", "payments", "plans"],
  live: renderLiveAvailability,
};
