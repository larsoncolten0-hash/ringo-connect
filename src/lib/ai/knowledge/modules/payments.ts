import type { KnowledgeModule } from "../types";

export const paymentsModule: KnowledgeModule = {
  id: "payments",
  version: 1,
  title: "Payments and commerce",
  summary: "How customers pay (Mobile Money), subscription billing, earnings, payouts, affiliate.",
  appliesTo: {},
  body: `
Customer payments: online checkout for music, releases, merch and event tickets uses Mobile Money through Fapshi and requires the store currency to be XAF. Restaurant orders are placed online and collected by the restaurant as it handles them.
Subscriptions: owners pay for their plan from Dashboard → Subscription with Mobile Money (Fapshi) or card (Stripe), depending on what Ringo has enabled.
Earnings and payouts: music sales earnings (after Ringo's commission and a hold period) are requested as a payout from Dashboard → Music → Earnings; affiliate commissions are requested from Dashboard → Affiliate. The Ringo team processes payouts.
Safety: never ask for or accept card numbers, Mobile Money PINs, passwords or verification codes in chat. Billing problems (a payment taken but the plan not upgraded, refunds, payout delays) must go to the Ringo team.
`.trim(),
  related: ["plans", "music", "events"],
};
