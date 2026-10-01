// Business Toolkit Phase 7D (customer attention): DERIVED, READ-ONLY lists computed at request time from records that already exist. Nothing is stored,
// no task, reminder, follow-up or notification is created, and no score is invented.
//
//   * A customer here is bk_customers (the business's OWN contact book), keyed by its id. This module never reads ringo_customers, customer_sessions,
//     customer_login_codes, customer_connections, community subscribers, customer_followups or restaurant/music customers, and never uses a name, phone
//     number or e-mail as a key (no phone or e-mail is even selected).
//   * Overdue and outstanding come from the Phase 3 doc_receivables_summary (the debtors figures), unchanged: top 100 customers per currency; the cap is
//     detected exactly (open invoices that belong to customers who are not in the list) and disclosed.
//   * "Recently invoiced and unpaid" and "quiet" read invoices, invoice payments and the invoice-customer links in bounded queries; when a bound is reached
//     the list says so. Amounts are per currency and are never added across currencies.
//   * Archived customers stay visible while they owe money (with an archived marker) and are never listed as quiet.
import { addMinor, currencyMinorDigits, parseMinor } from "@/lib/bookkeeping/money";
import { DEFAULT_TIME_ZONE, localRangeInstants, toLocalDateKey } from "@/lib/bookkeeping/summary";
import type { ApiResult, DocOwner } from "@/lib/documents/handlers";

export const ATTENTION_VERSION = 1;
/** Fixed windows for this phase (code constants, not settings). */
export const RECENT_INVOICE_DAYS = 30;
export const QUIET_DAYS = 90;
export const QUIET_MIN_CUSTOMER_AGE_DAYS = 30;
/** Rows returned per list. */
export const LIST_CAP = 100;
/** Bounded reads. One extra row is requested to know whether the bound was reached. */
export const RECENT_DOC_CAP = 500;
export const QUIET_ACTIVITY_CAP = 2000;
export const QUIET_CUSTOMER_CAP = 1000;
export const RECEIVABLES_CUSTOMER_CAP = 100; // the Phase 3 summary lists the top 100 customers per currency
const ID_CHUNK = 100;
const OPEN_STATUSES = ["issued", "partially_paid"];

export type DebtRow = { customerId: string; name: string; archived: boolean; currency: string; minorDigits: number; outstandingMinor: number; overdueMinor: number; invoiceCount: number; oldestDueDate: string | null; daysOverdue: number | null };
export type RecentRow = { customerId: string; name: string; archived: boolean; currency: string; minorDigits: number; unpaidMinor: number; invoiceCount: number; latestIssueDate: string };
export type QuietRow = { customerId: string; name: string; customerSince: string };
export type AttentionModel = {
  version: number;
  generatedAt: string;
  today: string;
  thresholds: { recentDays: number; quietDays: number; quietMinAgeDays: number; listCap: number; recentDocCap: number; receivablesCustomerCap: number; quietCustomerCap: number };
  receivables: { available: boolean; omitted: { currency: string; omittedInvoices: number }[] };
  overdue: { items: DebtRow[]; total: number };
  outstanding: { items: DebtRow[]; total: number };
  recent: { available: boolean; items: RecentRow[]; total: number; capped: boolean };
  quiet: { available: boolean; items: QuietRow[]; total: number; incomplete: boolean; customersCapped: boolean };
  unassigned: { currency: string; minorDigits: number; outstandingMinor: number; overdueMinor: number; invoiceCount: number }[];
};

const asArray = <T>(v: T | T[] | null | undefined): T[] => (Array.isArray(v) ? v : v ? [v] : []);
const minorOf = (v: unknown, digits: number): number | null => (v === null || v === undefined ? null : parseMinor(typeof v === "number" ? String(v) : (v as string), digits));
const chunks = <T,>(xs: T[], n: number): T[][] => { const out: T[][] = []; for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n)); return out; };

/** A YYYY-MM-DD business date shifted by whole days (calendar arithmetic, no time zone involved). */
export function shiftDateKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

/** Which of these document ids belong to which customer (the invoice-customer link table), within this business only. Unlinked documents are absent. */
async function customersOfDocuments(owner: DocOwner, docIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const part of chunks(Array.from(new Set(docIds)), ID_CHUNK)) {
    const { data, error } = await owner.supabase.from("bk_document_customer_links").select("document_id, customer_id").eq("profile_id", owner.profile.id).in("document_id", part);
    if (error) throw new Error("links unreadable");
    for (const r of (data ?? []) as any[]) if (r.customer_id) out.set(r.document_id, r.customer_id);
  }
  return out;
}

async function namesOf(owner: DocOwner, ids: string[]): Promise<Map<string, { name: string; archived: boolean }>> {
  const out = new Map<string, { name: string; archived: boolean }>();
  for (const part of chunks(Array.from(new Set(ids)), ID_CHUNK)) {
    const { data, error } = await owner.supabase.from("bk_customers").select("id, name, archived_at").eq("profile_id", owner.profile.id).in("id", part);
    if (error) throw new Error("customers unreadable");
    for (const r of (data ?? []) as any[]) out.set(r.id, { name: String(r.name ?? ""), archived: !!r.archived_at });
  }
  return out;
}

export async function buildAttention(owner: DocOwner, opts: { now?: Date } = {}): Promise<AttentionModel> {
  const now = opts.now ?? new Date();
  const profileId = owner.profile.id;

  // ------------------------------------------------------------------ overdue / outstanding / unassigned: the Phase 3 debtors summary, unchanged
  const debts = await safe(async () => {
    const { data, error } = await owner.admin.rpc("doc_receivables_summary", { p_profile_id: profileId, p_actor_user_id: owner.userId });
    if (error || !data) return null;
    return data as any;
  }, null as any);
  const today: string = typeof debts?.today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(debts.today) ? debts.today : toLocalDateKey(now, DEFAULT_TIME_ZONE);

  const debtRows: DebtRow[] = [];
  const unassigned: AttentionModel["unassigned"] = [];
  const omitted: { currency: string; omittedInvoices: number }[] = [];
  for (const c of asArray<any>(debts?.currencies)) {
    const currency = String(c.currency).toUpperCase();
    const digits = currencyMinorDigits(currency);
    const customers = asArray<any>(c.customers);
    for (const r of customers) {
      const outstanding = minorOf(r.outstanding, digits), overdue = minorOf(r.overdue, digits);
      if (!r.customer_id || outstanding === null || overdue === null) continue;
      const oldest = typeof r.oldest_due_date === "string" ? r.oldest_due_date : null;
      debtRows.push({
        customerId: String(r.customer_id), name: String(r.name ?? ""), archived: r.archived === true, currency, minorDigits: digits,
        outstandingMinor: outstanding, overdueMinor: overdue, invoiceCount: Number(r.invoice_count ?? 0),
        // the oldest due date is the minimum over the customer's open invoices, so when anything is overdue it IS the oldest overdue one
        oldestDueDate: overdue > 0 ? oldest : null, daysOverdue: overdue > 0 && oldest ? Math.max(0, daysBetween(oldest, today)) : null,
      });
    }
    const un = c.unassigned ?? {};
    const unCount = Number(un.invoice_count ?? 0);
    if (unCount > 0) unassigned.push({ currency, minorDigits: digits, outstandingMinor: minorOf(un.outstanding, digits) ?? 0, overdueMinor: minorOf(un.overdue, digits) ?? 0, invoiceCount: unCount });
    // exact cap detection: open invoices of this currency that belong to customers who are NOT in the (top 100) list
    const listed = customers.reduce((n, r) => n + Number(r.invoice_count ?? 0), 0);
    const missing = Number(c.invoice_count ?? 0) - unCount - listed;
    if (missing > 0) omitted.push({ currency, omittedInvoices: missing });
  }
  const byCurrency = (a: { currency: string }, b: { currency: string }) => a.currency.localeCompare(b.currency);
  const overdueAll = debtRows.filter((r) => r.overdueMinor > 0).sort((a, b) => byCurrency(a, b) || b.overdueMinor - a.overdueMinor || a.customerId.localeCompare(b.customerId));
  const outstandingAll = debtRows.filter((r) => r.overdueMinor === 0 && r.outstandingMinor > 0).sort((a, b) => byCurrency(a, b) || b.outstandingMinor - a.outstandingMinor || a.customerId.localeCompare(b.customerId));

  // ------------------------------------------------------------------ recently invoiced and still unpaid (issued in the last 30 days)
  const recentSince = shiftDateKey(today, -RECENT_INVOICE_DAYS);
  const recent = await safe<AttentionModel["recent"]>(async () => {
    const { data, error } = await owner.supabase.from("bk_documents").select("id, currency, total, amount_paid, issue_date")
      .eq("profile_id", profileId).eq("doc_type", "invoice").in("status", OPEN_STATUSES).gte("issue_date", recentSince).lte("issue_date", today)
      .order("issue_date", { ascending: false }).order("id", { ascending: false }).range(0, RECENT_DOC_CAP);
    if (error) return { available: false, items: [], total: 0, capped: false };
    const all = (data ?? []) as any[];
    const capped = all.length > RECENT_DOC_CAP;
    const docs = all.slice(0, RECENT_DOC_CAP);
    const links = await customersOfDocuments(owner, docs.map((d) => d.id));
    const groups = new Map<string, { customerId: string; currency: string; digits: number; unpaid: number; count: number; latest: string }>();
    for (const d of docs) {
      const customerId = links.get(d.id);
      if (!customerId) continue; // unlinked invoices are the "unassigned" bucket, never guessed by name
      const currency = String(d.currency).toUpperCase(), digits = currencyMinorDigits(currency);
      const total = minorOf(d.total, digits), paid = minorOf(d.amount_paid, digits);
      if (total === null || paid === null || total <= paid) continue;
      const key = `${customerId}|${currency}`;
      const g = groups.get(key) ?? { customerId, currency, digits, unpaid: 0, count: 0, latest: "" };
      g.unpaid = addMinor(g.unpaid, total - paid);
      g.count++;
      if (String(d.issue_date) > g.latest) g.latest = String(d.issue_date);
      groups.set(key, g);
    }
    const names = await namesOf(owner, Array.from(groups.values()).map((g) => g.customerId));
    const rows: RecentRow[] = Array.from(groups.values()).filter((g) => names.has(g.customerId)).map((g) => ({
      customerId: g.customerId, name: names.get(g.customerId)!.name, archived: names.get(g.customerId)!.archived, currency: g.currency, minorDigits: g.digits,
      unpaidMinor: g.unpaid, invoiceCount: g.count, latestIssueDate: g.latest,
    })).sort((a, b) => byCurrency(a, b) || b.unpaidMinor - a.unpaidMinor || b.latestIssueDate.localeCompare(a.latestIssueDate) || a.customerId.localeCompare(b.customerId));
    return { available: true, items: rows.slice(0, LIST_CAP), total: rows.length, capped };
  }, { available: false, items: [], total: 0, capped: false });

  // ------------------------------------------------------------------ quiet: active customers, older than 30 days, no invoice and no non-voided payment in the last 90 days
  const quietSince = shiftDateKey(today, -QUIET_DAYS);
  const quiet = await safe<AttentionModel["quiet"]>(async () => {
    // "older than 30 days": created before the start of the day 30 days ago
    const cutoff = localRangeInstants(shiftDateKey(today, -QUIET_MIN_CUSTOMER_AGE_DAYS), shiftDateKey(today, -QUIET_MIN_CUSTOMER_AGE_DAYS), DEFAULT_TIME_ZONE).start;
    const cust = await owner.supabase.from("bk_customers").select("id, name, created_at").eq("profile_id", profileId).is("archived_at", null).lt("created_at", cutoff)
      .order("created_at", { ascending: true }).order("id", { ascending: true }).range(0, QUIET_CUSTOMER_CAP);
    if (cust.error) return { available: false, items: [], total: 0, incomplete: false, customersCapped: false };
    const allCustomers = (cust.data ?? []) as any[];
    const customersCapped = allCustomers.length > QUIET_CUSTOMER_CAP;
    const candidates = allCustomers.slice(0, QUIET_CUSTOMER_CAP);

    const inv = await owner.supabase.from("bk_documents").select("id").eq("profile_id", profileId).eq("doc_type", "invoice").in("status", ["issued", "partially_paid", "paid"])
      .gte("issue_date", quietSince).lte("issue_date", today).order("id", { ascending: true }).range(0, QUIET_ACTIVITY_CAP);
    const pay = await owner.supabase.from("bk_document_payments").select("id, invoice_id").eq("profile_id", profileId).is("voided_at", null)
      .gte("paid_on", quietSince).lte("paid_on", today).order("id", { ascending: true }).range(0, QUIET_ACTIVITY_CAP);
    if (inv.error || pay.error) return { available: false, items: [], total: 0, incomplete: false, customersCapped: false };
    const invRows = (inv.data ?? []) as any[], payRows = (pay.data ?? []) as any[];
    // when an activity read hit its bound, some active customers may be missing from the "active" set: the list then says it may be incomplete
    const incomplete = invRows.length > QUIET_ACTIVITY_CAP || payRows.length > QUIET_ACTIVITY_CAP;
    const docIds = [...invRows.slice(0, QUIET_ACTIVITY_CAP).map((d) => d.id), ...payRows.slice(0, QUIET_ACTIVITY_CAP).map((p) => p.invoice_id)];
    const active = new Set((await customersOfDocuments(owner, docIds)).values());
    const rows: QuietRow[] = candidates.filter((c) => !active.has(c.id)).map((c) => ({ customerId: c.id, name: String(c.name ?? ""), customerSince: toLocalDateKey(c.created_at, DEFAULT_TIME_ZONE) }));
    return { available: true, items: rows.slice(0, LIST_CAP), total: rows.length, incomplete, customersCapped };
  }, { available: false, items: [], total: 0, incomplete: false, customersCapped: false });

  return {
    version: ATTENTION_VERSION,
    generatedAt: now.toISOString(),
    today,
    thresholds: { recentDays: RECENT_INVOICE_DAYS, quietDays: QUIET_DAYS, quietMinAgeDays: QUIET_MIN_CUSTOMER_AGE_DAYS, listCap: LIST_CAP, recentDocCap: RECENT_DOC_CAP, receivablesCustomerCap: RECEIVABLES_CUSTOMER_CAP, quietCustomerCap: QUIET_CUSTOMER_CAP },
    receivables: { available: debts !== null, omitted },
    overdue: { items: overdueAll.slice(0, LIST_CAP), total: overdueAll.length },
    outstanding: { items: outstandingAll.slice(0, LIST_CAP), total: outstandingAll.length },
    recent,
    quiet,
    unassigned,
  };
}

export async function customerAttention(owner: DocOwner, opts: { now?: Date } = {}): Promise<ApiResult> {
  try {
    return { status: 200, body: { attention: await buildAttention(owner, opts) } };
  } catch (e: any) {
    console.error("customer attention failed:", String(e?.message || e).slice(0, 200));
    return { status: 500, body: { error: "internal_error" } };
  }
}
