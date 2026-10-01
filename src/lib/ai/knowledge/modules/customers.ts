import { createAdminClient } from "@/lib/supabase/server";
import { translations } from "@/lib/i18n/translations";
import type { KnowledgeModule } from "../types";

// Business Toolkit Phase 6: the Customers directory and customer profile. A customer here is the business's OWN contact (the Phase 3 contact book,
// also under Invoices -> Debtors), NOT a Ringo account. Read-only screens built from records that already exist; no table of their own.
//
// `status` is "partial" until the feature is rolled out (then flip to "live"). `live` tells the model the truth for the platform it runs on, so a deploy
// ahead of the rollout can never make Ringo AI promise something the user cannot open.
async function renderLiveAvailability(): Promise<string> {
  try {
    const { error } = await createAdminClient().from("bk_customers").select("id", { head: true, count: "exact" }).limit(1);
    if (error) return "Live availability: the Customers area is NOT enabled on this platform yet. Tell the user it is not available yet; do not describe steps they cannot take.";
    return "Live availability: the Customers area is enabled on this platform. A given user can use it only if they own a Business & E-commerce profile whose plan includes the Business Toolkit (a Customers entry appears in the dashboard menu if so; if not, point them to Subscription to see the plans, and never state a price or plan name from memory).";
  } catch {
    return "Live availability could not be checked right now.";
  }
}

const en = translations.en.customers;
const fr = translations.fr.customers;
const ca = translations.en.customerAttention.ui;
const fa = translations.fr.customerAttention.ui;
const both = (a: string, b: string) => `"${a}" / "${b}"`;

export const customersModule: KnowledgeModule = {
  id: "customers",
  version: 1,
  title: "Customers directory and customer profile (Business Toolkit)",
  summary:
    "The business's own customer book: search customers, open a customer to see contact details, notes, invoices, payments received, outstanding and overdue amounts, an activity timeline, and possible matching Shop orders. Not Ringo accounts, not messaging, not marketing.",
  appliesTo: {},
  status: "partial",
  whoCanUse: "The owner of a Business & E-commerce profile whose plan includes the Business Toolkit. Owner only: no staff or accountant access, not on demo profiles.",
  body: `
WHAT IT IS. The ${both(en.ui.title, fr.ui.title)} entry in the dashboard menu is the business's OWN customer book: the people and businesses the owner sells to, entered by the owner. It is the same book as the contacts under Invoices, Debtors (the Contacts tab stays there too): one customer book, two ways in. A customer here is NOT a Ringo account and has nothing to do with who signed up or connected on Ringo; Ringo never shows whether a phone number or email has a Ringo account.

DIRECTORY. Search by name, phone or email (at least 2 characters), switch between ${both(en.ui.statusActive, fr.ui.statusActive)}, ${both(en.ui.statusArchived, fr.ui.statusArchived)} and ${both(en.ui.statusAll, fr.ui.statusAll)}, and open a customer. ${both(en.ui.add, fr.ui.add)} adds a customer; a phone number or email already used by an active customer is reported (the existing customer is offered), never merged and never duplicated. Customers can be archived and restored but never deleted.

PROFILE. A customer's profile shows contact details and notes, the invoices linked to them, the payments the business recorded on those invoices, the Outstanding balance and the Overdue amount, and an activity timeline (customer changes, invoices issued, payments recorded or voided, payment reminders). These figures come from the existing invoice and debtor records and are shown per currency, never added across currencies. ${both(en.profile.paymentsReceived, fr.profile.paymentsReceived)} means the payments the business recorded on that customer's invoices. It is NOT revenue and creates no bookkeeping entry. An invoice only joins a customer when the owner links it to that customer.

LIMITS TO TELL THE USER. The invoice statement covers a customer's latest 200 invoices and 500 payments; if a customer has more, the profile says so and older records are not in the figures. The timeline shows the latest 100 activities.

POSSIBLE MATCHING ORDERS. The profile can list Shop orders whose buyer phone or email matches the customer's (${both(en.match.show, fr.match.show)}). These are SUGGESTIONS, "not verified to be the same person": phone numbers are often shared, so an order may belong to someone else. Orders are never attached to a customer, never saved as a link, and never counted in the customer's totals, the reports or any balance; matching never uses names. If the customer has no phone or email there is nothing to match. Phone matching looks at the business's 1,000 most recent orders (the page says when that limit is reached); email matching covers all orders. Ambiguous matches are flagged: a phone or email used by several different buyer names, or also used by another customer (active or archived). A customer with no phone gets no phone search at all, only the email search.

NEEDS ATTENTION. The ${both(ca.tabAttention, fa.tabAttention)} tab, next to ${both(ca.tabDirectory, fa.tabDirectory)}, lists customers who may need a follow-up, worked out from the business's own invoices and payments at the moment the page is opened. Nothing is saved, no reminder is sent and no task is created. The lists are ${both(ca.cardOverdue, fa.cardOverdue)} (an invoice past its due date), ${both(ca.cardOutstanding, fa.cardOutstanding)} (owes money, nothing overdue yet), ${both(ca.cardRecent, fa.cardRecent)} (an invoice issued in the last 30 days that is not fully paid) and ${both(ca.cardQuiet, fa.cardQuiet)} (active customers added more than 30 days ago with no invoice and no payment in the last 90 days). An archived customer who still owes money stays listed with an "${ca.archivedBadge}" marker, and archived customers are never listed as quiet. Amounts are per currency and are never added across currencies. Invoices not linked to a customer are shown as a count and an amount with a link to Debtors, and are never linked automatically. The overdue and not-yet-due lists cover the 100 customers who owe the most per currency, and the page says when more exist. The 30 and 90 day windows are fixed.

NOT AVAILABLE (say so plainly, no workarounds or dates): linking or merging with Ringo accounts or Connect/Stay Connected customers, loyalty information, community subscribers or marketing consent, sending messages to customers from here, exporting customers, customer segments, confirming an order as a customer's, history from restaurant, music, booking or ticket systems, deleting customers or erasing personal data from here, staff or accountant access.

HOW TO ANSWER. Use the exact labels above in the user's language. If Customers is not in the menu, their category or plan does not include it (or it is not enabled yet): say so and point to Subscription without quoting a price. You cannot see the user's own customers or orders (get_customer_statement exists when the Business tools of the business_ai topic are in your tool list for this page; otherwise there is no tool for them): explain how it works and guide them to the screen, and never invent a customer or a figure.
`.trim(),
  actions: [
    "Open Needs attention: overdue, not yet due, recently invoiced and unpaid, and quiet customers",
    "Search the customer directory and open a customer's profile",
    "Add a customer, edit their details, archive or restore them",
    "See a customer's invoices, payments received, outstanding and overdue amounts",
    "Read a customer's activity timeline",
    "Look at possible matching Shop orders (suggestions only)",
  ],
  prerequisites: [
    "Owner of a Business & E-commerce profile (not a demo profile) on a plan with the Business Toolkit",
    "Customers added by the owner, or invoices linked to contacts",
  ],
  limitations: [
    "A customer is the business's own contact, never a Ringo account",
    "Payments received are not revenue; amounts are per currency",
    "Possible matching orders are unverified suggestions, never linked and never counted",
    "The statement covers the latest 200 invoices and 500 payments",
    "Needs attention is derived when the page opens: nothing is saved, no reminder is sent, no task is created",
    "No messaging, export, marketing consent or loyalty data",
  ],
  related: ["invoices", "receivables", "commerce", "plans"],
  live: renderLiveAvailability,
};
