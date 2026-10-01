import type { KnowledgeModule } from "../types";

// Ringo AI x Business Toolkit, Phase A: what Ringo AI itself can DO with the owner's Business Toolkit records. This is about the AI tools (read-only);
// how each Toolkit screen works lives in the documents, receivables, inventory, reports and customers modules, which this one does not repeat.
export const businessAiModule: KnowledgeModule = {
  id: "business_ai",
  version: 1,
  title: "Ringo AI and the Business Toolkit (read-only business questions)",
  summary:
    "What Ringo AI can answer from the owner's own Business Toolkit records: business summary, sales for a day/week/month/range, trends and comparisons, who owes money, a customer's statement, stock and low stock. Read-only; Business & E-commerce pages on a plan with the Business Toolkit only.",
  appliesTo: {},
  status: "live",
  whoCanUse:
    "The owner of a Business & E-commerce profile (not a demo profile) whose plan includes BOTH Ringo AI and the Business Toolkit. Owner only: no staff or accountant access. If the tools are not in your tool list for this page, the account is not eligible.",
  body: `
WHAT IT IS. For an eligible page, Ringo AI has seven READ-ONLY tools that read the owner's own Business Toolkit records through the same functions the Toolkit screens use. They calculate nothing new: the figures are the ones in Reports, Invoices, Debtors, Customers and Inventory. They never write, send or change anything.

THE TOOLS. get_business_summary: "how is my business doing" (this month so far, money owed, stock, what was left out). get_sales: revenue and cash for today, yesterday, this week (Monday to today), this month so far, the previous month, or a custom date range of at most 93 days in the past or today. get_business_trends: 3, 6 or 12 months, the comparison of the latest month with the previous equivalent period, and optionally the year to date. get_outstanding_invoices: who owes money and the most urgent open invoices. get_customer_statement: one customer's totals, open invoices and latest payments, found by name. get_inventory: tracked stock, or the products matching a name. get_low_stock: products that are out of stock or at or below their own low-stock threshold.

TIME. Every date is an Africa/Douala business day, the same as every Toolkit figure. "Today" is the Douala day, so late evening in Cameroon is still the same day. Do not mix these with the UTC periods of the restaurant, music and ticket sales tools.

TERMS. Revenue is what the business RECORDED earning; an invoice counts as revenue when a payment is recorded on it, not when it is issued. Net cash movement is money recorded as received minus money recorded as paid out. It is not profit, and profit is not reported: never state or estimate a profit. Online Shop sales are counted at their gross amount; the Ringo commission and the seller's net earnings are shown separately, and net earnings are not cash. Money customers owe (receivables) is neither revenue nor cash. Amounts are per currency and are never added across currencies. A voided entry is left out and disclosed; a corrected entry counts as its replacement. Payments received on a customer's invoices are not revenue figures.

SOURCE OF TRUTH. A transaction is never counted twice. Shop orders are already part of the Toolkit's online sales; invoice payments are already part of revenue through their bookkeeping entry; do not add an invoice and its payment, and do not add Shop orders on top of revenue. Restaurant orders, music sales and ticket sales are NOT part of the Toolkit totals: for those, use their own sales tools (get_my_restaurant_sales, get_my_music_sales, get_my_event_sales), and never add their figures to Toolkit figures.

CUSTOMER NAMES. get_customer_statement looks the name up in the owner's own customer book. If several customers match, the tool returns the matches and you must ask the user which one they mean; never guess and never invent a customer. No phone number, e-mail or notes are returned.

CATEGORY AVAILABILITY. Today these tools exist only for Business & E-commerce pages with the Business Toolkit. Other categories do not have them yet; say so plainly and do not promise a date.

NOT AVAILABLE YET (say so plainly): recording a sale or expense, creating an invoice or a customer, recording a payment, changing stock, generating or sending a receipt, and any change at all. When these arrive, Ringo AI will only PREPARE the change and the owner will confirm it with a Confirm and Apply button on a card; a typed "yes" in the chat will not apply anything. Until then, point the user to the Toolkit screens (Reports, Invoices, Customers, Inventory).

HOW TO ANSWER. Use the tools for any question about the owner's own figures, quote the period and the currency, and say what a figure includes or leaves out (for example "left out: 2 voided entries"). A period with no records is a real zero. If a tool returns that it is not available, tell the user their account does not include it and point to Subscription without quoting a price. If a tool says it was too slow, ask for a shorter period. Never invent a figure.
`.trim(),
  actions: [
    "Ask for a summary of the business, sales for a day, week, month or range, a trend or comparison",
    "Ask who owes money and which invoices are overdue",
    "Ask for a customer's statement by name",
    "Ask how much of a product is in stock, or what is running low",
  ],
  prerequisites: [
    "Owner of a Business & E-commerce profile (not a demo profile)",
    "A plan that includes both Ringo AI and the Business Toolkit",
    "Records in the Business Toolkit (entries, invoices, Shop orders, tracked stock)",
  ],
  limitations: [
    "Read-only: nothing can be recorded, changed or sent through Ringo AI yet",
    "Business & E-commerce only for now; owner only",
    "Profit is not reported; net cash movement is not profit",
    "Restaurant, music and ticket sales are separate and never added to Toolkit totals",
    "Custom date ranges are limited to 93 days; trends cover 3, 6 or 12 months",
  ],
  related: ["reports", "receivables", "invoices", "inventory", "customers", "plans", "commerce"],
};
