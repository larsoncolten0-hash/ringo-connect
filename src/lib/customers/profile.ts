// Business Toolkit Phase 6 (customers): the customer profile, derived from records that ALREADY exist. PURE (no database, no network).
//
// FINANCIAL RULES (unchanged from Phases 1-5): nothing here is a new accounting figure and nothing is re-derived.
//   * The Phase 3 statement (doc_customer_statement via contactStatement) is the source of invoices, payments, Outstanding and Overdue.
//   * "Invoiced" and "Payments received" come from the INVOICES' total and amount_paid. The payment ROWS are used for the history list and the
//     count/last date only; they are never added to amount_paid (that would count every payment twice).
//   * Everything is per currency. Currencies are never added together. Possible Shop orders are NEVER part of any figure here.
//   * The statement returns at most 200 invoices and 500 payments: reaching a limit is reported (truncated) because older records are then
//     missing from every figure.
import { STATEMENT_LIMITS, TIMELINE_CAP } from "./constants";

export type StatementInvoice = {
  id: string; number: string | null; status: string; currency: string; total_minor: number; amount_paid_minor: number; amount_due_minor: number;
  issue_date: string | null; due_date: string | null; overdue: boolean; can_record_payment?: boolean;
};
export type StatementPayment = {
  id: string; invoice_id: string; invoice_number: string | null; receipt_number: string | null; amount_minor: number; currency: string;
  method: string; reference: string | null; paid_on: string; voided: boolean;
};
export type StatementTotal = { currency: string; outstanding_minor: number; overdue_minor: number };

/** Statuses of an invoice that is a real, non-cancelled sale document: drafts and voided invoices are not counted anywhere. */
const LIVE = new Set(["issued", "partially_paid", "paid"]);

export type CustomerTotals = {
  currency: string;
  invoiced_minor: number;
  payments_received_minor: number;
  outstanding_minor: number;
  overdue_minor: number;
  invoice_count: number;
  payment_count: number;
  last_invoice_date: string | null;
  last_payment_date: string | null;
};

export function deriveTotals(inv: StatementInvoice[], pay: StatementPayment[], totals: StatementTotal[]): CustomerTotals[] {
  const cur = new Set<string>([...inv.filter((i) => LIVE.has(i.status)).map((i) => String(i.currency).toUpperCase()), ...totals.map((t) => String(t.currency).toUpperCase())]);
  const out: CustomerTotals[] = [];
  for (const c of Array.from(cur).sort()) {
    const mine = inv.filter((i) => LIVE.has(i.status) && String(i.currency).toUpperCase() === c);
    const t = totals.find((x) => String(x.currency).toUpperCase() === c);
    const live = pay.filter((p) => !p.voided && String(p.currency).toUpperCase() === c);
    out.push({
      currency: c,
      invoiced_minor: mine.reduce((a, i) => a + i.total_minor, 0),
      payments_received_minor: mine.reduce((a, i) => a + i.amount_paid_minor, 0),
      outstanding_minor: t?.outstanding_minor ?? 0,
      overdue_minor: t?.overdue_minor ?? 0,
      invoice_count: mine.length,
      payment_count: live.length,
      last_invoice_date: mine.reduce<string | null>((m, i) => (i.issue_date && (!m || i.issue_date > m) ? i.issue_date : m), null),
      last_payment_date: live.reduce<string | null>((m, p) => (p.paid_on && (!m || p.paid_on > m) ? p.paid_on : m), null),
    });
  }
  return out;
}

export function statementTruncation(inv: unknown[], pay: unknown[]) {
  return { invoices: inv.length >= STATEMENT_LIMITS.invoices, payments: pay.length >= STATEMENT_LIMITS.payments };
}

// ------------------------------------------------------------------------------------------------------------------------------ timeline
export type EventRow = { id: string; event_type: string; document_id: string | null; created_at: string };
export type ReminderRow = { id: string; document_id: string; channel: string; kind: string; status: string; trigger_type: string; created_at: string };

export type TimelineItem =
  | { type: "event"; id: string; at: string; event_type: string; document_number: string | null }
  | { type: "invoice"; id: string; at: string; number: string | null; status: string; currency: string; total_minor: number }
  | { type: "payment"; id: string; at: string; invoice_number: string | null; receipt_number: string | null; amount_minor: number; currency: string; voided: boolean }
  | { type: "reminder"; id: string; at: string; channel: string; kind: string; status: string; trigger_type: string; document_number: string | null };

const RANK: Record<TimelineItem["type"], number> = { event: 0, reminder: 1, payment: 2, invoice: 3 };
/** Dates (YYYY-MM-DD) and timestamps sort on one scale: a date is the start of that day. */
const sortKey = (at: string) => (/^\d{4}-\d{2}-\d{2}$/.test(at) ? `${at}T00:00:00.000Z` : new Date(at).toISOString());

export function buildTimeline(args: { invoices: StatementInvoice[]; payments: StatementPayment[]; events: EventRow[]; reminders: ReminderRow[]; cap?: number }) {
  const numberOf = new Map(args.invoices.map((i) => [i.id, i.number]));
  const items: TimelineItem[] = [];
  for (const i of args.invoices) if (LIVE.has(i.status) && i.issue_date) items.push({ type: "invoice", id: i.id, at: i.issue_date, number: i.number, status: i.status, currency: String(i.currency).toUpperCase(), total_minor: i.total_minor });
  for (const p of args.payments) if (p.paid_on) items.push({ type: "payment", id: p.id, at: p.paid_on, invoice_number: p.invoice_number, receipt_number: p.receipt_number, amount_minor: p.amount_minor, currency: String(p.currency).toUpperCase(), voided: p.voided });
  for (const e of args.events) items.push({ type: "event", id: e.id, at: e.created_at, event_type: e.event_type, document_number: e.document_id ? numberOf.get(e.document_id) ?? null : null });
  for (const r of args.reminders) items.push({ type: "reminder", id: r.id, at: r.created_at, channel: r.channel, kind: r.kind, status: r.status, trigger_type: r.trigger_type, document_number: numberOf.get(r.document_id) ?? null });
  items.sort((a, b) => {
    const ka = sortKey(a.at), kb = sortKey(b.at);
    if (ka !== kb) return ka < kb ? 1 : -1;
    if (RANK[a.type] !== RANK[b.type]) return RANK[a.type] - RANK[b.type];
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
  const cap = args.cap ?? TIMELINE_CAP;
  return { items: items.slice(0, cap), truncated: items.length > cap, total: items.length };
}
