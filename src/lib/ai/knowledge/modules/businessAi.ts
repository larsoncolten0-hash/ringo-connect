import type { KnowledgeModule } from "../types";

// Ringo AI x Business Toolkit, Phase A: what Ringo AI itself can DO with the owner's Business Toolkit records. This is about the AI tools (read-only);
// how each Toolkit screen works lives in the documents, receivables, inventory, reports and customers modules, which this one does not repeat.
export const businessAiModule: KnowledgeModule = {
  id: "business_ai",
  version: 2,
  title: "Ringo AI and the Business Toolkit (business questions and prepared changes)",
  summary:
    "What Ringo AI can answer from the owner's own Business Toolkit records: business summary, sales for a day/week/month/range, trends and comparisons, who owes money, a customer's statement, stock and low stock. It can also PREPARE changes (entries, invoices, payments, customers, stock) for the owner to confirm on a card. Pages whose category has the Business Toolkit, on a plan with the Business Toolkit only.",
  appliesTo: {},
  status: "live",
  whoCanUse:
    "The owner of a profile in a Business Toolkit category (Business & E-commerce, Professional services, Freelancers & creators, Beauty & wellness, Construction & home services, Real estate, Agriculture, Education & training, Travel & hospitality, Creative & media, Transport & logistics, Health & medical; not a demo profile) whose plan includes BOTH Ringo AI and the Business Toolkit. Owner only: no staff or accountant access. If the tools are not in your tool list for this page, the account is not eligible.",
  body: `
WHAT IT IS. For an eligible page, Ringo AI has READ tools that read the owner's own Business Toolkit records through the same functions the Toolkit screens use, and PREPARE tools that only draft a change. The read tools calculate nothing new: the figures are the ones in Reports, Invoices, Debtors, Customers and Inventory. Nothing is ever written, sent or changed until the owner clicks Confirm and Apply on a card.

THE TOOLS. get_business_summary: "how is my business doing" (this month so far, money owed, stock, what was left out). get_sales: revenue and cash for today, yesterday, this week (Monday to today), this month so far, the previous month, or a custom date range of at most 93 days in the past or today. get_business_trends: 3, 6 or 12 months, the comparison of the latest month with the previous equivalent period, and optionally the year to date. get_outstanding_invoices: who owes money and the most urgent open invoices. get_customer_statement: one customer's totals, open invoices and latest payments, found by name. get_inventory: tracked stock, or the products matching a name. get_low_stock: products that are out of stock or at or below their own low-stock threshold.

TIME. Every date is an Africa/Douala business day, the same as every Toolkit figure. "Today" is the Douala day, so late evening in Cameroon is still the same day. Do not mix these with the UTC periods of the restaurant, music and ticket sales tools.

TERMS. Revenue is what the business RECORDED earning; an invoice counts as revenue when a payment is recorded on it, not when it is issued. Net cash movement is money recorded as received minus money recorded as paid out. It is not profit, and profit is not reported: never state or estimate a profit. Online Shop sales are counted at their gross amount; the Ringo commission and the seller's net earnings are shown separately, and net earnings are not cash. Money customers owe (receivables) is neither revenue nor cash. Amounts are per currency and are never added across currencies. A voided entry is left out and disclosed; a corrected entry counts as its replacement. Payments received on a customer's invoices are not revenue figures.

SOURCE OF TRUTH. A transaction is never counted twice. Shop orders are already part of the Toolkit's online sales; invoice payments are already part of revenue through their bookkeeping entry; do not add an invoice and its payment, and do not add Shop orders on top of revenue. Restaurant orders, music sales and ticket sales are NOT part of the Toolkit totals: for those, use their own sales tools (get_my_restaurant_sales, get_my_music_sales, get_my_event_sales), and never add their figures to Toolkit figures.

CUSTOMER NAMES. get_customer_statement looks the name up in the owner's own customer book. If several customers match, the tool returns the matches and you must ask the user which one they mean; never guess and never invent a customer. No phone number, e-mail or notes are returned.

CATEGORY AVAILABILITY. The tools exist for the twelve Toolkit categories listed under who can use it, on a plan with both Ringo AI and the Business Toolkit. Stock tracking (get_inventory, get_low_stock, prepare_stock_adjustment) exists only for Business & E-commerce. Automatic invoice reminders are Business & E-commerce only. Restaurant, music and events pages do NOT have the Toolkit: their own orders, purchases and tickets are the source of truth for their sales. For a restaurant, get_my_restaurant_sales (UTC days) and get_my_restaurant_payments (Douala days; gross order sales, paid and unpaid orders; the payment status is declared by the restaurant, not provider-confirmed) answer sales questions; they are never recorded in the books. Health pages are financial layer only: customer names are shown as initials, and medical information is never read or discussed. The Toolkit is never a CRM, project, fleet, farm, school, property or medical system. Tool results may include category_notes with the vocabulary and rules for the page's category; follow them. Say plainly what a page does not have and do not promise a date.

PREPARING CHANGES. prepare_bookkeeping_entry (a sale, other income, expense, cash in or cash out), prepare_invoice (creates a DRAFT invoice the owner reviews and issues in Invoices; nothing is sent), prepare_invoice_payment (a payment on one open invoice; the receipt is created automatically and revenue is counted once, through the invoice), prepare_customer (a new entry in the owner's customer book), prepare_stock_adjustment (a movement on a tracked product). Pass names and numbers, never ids; if several customers, invoices or products match, ask which one. The owner confirms with a Confirm and Apply button on a card; a typed "yes" in the chat will not apply anything, and you never say a change was recorded, saved or sent before that. Never record a Shop order or an invoice payment as a manual sale. A booking request is not revenue. NOT AVAILABLE: sending or generating a receipt on its own, issuing an invoice, editing or deleting records, and anything outside the Toolkit; point the user to the Toolkit screens.

HOW TO ANSWER. Use the tools for any question about the owner's own figures, quote the period and the currency, and say what a figure includes or leaves out (for example "left out: 2 voided entries"). A period with no records is a real zero. If a tool returns that it is not available, tell the user their account does not include it and point to Subscription without quoting a price. If a tool says it was too slow, ask for a shorter period. Never invent a figure.
`.trim(),
  actions: [
    "Ask for a summary of the business, sales for a day, week, month or range, a trend or comparison",
    "Ask who owes money and which invoices are overdue",
    "Ask for a customer's statement by name",
    "Ask how much of a product is in stock, or what is running low",
    "Ask Ringo AI to prepare an entry, a draft invoice, an invoice payment, a customer or a stock adjustment, then confirm it on the card",
  ],
  prerequisites: [
    "Owner of a profile in a Business Toolkit category (not a demo profile)",
    "A plan that includes both Ringo AI and the Business Toolkit",
    "Records in the Business Toolkit (entries, invoices, Shop orders, tracked stock)",
  ],
  limitations: [
    "Nothing is applied without the owner's Confirm and Apply on the card; no editing, deleting, issuing or sending through Ringo AI",
    "Not for restaurant, music or events pages; stock tracking and automatic reminders for Business & E-commerce only; owner only",
    "Profit is not reported; net cash movement is not profit",
    "Restaurant, music and ticket sales are separate and never added to Toolkit totals",
    "Custom date ranges are limited to 93 days; trends cover 3, 6 or 12 months",
  ],
  related: ["reports", "receivables", "invoices", "inventory", "customers", "plans", "commerce"],
};
