import { createAdminClient } from "@/lib/supabase/server";
import { translations } from "@/lib/i18n/translations";
import type { KnowledgeModule } from "../types";

// Business Toolkit Phase 3: debtors, credit sales, deposits and payment reminders. It builds ON the invoices module (invoices.ts): a debt is
// the Amount Due of an issued invoice, never a separate record. Vocabulary is deliberate: "Credit Sale", "Amount Due", "Outstanding Balance",
// "Overdue" — and never plain "credit", which in Ringo also names loyalty/package credits (a different feature, owned by the loyalty module).
//
// `status` is "partial" until the Phase 3 migration is applied and the feature is rolled out (then flip to "live"). `live` tells the model the
// truth for the platform it runs on, so a deploy ahead of the migration can never make Ringo AI promise something the user cannot open.
async function renderLiveAvailability(): Promise<string> {
  try {
    const { error } = await createAdminClient().from("bk_reminders").select("id", { head: true, count: "exact" }).limit(1);
    if (error) return "Live availability: the Debtors area (credit sales and payment reminders) is NOT enabled on this platform yet. Tell the user it is not available yet; do not describe steps they cannot take.";
    return "Live availability: the Debtors area is enabled on this platform. A given user can use it only if they own a Business & E-commerce profile whose plan includes the Business Toolkit (the Debtors tab appears inside Dashboard → Invoices if so; if not, point them to Subscription to see the plans, and never state a price or plan name from memory).";
  } catch {
    return "Live availability could not be checked right now.";
  }
}

const en = translations.en.receivables.ui;
const fr = translations.fr.receivables.ui;
const both = (a: string, b: string) => `"${a}" / "${b}"`;

export const receivablesModule: KnowledgeModule = {
  id: "receivables",
  version: 1,
  title: "Debtors, credit sales, deposits and payment reminders (Business Toolkit)",
  summary:
    "Who owes the business money: Amount Due and Outstanding Balance per customer, credit sales, deposits and partial payments, overdue invoices, contacts, manual and automatic email reminders, manual WhatsApp click-to-chat. Not online payment, not loyalty/package credits.",
  appliesTo: {},
  status: "partial",
  whoCanUse: "The owner of a Business & E-commerce profile whose plan includes the Business Toolkit. Owner only: no staff or accountant access, not on demo profiles.",
  body: `
WHAT IT IS. Inside Dashboard → Invoices (the Business Toolkit), the ${both(en.tabDebtors, fr.tabDebtors)} tab (/dashboard/documents/receivables) shows who owes the business money. A DEBT IS SIMPLY THE AMOUNT DUE ON AN ISSUED INVOICE. There is no separate debt record and no separate debt payment: the invoice and the payments recorded on it are the only records. Payments stay "recorded by the business" (the owner types them in after being paid outside Ringo); Ringo never verifies, confirms, receives or holds them. NEVER say Ringo verified a payment on an invoice.

VOCABULARY. Use Credit Sale, Amount Due, Outstanding Balance and Overdue (French: vente à crédit, Montant dû, Solde impayé, En retard). NEVER use the bare word "credit" for a customer's debt, because Ringo also has Package Credits / Loyalty Credits: prepaid sessions or balances a customer holds WITH the business (the loyalty feature). They are the opposite idea and are unrelated to Debtors. If a user mixes them up, explain the difference.

CREDIT SALE. ${both(en.newCreditSale, fr.newCreditSale)} opens the normal invoice editor with two extra requirements: a customer name and a due date. Optionally the owner can pick a customer from their contacts and enter a deposit received now. Issuing works exactly as for any invoice (INV number, then frozen). A deposit is just a payment the owner records on the new invoice right after issuing: it gets its own RCT receipt like any payment. If the deposit step fails the invoice stays issued and unpaid, and the owner records the deposit from the invoice.

AMOUNTS AND OVERDUE. Per invoice the Amount Due is total minus the payments recorded so far; partial payments and several payments are normal. The Outstanding Balance is the sum of Amount Due over issued and partially paid invoices, shown PER CURRENCY and never added across currencies. An invoice is Overdue when its due date has passed (business time, Africa/Douala); this is calculated, never stored, and an invoice with no due date is never overdue. The overview groups lateness (not yet due, 1 to 30, 31 to 60, 61 to 90, over 90 days) and shows balances per customer, plus a group for invoices with no customer assigned. Paid, voided and draft invoices are not debts. If a recorded payment is voided, the Amount Due comes back; if an invoice is voided (only possible while nothing is paid) it stops being a debt; a corrected invoice is its own new debt.

KNOWN EXISTING LIMIT. An invoice cannot take a payment once the business currency is no longer the invoice's currency; the Debtors page still lists it and flags that a payment cannot be recorded on it. Do not suggest a workaround that edits invoices: issued invoices never change.

BOOKKEEPING (CASH BASIS). Issuing an invoice creates NO bookkeeping income. Each payment recorded on an invoice creates exactly one sale entry automatically; the owner must not enter it again. Manual "uncollected sales" typed into Bookkeeping are a separate thing and are NOT part of the Debtors balances: never add the two together or tell the owner they match.

CONTACTS. ${both(en.tabContacts, fr.tabContacts)} is the owner's own private contact book (name, phone, email, notes). Ringo never merges contacts automatically and never uses other Ringo customer lists. If a phone or email already exists the app says so and offers the existing contact. An issued invoice can be linked to a contact (or unlinked) at any time with ${both(en.linkCustomer, fr.linkCustomer)}: this never changes the invoice and only decides whose balance it counts toward; the app suggests matches from the same business's contacts by phone or email but the owner decides. Contacts can be archived (never deleted) and can have automatic reminders paused. A statement shows a contact's invoices, the payments the business recorded (voided ones marked) and the Outstanding Balance.

REMINDERS (${both(en.tabReminders, fr.tabReminders)} for settings). Manual: ${both(en.remind, fr.remind)} on a debtor invoice or on the invoice page. By email, Ringo sends the message on the business's behalf (language of the invoice, reply goes to the business email), at most one email per invoice every 24 hours, at most 10 per invoice, and a daily limit per business. By WhatsApp, Ringo only OPENS the owner's own WhatsApp with the message ready (click-to-chat); the owner sends it. NEVER say or imply Ringo sent, delivered or read a WhatsApp reminder, and there is no automatic WhatsApp or SMS. A manual reminder may include an invoice link only if the owner pastes a link they already created with Share link; Ringo never creates a link for a reminder and cannot show an old link again (only a fingerprint is stored). Reminder history is kept per invoice.

AUTOMATIC EMAIL REMINDERS. OFF by default, per business. To turn on, the business needs an email in Business details (it is the reply address). The owner chooses when: some days before the due date (1 to 14), on the due date, and when overdue every N days (3 to 60, default 7), with a maximum number per invoice (1 to 6, default 3). They only cover invoices whose due date is on or after the day the owner turned them on (never a backlog of old invoices), never for paid or voided invoices, never to an address that bounced or was reported, never for a contact whose automatic reminders are paused, and never more than 30 customer emails a day for the business. Automatic emails NEVER contain an invoice link. Optionally the owner can ask to be alerted (bell and push) on the first day an invoice becomes overdue; also off by default. The scheduling can also be switched off platform-wide, so if a user says nothing is arriving, check these settings first rather than promising it.

NOT AVAILABLE (say so plainly, no workarounds or dates): online payment of an invoice by the customer; automatic WhatsApp or SMS; writing off or forgiving a remaining balance; changing the due date of an issued invoice; instalment plans, interest or late fees; customer overpayments or prepaid balances in this area; staff or accountant access; importing restaurant, music or shop orders as debts (those have their own order flows).

HOW TO ANSWER. Use the exact labels above in the user's language. If the Debtors tab is not visible, their category or plan does not include it (or it is not enabled yet): say so and point to Subscription without quoting a price. You cannot see the user's own debtors or invoices (there is no tool for them): guide them to the screen instead, and never invent a balance.
`.trim(),
  actions: [
    "Start a credit sale (invoice with customer, due date and optional deposit)",
    "See the Outstanding Balance, Overdue amounts and aging per currency and per customer",
    "Keep a private contact book, link invoices to contacts, view a contact statement",
    "Send a manual payment reminder by email, or open WhatsApp with the message ready",
    "Turn automatic email reminders and owner alerts on or off and choose their timing",
  ],
  prerequisites: [
    "Owner of a Business & E-commerce profile (not a demo profile) on a plan with the Business Toolkit",
    "Invoices issued with a due date (and a customer email or phone for reminders)",
    "A business email in Business details before automatic reminders can be turned on",
  ],
  limitations: [
    "A debt is the Amount Due of an invoice: payments are recorded by the business, never verified by Ringo",
    "WhatsApp reminders are click-to-chat only: never sent or delivered by Ringo",
    "Automatic reminders are email only, off by default, never contain a link",
    "No online invoice payment, write-offs, due-date changes, instalment plans or staff access",
  ],
  related: ["invoices", "commerce", "loyalty", "plans"],
  live: renderLiveAvailability,
};
