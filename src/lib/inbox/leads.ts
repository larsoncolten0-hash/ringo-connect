// Lead signals: a read-only, DERIVED label for each conversation. Nothing is stored, tagged or sent because of it: it only helps the owner see
// where each conversation stands. Browser-safe and pure (so the rule is testable and identical wherever it is used).
//
//   closed           the owner closed it
//   needs_follow_up  the customer wrote last and no HUMAN has replied since, for at least the follow-up hours (an automatic acknowledgement
//                    does not count as a reply)
//   customer         the contact is linked to one of the owner's customers (the existing bk_customers link on the contact)
//   new_lead         open, and no human has ever replied
//   active           everything else (a conversation in progress)
// Priority in that order.

export const LEAD_SIGNALS = ["new_lead", "active", "needs_follow_up", "customer", "closed"] as const;
export type LeadSignal = (typeof LEAD_SIGNALS)[number];
export const isLeadSignal = (v: unknown): v is LeadSignal => typeof v === "string" && (LEAD_SIGNALS as readonly string[]).includes(v);

export interface LeadInput {
  status: "open" | "closed";
  /** The contact is linked to an existing Ringo customer (inbox_contacts.bk_customer_id). */
  isCustomer: boolean;
  lastInboundAt: string | null;
  /** When the owner (a person, not the acknowledgement) last wrote in this conversation. */
  lastHumanOutboundAt: string | null;
}

export const DEFAULT_FOLLOW_UP_HOURS = 24;
const t = (iso: string | null) => (iso ? Date.parse(iso) : NaN);

export function leadSignal(input: LeadInput, followUpAfterHours: number = DEFAULT_FOLLOW_UP_HOURS, now: Date = new Date()): LeadSignal {
  if (input.status === "closed") return "closed";
  const inbound = t(input.lastInboundAt);
  const human = t(input.lastHumanOutboundAt);
  const waiting = !Number.isNaN(inbound) && (Number.isNaN(human) || human < inbound);
  if (waiting && now.getTime() - inbound >= followUpAfterHours * 3600 * 1000) return "needs_follow_up";
  if (input.isCustomer) return "customer";
  if (Number.isNaN(human)) return "new_lead";
  return "active";
}

/** Whether a free-form reply is still possible (the customer wrote within 24 hours). When not, writing first needs an approved template. */
export function replyWindowOpen(lastInboundAt: string | null, now: Date = new Date()): boolean {
  const inbound = t(lastInboundAt);
  return !Number.isNaN(inbound) && now.getTime() - inbound < 24 * 3600 * 1000;
}
