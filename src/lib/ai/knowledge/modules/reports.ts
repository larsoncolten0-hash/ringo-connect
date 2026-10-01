import { createAdminClient } from "@/lib/supabase/server";
import { translations } from "@/lib/i18n/translations";
import type { KnowledgeModule } from "../types";

// Business Toolkit Phase 5: monthly reports (and the bookkeeping entries screen that feeds them). Reports are READ-ONLY and use no table of
// their own: they are built from the bookkeeping entries, invoice payments, online Shop orders, debtors and inventory that already exist.
//
// `status` is "partial" until the feature is rolled out (then flip to "live"). `live` tells the model the truth for the platform it runs on,
// so a deploy ahead of the rollout can never make Ringo AI promise something the user cannot open.
async function renderLiveAvailability(): Promise<string> {
  try {
    const { error } = await createAdminClient().from("bk_entries").select("id", { head: true, count: "exact" }).limit(1);
    if (error) return "Live availability: Reports (monthly report and bookkeeping entries) are NOT enabled on this platform yet. Tell the user it is not available yet; do not describe steps they cannot take.";
    return "Live availability: Reports are enabled on this platform. A given user can use them only if they own a Business & E-commerce profile whose plan includes the Business Toolkit (a Reports entry appears in the dashboard menu if so; if not, point them to Subscription to see the plans, and never state a price or plan name from memory).";
  } catch {
    return "Live availability could not be checked right now.";
  }
}

const en = translations.en.reports;
const fr = translations.fr.reports;
const eb = translations.en.bookkeeping.ui;
const fb = translations.fr.bookkeeping.ui;
const both = (a: string, b: string) => `"${a}" / "${b}"`;

export const reportsModule: KnowledgeModule = {
  id: "reports",
  version: 1,
  title: "Monthly reports and bookkeeping entries (Business Toolkit)",
  summary:
    "A monthly business report built from existing records, shown on screen and downloadable as a PDF: revenue, expenses, net cash movement, online sales with Ringo commission, debtors, inventory, top Shop products. Plus the screen to record manual bookkeeping entries. Not profit, not tax, not an audited statement.",
  appliesTo: {},
  status: "partial",
  whoCanUse: "The owner of a Business & E-commerce profile whose plan includes the Business Toolkit. Owner only: no staff or accountant access, not on demo profiles.",
  body: `
WHAT IT IS. The ${both(en.ui.title, fr.ui.title)} entry in the dashboard menu has two tabs: ${both(en.ui.tabReport, fr.ui.tabReport)} and ${both(en.ui.tabEntries, fr.ui.tabEntries)}. The report is a summary of ONE calendar month, built on the server from records the business already keeps: bookkeeping entries, invoice payments, online Shop orders, debtors and inventory. It never creates a record, an entry or a payment. The month selector opens on the last completed month; the current month can be chosen too and then runs up to today ("month to date"). There is no custom date range and no CSV export.

PDF. ${both(en.ui.download, fr.ui.download)} produces a PDF of the same report, in English or French (chosen separately from the app language). The PDF is created on demand for the signed-in owner only; it is not stored and has no public link. It shows the same figures and the same reference code as the screen.

REVENUE. Revenue is what the business RECORDED earning in the month, including amounts not yet received. Issuing an invoice is NOT revenue: an invoice counts when a payment is recorded on it (the payment creates the bookkeeping sale). The report lists online Shop sales (gross), invoice payments recorded, other sales entered by hand, and other income, and keeps them apart so nothing is counted twice. Counts are given separately (paid online orders, invoice payments, manual sales) because one invoice can have several payments.

ONLINE SALES. Shop orders paid through Ringo checkout are counted automatically at their GROSS amount. The report shows Ringo's platform commission and the seller's net earnings separately; the commission is kept by Ringo and Ringo owes the net until it pays it out, so gross online sales and net earnings are not money already received by the business. If a paid order has no usable recorded earnings (missing, reversed, or not matching the order) it is left out of commission and net, and the report says so with its amount; nothing is estimated. Net earnings count from the day the sale is paid, whether or not Ringo has already paid them out, and the report shows how much has been paid out and how much is still owed by Ringo. The top-selling products list covers online Shop orders only (invoices and manual sales are not recorded per product).

EXPENSES AND CASH. Expenses are only what the business recorded in ${both(en.ui.tabEntries, fr.ui.tabEntries)}. Stock purchases (goods bought for resale) are listed separately from operating expenses. Net cash movement = money recorded as received (invoice payments, manual sales and other income marked received, and cash in) minus money recorded as paid out (expenses marked paid, and cash out); entries marked not yet received or not yet paid are excluded. ONLINE SHOP SALES ARE NOT PART OF IT: customers pay Ringo checkout and Ringo owes the seller the net earnings until it pays them out, so they are earnings owed, not cash received. If the seller records a payout received from Ringo as cash in, it counts on the date entered. NET CASH MOVEMENT IS NOT PROFIT, AND PROFIT IS NOT REPORTED: Ringo does not record the cost of goods sold, so a reliable profit cannot be calculated. Never call any figure in the report a profit.

BOOKKEEPING ENTRIES. The ${both(en.ui.tabEntries, fr.ui.tabEntries)} tab lets the owner record: ${both(eb.kind.sale, fb.kind.sale)}, ${both(eb.kind.other_income, fb.kind.other_income)}, ${both(eb.kind.expense, fb.kind.expense)}, ${both(eb.kind.cash_in, fb.kind.cash_in)} and ${both(eb.kind.cash_out, fb.kind.cash_out)}, with a date that cannot be in the future. Entries cannot be edited or deleted: a mistaken entry is voided with a reason and stays visible, marked voided, and no longer counts. An entry created by an invoice payment is voided only together with that payment, from the invoice. Online Shop sales and invoice payments are never typed in by hand.

DEBTORS AND INVENTORY. The receivables and inventory sections are AS OF THE DAY THE REPORT IS GENERATED, not month-end balances (they do not change with the month chosen). Receivables are invoice amounts still due (outstanding, overdue, and aging). Inventory shows tracked products, their stock status and low-stock products; the estimated stock value is informational only: it is not an accounting valuation, profit or cash.

REFUNDED ORDERS AND CHANGES. A Shop order that is currently marked refunded is left out of sales. Ringo does not record WHEN a refund happened, so the report only says that orders paid in that month are currently marked refunded; never describe it as a refund made in that month. Reports always reflect the records as they stand when generated, so voiding an entry or marking an order refunded later changes that month the next time the report is generated.

CURRENCY AND SCOPE. All figures are in the business's own currency; records in other currencies are not added in (the report says how many were left out). Restaurant, music and ticket sales are not part of this report.

NOT AVAILABLE (say so plainly, no workarounds or dates): profit and loss statements, tax or VAT returns, a custom date range, CSV or Excel export, sharing a report by link, scheduled or emailed reports, staff or accountant access, comparing months, and as-of-month-end balances for debtors or stock.

HOW TO ANSWER. Use the exact labels above in the user's language. If Reports is not in the menu, their category or plan does not include it (or it is not enabled yet): say so and point to Subscription without quoting a price. You cannot see the user's own figures (there is no tool for them): explain definitions and guide them to the screen, and never invent a number.
`.trim(),
  actions: [
    "Open the monthly report for the last completed month or the current month to date",
    "Download the report as a PDF in English or French",
    "Record a manual sale, other income, expense, cash in or cash out",
    "Void a mistaken bookkeeping entry with a reason",
  ],
  prerequisites: [
    "Owner of a Business & E-commerce profile (not a demo profile) on a plan with the Business Toolkit",
    "Records to report: invoice payments, online Shop orders, or bookkeeping entries typed in",
  ],
  limitations: [
    "Profit is not reported; net cash movement is not profit",
    "Revenue counts when a payment is recorded, not when an invoice is issued",
    "Online sales are gross; Ringo commission and net earnings are shown separately",
    "Debtors and inventory are as of the generation date, not month-end",
    "No custom range, CSV, share links or staff access",
  ],
  related: ["invoices", "receivables", "inventory", "commerce", "plans"],
  live: renderLiveAvailability,
};
