// Business Toolkit Phase 5 (reports): the ONE report builder. The dashboard and the PDF both call buildMonthlyReport(), so they can never
// disagree about a figure. It only READS: no ledger, no snapshot table, nothing is written, and no financial figure ever comes from the browser.
//
// Source of truth (nothing is copied or re-derived into a second ledger):
//   * bk_entries (Phase 1) read through the existing pure summarize(): revenue, expenses, cash, uncollected, voided/currency/double-count
//     exclusions. An invoice PAYMENT is a sale entry (category invoice_payment); ISSUING an invoice is never revenue.
//   * product_orders (paid/fulfilled, verified by the checkout) = online sales at GROSS, plus commerce_sale_earnings for the platform
//     commission and the seller's net. They are separate sources from bk_entries (a manual sale cannot point at a product order).
//   * doc_receivables_summary (Phase 3) and inv_overview (Phase 4): AS OF THE GENERATION DATE, never a historical month-end balance.
// Profit is NOT reported (cost of goods is not recorded); cash movement is never called profit.
// CASH is only money the business RECORDED as actually received or paid (bk_entries with cash_settled, plus cash_in / cash_out). Online earnings are NOT cash:
// the customer pays Ringo checkout, Ringo keeps its commission and OWES the seller the net (commerce_sale_earnings: recorded / requested = owed, paid = paid out
// by a payout, at a later date). They are reported as earnings, with how much has been paid out, and never enter net cash movement.
import { createHash } from "crypto";
import { addMinor, currencyMinorDigits, parseMinor } from "@/lib/bookkeeping/money";
import { fetchAllRows } from "@/lib/bookkeeping/loader";
import { autoSaleFromProductOrder, localRangeInstants, summarize, toLocalDateKey, DEFAULT_TIME_ZONE, type BkEntry } from "@/lib/bookkeeping/summary";
import { inventoryOverview } from "@/lib/inventory/handlers";
import { todayKeyOf, type ReportPeriod } from "./period";

export const REPORT_VERSION = 1;
export const INVOICE_PAYMENT_CATEGORY = "invoice_payment";
const TOP_PRODUCTS = 5;
const LOW_STOCK_LIST = 10;
const ID_CHUNK = 100;

export type ReportOwner = { userId: string; profile: { id: string; currency: string | null }; supabase: any; admin: any };

export type AgingBucket = { minor: number; count: number };
export type ReportModel = {
  version: number;
  generatedAt: string;
  asOfDate: string;
  fingerprint: string;
  business: { name: string; legalName: string | null; address: string | null; phone: string | null; email: string | null; taxId: string | null; registrationNo: string | null };
  period: ReportPeriod;
  currency: string;
  minorDigits: number;
  revenue: { onlineGrossMinor: number; invoicePaymentsMinor: number; manualSalesMinor: number; otherIncomeMinor: number; totalMinor: number };
  counts: { paidOnlineOrders: number; invoicePayments: number; manualSales: number };
  online: { grossMinor: number; commissionMinor: number; netMinor: number; netPaidOutMinor: number; netNotYetPaidOutMinor: number; ordersWithEarnings: number; ordersWithoutEarnings: number; grossWithoutEarningsMinor: number };
  expenses: { operatingMinor: number; stockPurchasesMinor: number; totalMinor: number; unpaidMinor: number; byCategory: { category: string; minor: number }[] };
  cash: { receivedDirectMinor: number; paidOutMinor: number; netMovementMinor: number };
  uncollected: { salesMinor: number; otherIncomeMinor: number };
  invoicing: { available: boolean; issuedCount: number; issuedTotalMinor: number; otherCurrencyCount: number };
  receivables: {
    available: boolean;
    asOfDate: string;
    currencies: { currency: string; minorDigits: number; outstandingMinor: number; overdueMinor: number; invoiceCount: number; overdueCount: number; aging: Record<string, AgingBucket> }[];
  };
  inventory: {
    available: boolean;
    asOfDate: string;
    tracked: number; out: number; low: number; ok: number; legacy: number; untracked: number;
    estimatedValueMinor: number; valueExcluded: number;
    lowStockItems: { name: string; count: number | null; threshold: number | null; state: string }[];
  };
  topProducts: { name: string; units: number; grossMinor: number }[];
  refundedOrders: { count: number; grossMinor: number };
  exclusions: { voidedEntries: number; otherCurrency: number; doubleCountPrevented: number; unreadable: number };
  profit: { status: "not_reported" };
};

const asArray = <T>(v: T | T[] | null | undefined): T[] => (Array.isArray(v) ? v : v ? [v] : []);
const isNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** Exact decimal (string or number from the database) -> minor units of `digits`; null when unreadable. */
const minorOf = (v: unknown, digits: number): number | null => (v === null || v === undefined ? null : parseMinor(typeof v === "number" ? String(v) : v, digits));

export function fingerprintOf(figures: unknown): string {
  return createHash("sha256").update(JSON.stringify(figures)).digest("hex").slice(0, 12).toUpperCase();
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

async function loadBusiness(owner: ReportOwner) {
  const bp = await safe(async () => {
    const { data } = await owner.supabase.from("bk_business_profiles").select("display_name, legal_name, address, phone, email, tax_id, registration_no").eq("profile_id", owner.profile.id).maybeSingle();
    return data ?? null;
  }, null as any);
  let name: string = bp?.display_name ?? "";
  if (!name) {
    const prof = await safe(async () => (await owner.supabase.from("profiles").select("name, username").eq("id", owner.profile.id).maybeSingle()).data ?? null, null as any);
    name = prof?.name || prof?.username || "";
  }
  const s = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
  return { name, legalName: s(bp?.legal_name), address: s(bp?.address), phone: s(bp?.phone), email: s(bp?.email), taxId: s(bp?.tax_id), registrationNo: s(bp?.registration_no) };
}

/** Optional lighter build for callers that do not show every section (the Overview). Every flag defaults to TRUE: calling buildMonthlyReport without
 * `sections` builds the full report exactly as before. Turning a flag off only SKIPS the extra queries for that section; no figure that is built is ever
 * computed differently. A skipped section is reported as unavailable/empty, never as a zero that looks real. */
export type ReportSections = { topProducts?: boolean; invoicing?: boolean; business?: boolean };

export async function buildMonthlyReport(owner: ReportOwner, period: ReportPeriod, opts: { now?: Date; sections?: ReportSections } = {}): Promise<ReportModel> {
  const now = opts.now ?? new Date();
  const want = { topProducts: opts.sections?.topProducts !== false, invoicing: opts.sections?.invoicing !== false, business: opts.sections?.business !== false };
  const tz = period.timeZone || DEFAULT_TIME_ZONE;
  const currency = (owner.profile.currency || "XAF").toUpperCase();
  const digits = currencyMinorDigits(currency);
  const profileId = owner.profile.id;
  const { start, endExclusive } = localRangeInstants(period.from, period.to, tz);

  // ------------------------------------------------------------------ the same rows feed summarize() and every derived split
  const entries: (BkEntry & { description?: string | null })[] = await fetchAllRows(() =>
    owner.supabase.from("bk_entries").select("id, kind, amount, currency, entry_date, category, cash_settled, linked_order_type, linked_order_id, voided_at")
      .eq("profile_id", profileId).gte("entry_date", period.from).lte("entry_date", period.to).order("entry_date").order("id")
  );
  const orders: any[] = await fetchAllRows(() =>
    owner.supabase.from("product_orders").select("id, status, total, currency, paid_at, commerce_sale_earnings(gross_amount, platform_fee, net_amount, currency, status)")
      .eq("profile_id", profileId).in("status", ["paid", "fulfilled", "refunded"]).gte("paid_at", start).lt("paid_at", endExclusive).order("paid_at").order("id")
  );

  const autoSales = orders.map(autoSaleFromProductOrder).filter((s): s is NonNullable<typeof s> => s !== null);
  const summary = summarize({ entries, autoSales, from: period.from, to: period.to, currency, timeZone: tz, cost: { kind: "unknown" } });

  // ------------------------------------------------------------------ direct payments, split from the SAME entries summarize() used
  let invoicePayments = 0, invoicePaymentCount = 0, manualSaleCount = 0;
  for (const e of entries) {
    if (e.voided_at || e.entry_date < period.from || e.entry_date > period.to || String(e.currency).toUpperCase() !== currency) continue;
    const m = minorOf(e.amount, digits);
    if (m === null || m <= 0) continue;
    if (e.kind === "sale") {
      if (e.category === INVOICE_PAYMENT_CATEGORY) { invoicePayments = addMinor(invoicePayments, m); invoicePaymentCount++; } else manualSaleCount++;
    }
  }

  // ------------------------------------------------------------------ online: gross (counted by summarize), commission and net (commerce_sale_earnings)
  const counted = new Set(autoSales.filter((s) => s.currency.toUpperCase() === currency && toLocalDateKey(s.paidAt, tz) >= period.from && toLocalDateKey(s.paidAt, tz) <= period.to && (minorOf(s.amount, digits) ?? 0) > 0).map((s) => s.id));
  // Reconciliation: gross (orders) = commission + net (usable earnings) + gross of the orders WITHOUT usable earnings. An earning is usable only when it is
  // not reversed, is in the profile currency, and matches its order exactly (gross = order total = platform fee + net). Nothing is estimated for the rest.
  let commission = 0, net = 0, netPaidOut = 0, netNotPaidOut = 0, withEarnings = 0, withoutEarnings = 0, grossWithout = 0;
  for (const o of orders) {
    if (!counted.has(o.id)) continue;
    const e = asArray<any>(o.commerce_sale_earnings).find((x) => x && x.status !== "reversed" && String(x.currency).toUpperCase() === currency);
    const total = minorOf(o.total, digits) ?? 0;
    const eg = e ? minorOf(e.gross_amount, digits) : null;
    const fee = e ? minorOf(e.platform_fee, digits) : null;
    const n = e ? minorOf(e.net_amount, digits) : null;
    if (e && eg !== null && fee !== null && n !== null && eg === total && eg === fee + n) {
      commission = addMinor(commission, fee);
      net = addMinor(net, n);
      if (e.status === "paid") netPaidOut = addMinor(netPaidOut, n); else netNotPaidOut = addMinor(netNotPaidOut, n);
      withEarnings++;
    } else {
      withoutEarnings++;
      grossWithout = addMinor(grossWithout, total);
    }
  }

  let refundedCount = 0, refundedGross = 0;
  for (const o of orders) {
    if (o.status !== "refunded" || String(o.currency).toUpperCase() !== currency) continue;
    const m = minorOf(o.total, digits);
    if (m === null || m <= 0) continue;
    refundedCount++;
    refundedGross = addMinor(refundedGross, m);
  }

  // ------------------------------------------------------------------ top Shop products (items of exactly the orders counted above)
  const topProducts = !want.topProducts ? ([] as ReportModel["topProducts"]) : await safe(async () => {
    const ids = Array.from(counted);
    const groups = new Map<string, { names: Set<string>; units: number; gross: number }>();
    for (let i = 0; i < ids.length; i += ID_CHUNK) {
      const chunk = ids.slice(i, i + ID_CHUNK);
      const items: any[] = await fetchAllRows(() => owner.supabase.from("product_order_items").select("id, order_id, product_id, name_snapshot, quantity, line_total").in("order_id", chunk).order("id"));
      for (const it of items) {
        const gross = minorOf(it.line_total, digits);
        if (gross === null || !isNum(it.quantity) || it.quantity < 1) continue;
        const key = it.product_id ? `p:${it.product_id}` : `n:${it.name_snapshot}`;
        const g = groups.get(key) ?? { names: new Set<string>(), units: 0, gross: 0 };
        g.names.add(String(it.name_snapshot ?? ""));
        g.units += it.quantity;
        g.gross = addMinor(g.gross, gross);
        groups.set(key, g);
      }
    }
    return Array.from(groups.entries())
      .map(([key, g]) => ({ key, name: Array.from(g.names).sort()[0] || "", units: g.units, grossMinor: g.gross }))
      .sort((a, b) => b.grossMinor - a.grossMinor || b.units - a.units || a.name.localeCompare(b.name) || a.key.localeCompare(b.key))
      .slice(0, TOP_PRODUCTS)
      .map(({ name, units, grossMinor }) => ({ name, units, grossMinor }));
  }, [] as ReportModel["topProducts"]);

  // ------------------------------------------------------------------ invoices issued in the period (informational; never revenue)
  const invoicing = !want.invoicing ? { available: false, issuedCount: 0, issuedTotalMinor: 0, otherCurrencyCount: 0 } : await safe(async () => {
    const docs: any[] = await fetchAllRows(() =>
      owner.supabase.from("bk_documents").select("id, total, currency, status, issue_date").eq("profile_id", profileId).eq("doc_type", "invoice")
        .in("status", ["issued", "partially_paid", "paid"]).gte("issue_date", period.from).lte("issue_date", period.to).order("issue_date").order("id")
    );
    let count = 0, total = 0, other = 0;
    for (const d of docs) {
      if (String(d.currency).toUpperCase() !== currency) { other++; continue; }
      const m = minorOf(d.total, digits);
      if (m === null) continue;
      count++;
      total = addMinor(total, m);
    }
    return { available: true, issuedCount: count, issuedTotalMinor: total, otherCurrencyCount: other };
  }, { available: false, issuedCount: 0, issuedTotalMinor: 0, otherCurrencyCount: 0 });

  // ------------------------------------------------------------------ as of the generation date: receivables and inventory
  const asOfDate = todayKeyOf(now);
  const receivables = await safe(async () => {
    const { data, error } = await owner.admin.rpc("doc_receivables_summary", { p_profile_id: profileId, p_actor_user_id: owner.userId });
    if (error || !data) return { available: false, asOfDate, currencies: [] };
    const buckets = ["not_due", "no_due_date", "d1_30", "d31_60", "d61_90", "d90_plus"];
    const currencies = asArray<any>(data.currencies).map((c) => {
      const cd = currencyMinorDigits(String(c.currency));
      const aging: Record<string, AgingBucket> = {};
      for (const b of buckets) aging[b] = { minor: minorOf(c.aging?.[b]?.amount ?? 0, cd) ?? 0, count: Number(c.aging?.[b]?.count ?? 0) };
      return { currency: String(c.currency).toUpperCase(), minorDigits: cd, outstandingMinor: minorOf(c.outstanding, cd) ?? 0, overdueMinor: minorOf(c.overdue, cd) ?? 0, invoiceCount: Number(c.invoice_count ?? 0), overdueCount: Number(c.overdue_count ?? 0), aging };
    });
    return { available: true, asOfDate, currencies };
  }, { available: false, asOfDate, currencies: [] as any[] });

  const inventory = await safe(async () => {
    const base = await inventoryOverview(owner as any, { limit: "1" });
    if (base.status !== 200 || "pdf" in base) throw new Error("inventory unavailable");
    const s = base.body.summary;
    const list = async (filter: string) => {
      const r = await inventoryOverview(owner as any, { filter, limit: String(LOW_STOCK_LIST) });
      if (r.status !== 200 || "pdf" in r) return [];
      return (r.body.items as any[]).map((i) => ({ name: String(i.name ?? ""), count: i.count ?? null, threshold: i.low_stock_threshold ?? null, state: String(i.state) }));
    };
    const lowStockItems = [...(await list("out")), ...(await list("low"))];
    return { available: true, asOfDate, tracked: s.tracked, out: s.out, low: s.low, ok: s.ok, legacy: s.legacy, untracked: s.untracked, estimatedValueMinor: s.estimated_value_minor ?? 0, valueExcluded: s.value_excluded ?? 0, lowStockItems };
  }, { available: false, asOfDate, tracked: 0, out: 0, low: 0, ok: 0, legacy: 0, untracked: 0, estimatedValueMinor: 0, valueExcluded: 0, lowStockItems: [] as ReportModel["inventory"]["lowStockItems"] });

  // ------------------------------------------------------------------ assemble
  const receivedDirect = summary.cash.inflowMinor - summary.revenue.autoSalesMinor; // summarize() adds online gross to cash in (a Phase 1 simplification); it is NOT cash here
  const figures = {
    currency, period,
    revenue: { onlineGrossMinor: summary.revenue.autoSalesMinor, invoicePaymentsMinor: invoicePayments, manualSalesMinor: summary.revenue.manualSalesMinor - invoicePayments, otherIncomeMinor: summary.revenue.otherIncomeMinor, totalMinor: summary.revenue.totalMinor },
    counts: { paidOnlineOrders: summary.counts.autoSales, invoicePayments: invoicePaymentCount, manualSales: manualSaleCount },
    online: { grossMinor: summary.revenue.autoSalesMinor, commissionMinor: commission, netMinor: net, netPaidOutMinor: netPaidOut, netNotYetPaidOutMinor: netNotPaidOut, ordersWithEarnings: withEarnings, ordersWithoutEarnings: withoutEarnings, grossWithoutEarningsMinor: grossWithout },
    expenses: {
      operatingMinor: summary.expenses.operatingMinor, stockPurchasesMinor: summary.expenses.stockPurchasesMinor, totalMinor: summary.expenses.totalMinor, unpaidMinor: summary.unpaidExpensesMinor,
      byCategory: Object.entries(summary.expenses.byCategory).map(([category, minor]) => ({ category, minor })).sort((a, b) => b.minor - a.minor || a.category.localeCompare(b.category)),
    },
    cash: { receivedDirectMinor: receivedDirect, paidOutMinor: summary.cash.outflowMinor, netMovementMinor: receivedDirect - summary.cash.outflowMinor },
    uncollected: { salesMinor: summary.uncollected.salesMinor, otherIncomeMinor: summary.uncollected.otherIncomeMinor },
    invoicing, receivables, inventory, topProducts,
    refundedOrders: { count: refundedCount, grossMinor: refundedGross },
    exclusions: { voidedEntries: summary.excluded.voided, otherCurrency: summary.excluded.currencyMismatch, doubleCountPrevented: summary.excluded.doubleCountPrevented, unreadable: summary.excluded.unreadableAmount },
  };
  const business = want.business ? await loadBusiness(owner) : { name: "", legalName: null, address: null, phone: null, email: null, taxId: null, registrationNo: null };
  return {
    version: REPORT_VERSION,
    generatedAt: now.toISOString(),
    asOfDate,
    fingerprint: fingerprintOf(figures),
    business,
    period,
    currency,
    minorDigits: digits,
    revenue: figures.revenue,
    counts: figures.counts,
    online: figures.online,
    expenses: figures.expenses,
    cash: figures.cash,
    uncollected: figures.uncollected,
    invoicing,
    receivables,
    inventory,
    topProducts,
    refundedOrders: figures.refundedOrders,
    exclusions: figures.exclusions,
    profit: { status: "not_reported" },
  };
}
