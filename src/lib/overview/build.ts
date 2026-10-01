// Business Toolkit Phase 7A (overview): the Business Toolkit Overview. A READ-ONLY composition of figures that already exist; it defines NO financial
// figure of its own and writes nothing.
//
//   * The month-to-date figures (revenue, expenses, direct cash, online sales) AND the as-of-today receivables and inventory come from the ONE report
//     builder, buildMonthlyReport (Phase 5), called for the current month with the optional lighter `sections`. They are copied as built: nothing is
//     added, subtracted or recomputed here, and the concepts stay separate (revenue, direct cash, receivables, online seller earnings, inventory).
//   * There is no profit, no total across concepts, and no conversion of online earnings into cash.
//   * "Latest activity" is three SEPARATE short lists (bookkeeping entries, paid online orders, issued invoices). They are records, not totals, and are
//     never merged or summed. Orders carry no buyer data (no name, phone or e-mail).
import { currencyMinorDigits, parseMinor } from "@/lib/bookkeeping/money";
import { listDocuments } from "@/lib/documents/handlers";
import { buildMonthlyReport, type ReportModel, type ReportOwner } from "@/lib/reports/build";
import { periodFor, todayKeyOf } from "@/lib/reports/period";

export const OVERVIEW_VERSION = 1;
export const RECENT_ENTRIES = 5;
export const RECENT_ORDERS = 5;
export const RECENT_INVOICES = 5;
export const LOW_STOCK_SHOWN = 5;
const ISSUED_STATUSES = ["issued", "partially_paid", "paid"] as const;

export type RecentEntry = { id: string; kind: string; amountMinor: number | null; currency: string; date: string; category: string | null; description: string | null; cashSettled: boolean; invoicePayment: boolean };
export type RecentOrder = { id: string; number: number | string | null; totalMinor: number | null; currency: string; paidAt: string | null; status: string };
export type RecentInvoice = { id: string; number: string | null; status: string; issueDate: string | null; currency: string; totalMinor: number; balanceMinor: number; overdue: boolean };
export type Recent<T> = { available: boolean; items: T[] };

export type OverviewModel = {
  version: number;
  generatedAt: string;
  asOfDate: string;
  currency: string;
  minorDigits: number;
  period: ReportModel["period"];
  revenue: ReportModel["revenue"];
  counts: ReportModel["counts"];
  expenses: { totalMinor: number; operatingMinor: number; stockPurchasesMinor: number; unpaidMinor: number };
  cash: ReportModel["cash"];
  online: ReportModel["online"];
  refundedOrders: ReportModel["refundedOrders"];
  receivables: ReportModel["receivables"];
  inventory: { available: boolean; asOfDate: string; tracked: number; out: number; low: number; ok: number; legacy: number; lowStockItems: ReportModel["inventory"]["lowStockItems"] };
  exclusions: ReportModel["exclusions"];
  recent: { entries: Recent<RecentEntry>; orders: Recent<RecentOrder>; invoices: Recent<RecentInvoice> };
  profit: { status: "not_reported" };
};

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

const minorOf = (v: unknown, currency: string): number | null => (v === null || v === undefined ? null : parseMinor(typeof v === "number" ? String(v) : (v as string), currencyMinorDigits(currency)));
const clip = (v: unknown, n: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);

async function recentEntries(owner: ReportOwner): Promise<Recent<RecentEntry>> {
  return safe<Recent<RecentEntry>>(async () => {
    const { data, error } = await owner.supabase.from("bk_entries").select("id, kind, amount, currency, entry_date, category, description, cash_settled")
      .eq("profile_id", owner.profile.id).is("voided_at", null)
      .order("entry_date", { ascending: false }).order("created_at", { ascending: false }).order("id", { ascending: false }).range(0, RECENT_ENTRIES - 1);
    if (error) return { available: false, items: [] };
    const items = ((data ?? []) as any[]).slice(0, RECENT_ENTRIES).map((e) => {
      const currency = String(e.currency).toUpperCase();
      return { id: e.id, kind: e.kind, amountMinor: minorOf(e.amount, currency), currency, date: e.entry_date, category: e.category ?? null, description: clip(e.description, 80), cashSettled: e.cash_settled === true, invoicePayment: e.kind === "sale" && e.category === "invoice_payment" };
    });
    return { available: true, items };
  }, { available: false, items: [] as RecentEntry[] });
}

/** Paid online orders only, with the fields the Overview shows. NO buyer name, phone, e-mail or address is selected. */
async function recentOrders(owner: ReportOwner): Promise<Recent<RecentOrder>> {
  return safe<Recent<RecentOrder>>(async () => {
    const { data, error } = await owner.supabase.from("product_orders").select("id, order_number, total, currency, paid_at, status")
      .eq("profile_id", owner.profile.id).in("status", ["paid", "fulfilled"]).not("paid_at", "is", null)
      .order("paid_at", { ascending: false }).order("id", { ascending: false }).range(0, RECENT_ORDERS - 1);
    if (error) return { available: false, items: [] };
    const items = ((data ?? []) as any[]).slice(0, RECENT_ORDERS).map((o) => {
      const currency = String(o.currency).toUpperCase();
      return { id: o.id, number: o.order_number ?? null, totalMinor: minorOf(o.total, currency), currency, paidAt: o.paid_at ?? null, status: o.status };
    });
    return { available: true, items };
  }, { available: false, items: [] as RecentOrder[] });
}

/** Issued invoices through the existing invoice list (one call per issued status, newest first, merged by creation time). Drafts and void invoices are never listed. */
async function recentInvoices(owner: ReportOwner): Promise<Recent<RecentInvoice>> {
  return safe<Recent<RecentInvoice>>(async () => {
    const parts = await Promise.all(ISSUED_STATUSES.map((status) => listDocuments(owner as any, { status, limit: String(RECENT_INVOICES), offset: "0" })));
    if (parts.some((p) => p.status !== 200 || "pdf" in p)) return { available: false, items: [] };
    const rows = parts.flatMap((p) => (p as any).body.items as any[]);
    rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || String(b.id).localeCompare(String(a.id)));
    const items = rows.slice(0, RECENT_INVOICES).map((r) => ({
      id: r.id, number: r.number ?? null, status: r.status, issueDate: r.issue_date ?? null, currency: String(r.currency).toUpperCase(),
      totalMinor: r.total_minor, balanceMinor: r.balance_minor, overdue: r.overdue === true,
    }));
    return { available: true, items };
  }, { available: false, items: [] as RecentInvoice[] });
}

export async function buildOverview(owner: ReportOwner, opts: { now?: Date } = {}): Promise<OverviewModel> {
  const now = opts.now ?? new Date();
  const [y, m] = todayKeyOf(now).split("-").map(Number);
  const p = periodFor(y, m, now);
  if (!p.ok) throw new Error(`overview period: ${p.error}`);

  // the same builder as the Monthly report, current month to date; only the sections the Overview does not show are skipped
  const report = await buildMonthlyReport(owner, p.period, { now, sections: { topProducts: false, invoicing: false, business: false } });
  const [entries, orders, invoices] = await Promise.all([recentEntries(owner), recentOrders(owner), recentInvoices(owner)]);

  return {
    version: OVERVIEW_VERSION,
    generatedAt: report.generatedAt,
    asOfDate: report.asOfDate,
    currency: report.currency,
    minorDigits: report.minorDigits,
    period: report.period,
    revenue: report.revenue,
    counts: report.counts,
    expenses: { totalMinor: report.expenses.totalMinor, operatingMinor: report.expenses.operatingMinor, stockPurchasesMinor: report.expenses.stockPurchasesMinor, unpaidMinor: report.expenses.unpaidMinor },
    cash: report.cash,
    online: report.online,
    refundedOrders: report.refundedOrders,
    receivables: report.receivables,
    inventory: {
      available: report.inventory.available, asOfDate: report.inventory.asOfDate, tracked: report.inventory.tracked, out: report.inventory.out, low: report.inventory.low,
      ok: report.inventory.ok, legacy: report.inventory.legacy, lowStockItems: report.inventory.lowStockItems.slice(0, LOW_STOCK_SHOWN),
    },
    exclusions: report.exclusions,
    recent: { entries, orders, invoices },
    profit: { status: "not_reported" },
  };
}
