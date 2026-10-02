import { currencyMinorDigits } from "@/lib/bookkeeping/money";
import { listCustomers } from "@/lib/customers/handlers";
import { deriveTotals, statementTruncation } from "@/lib/customers/profile";
import { inventoryOverview } from "@/lib/inventory/handlers";
import { categoryNotes, initials, minimizeNames } from "@/lib/ai/business/categories";
import { requireBusinessAi } from "@/lib/ai/business/gate";
import { categoryHasInventory } from "@/lib/bookkeeping/decision";
import { BUSINESS_PERIODS, isBusinessPeriodKind, resolveBusinessPeriod, type BusinessPeriodKind } from "@/lib/ai/business/period";
import { overviewSummary } from "@/lib/overview/handlers";
import { LIGHT_SECTIONS, buildTrends, buildYtd, TREND_METRICS, type Comparison } from "@/lib/overview/trends";
import { contactStatement, receivableInvoices, receivablesSummary } from "@/lib/receivables/handlers";
import { buildMonthlyReport } from "@/lib/reports/build";
import { periodFor, todayKeyOf } from "@/lib/reports/period";
import { clipText, NO_INPUT_SCHEMA, parseNoInput, type AiTool, type AiToolContext } from "../types";

// Ringo AI x Business Toolkit, Phase A: seven READ-ONLY tools. They add NO financial calculation: each one asks the EXISTING Business Toolkit function for
// the figures (buildOverview, buildMonthlyReport, buildTrends/buildYtd, the receivables and customer-statement handlers, the inventory handler) and only
// reshapes the answer for the model (major units, short keys, no phone/e-mail, no ids). Rules shared by all of them:
//   * the gate (requireBusinessAi) runs first: owner, plan with ai_enabled AND business_toolkit_enabled, the toolkit's own gate, same workspace;
//   * the model supplies no profile id and no id of any kind: customers are found by name inside the owner's own contacts, and an ambiguous name is
//     returned as a question, never guessed;
//   * dates are Africa/Douala business dates (src/lib/ai/business/period.ts), never UTC;
//   * amounts are per currency and never added across currencies; profit is never reported;
//   * a tool stops itself at 8 s (the registry's hard limit is 10 s) and says so instead of failing, and results stay small.
// There is NO write tool here: financial writes (a later phase) will only ever be drafts confirmed with the owner's click.

const BUDGET_MS = 8000;
const SOURCE_NOTE = "Figures come from the owner's Business Toolkit records (bookkeeping entries, invoice payments, Shop orders, invoices, stock). Dates are Africa/Douala business days.";

type Owner = Parameters<typeof overviewSummary>[0];
const ownerOf = (o: unknown) => o as Owner;

/** The categories of the page this request runs for (from the server-built snapshot). */
const shapeOf = (ctx: AiToolContext) => ({ category: ctx.snapshot.profile.category, categories: ctx.snapshot.profile.categories });
/** Category registry flag: customer names are reduced to initials for this page (health: financial layer only). */
const shownName = (ctx: AiToolContext, name: string | null | undefined): string | null => (minimizeNames(shapeOf(ctx)) ? initials(name) : clipText(name, 80));

async function gate(ctx: AiToolContext) {
  return requireBusinessAi(ctx);
}

function withinBudget<T>(promise: Promise<T>): Promise<T | "timeout"> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve("timeout"), BUDGET_MS);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}
const TOO_SLOW = { error: "too_slow", note: "This took too long to compute. Ask for a shorter period or fewer months. Do not guess any figure." };
const UNREADABLE = { error: "could_not_read", note: "Could not read this data right now; do not guess it." };

/** minor units -> a plain number in major units of the currency (XAF has no decimals, USD has two...). */
const major = (minor: number | null | undefined, currency: string): number | null => {
  if (typeof minor !== "number" || !Number.isFinite(minor)) return null;
  const d = currencyMinorDigits(currency);
  return Number((minor / 10 ** d).toFixed(d));
};

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const clamp = (raw: unknown, def: number, max: number) => {
  const n = typeof raw === "number" && Number.isFinite(raw) ? Math.floor(raw) : def;
  return Math.min(max, Math.max(1, n));
};

const DEFINITIONS = [
  "Revenue is what the business recorded earning (an invoice counts when a payment is recorded on it, not when it is issued).",
  "Net cash movement is money recorded as received minus money recorded as paid out. It is not profit; profit is not reported.",
  "Online (Shop) seller earnings are what Ringo owes the seller after its commission; they are not cash and not part of net cash movement.",
  "Money owed by customers (receivables) is neither revenue nor cash.",
];

// ------------------------------------------------------------------------------------------------------------------------------ get_business_summary
export const getBusinessSummary: AiTool<Record<string, never>> = {
  name: "get_business_summary",
  description:
    "Business Toolkit overview for the current month so far (Africa/Douala dates): revenue recorded, expenses recorded, money received and paid out, online Shop sales with Ringo commission and net earnings, money owed by customers (as of today, per currency), inventory counts and low-stock items, and what was left out. Use it for 'give me a summary of my business' and 'how is my business doing'. Never reports profit.",
  kind: "read",
  permission: "reports.view",
  available: (s) => s.businessToolkitAi,
  inputSchema: NO_INPUT_SCHEMA,
  parseInput: parseNoInput,
  async run(ctx) {
    const g = await gate(ctx);
    if (!g.ok) return g.refusal;
    const r = await withinBudget(overviewSummary(ownerOf(g.owner), { now: ctx.now }));
    if (r === "timeout") return TOO_SLOW;
    if (r.status !== 200 || "pdf" in r) return UNREADABLE;
    const o = r.body.overview;
    const c = o.currency as string;
    return {
      source: "business_toolkit_overview",
      note: SOURCE_NOTE,
      as_of: o.asOfDate,
      currency: c,
      this_month_so_far: {
        from: o.period.from,
        to: o.period.to,
        revenue_recorded_total: major(o.revenue.totalMinor, c),
        revenue_parts: { online_sales_gross: major(o.revenue.onlineGrossMinor, c), invoice_payments_recorded: major(o.revenue.invoicePaymentsMinor, c), manual_sales: major(o.revenue.manualSalesMinor, c), other_income: major(o.revenue.otherIncomeMinor, c) },
        expenses_recorded: major(o.expenses.totalMinor, c),
        money_received_directly: major(o.cash.receivedDirectMinor, c),
        money_paid_out: major(o.cash.paidOutMinor, c),
        net_cash_movement: major(o.cash.netMovementMinor, c),
      },
      online_sales_this_month: {
        gross: major(o.online.grossMinor, c),
        ringo_commission: major(o.online.commissionMinor, c),
        net_seller_earnings: major(o.online.netMinor, c),
        net_already_paid_out: major(o.online.netPaidOutMinor, c),
        net_not_yet_paid_out: major(o.online.netNotYetPaidOutMinor, c),
        paid_orders: o.counts.paidOnlineOrders,
      },
      money_owed_to_the_business_as_of_today: o.receivables.available
        ? o.receivables.currencies.map((x: any) => ({ currency: x.currency, outstanding: major(x.outstandingMinor, x.currency), overdue: major(x.overdueMinor, x.currency), open_invoices: x.invoiceCount, overdue_invoices: x.overdueCount }))
        : "unavailable",
      inventory_as_of_today: o.inventory.available
        ? { tracked_products: o.inventory.tracked, out_of_stock: o.inventory.out, low_stock: o.inventory.low, in_stock: o.inventory.ok, low_stock_items: o.inventory.lowStockItems.map((i: any) => ({ name: clipText(i.name, 60), on_hand: i.count, threshold: i.threshold, state: i.state })) }
        : "unavailable",
      left_out_of_the_figures: {
        voided_entries: o.exclusions.voidedEntries,
        records_in_other_currencies: o.exclusions.otherCurrency,
        orders_currently_marked_refunded: o.refundedOrders.count,
      },
      definitions: DEFINITIONS,
      category_notes: categoryNotes(shapeOf(ctx)),
    };
  },
};

// ------------------------------------------------------------------------------------------------------------------------------ get_sales
export const getSales: AiTool<{ period: BusinessPeriodKind; from: string | null; to: string | null }> = {
  name: "get_sales",
  description:
    "Revenue and cash for a period, from the Business Toolkit report (Africa/Douala dates): revenue recorded (online Shop sales gross, invoice payments, manual sales, other income), the number of each, expenses recorded, money received and paid out, net cash movement, and online commission/net earnings. Periods: today, yesterday, this_week (Monday to today), this_month (so far), previous_month, or custom with from and to as YYYY-MM-DD (at most 93 days, not in the future). For 'how much did I sell today' use period today. For comparisons or longer spans use get_business_trends. Never reports profit.",
  kind: "read",
  permission: "reports.view",
  available: (s) => s.businessToolkitAi,
  inputSchema: {
    type: "object",
    properties: {
      period: { type: "string", enum: [...BUSINESS_PERIODS], description: "today | yesterday | this_week | this_month | previous_month | custom." },
      from: { type: ["string", "null"], description: "Only for period custom: first day, YYYY-MM-DD. Otherwise null." },
      to: { type: ["string", "null"], description: "Only for period custom: last day, YYYY-MM-DD. Otherwise null." },
    },
    required: ["period", "from", "to"],
    additionalProperties: false,
  },
  parseInput: (raw) => {
    const r = raw as { period?: unknown; from?: unknown; to?: unknown } | null;
    if (!r || typeof r !== "object" || !isBusinessPeriodKind(r.period)) return null;
    if (r.period === "custom") return typeof r.from === "string" && typeof r.to === "string" ? { period: "custom", from: r.from, to: r.to } : null;
    return { period: r.period, from: null, to: null };
  },
  async run(ctx, input) {
    const g = await gate(ctx);
    if (!g.ok) return g.refusal;
    const now = ctx.now ?? new Date();
    const p = resolveBusinessPeriod(input.period, now, { from: input.from, to: input.to });
    if (!p.ok) return { error: p.error, note: "Ask the user for a valid period (custom ranges: past or today, at most 93 days)." };
    const owner = g.owner as any;
    const r = await withinBudget(buildMonthlyReport(owner, p.period, { now, sections: LIGHT_SECTIONS }));
    if (r === "timeout") return TOO_SLOW;
    const c = r.currency;
    return {
      source: "business_toolkit_report",
      note: SOURCE_NOTE,
      period: p.label,
      from: p.from,
      to: p.to,
      currency: c,
      revenue_recorded_total: major(r.revenue.totalMinor, c),
      revenue_parts: { online_sales_gross: major(r.revenue.onlineGrossMinor, c), invoice_payments_recorded: major(r.revenue.invoicePaymentsMinor, c), manual_sales: major(r.revenue.manualSalesMinor, c), other_income: major(r.revenue.otherIncomeMinor, c) },
      counts: { paid_online_orders: r.counts.paidOnlineOrders, invoice_payments: r.counts.invoicePayments, manual_sales: r.counts.manualSales },
      sales_recorded_but_not_yet_received: major(r.uncollected.salesMinor, c),
      expenses_recorded: major(r.expenses.totalMinor, c),
      money_received_directly: major(r.cash.receivedDirectMinor, c),
      money_paid_out: major(r.cash.paidOutMinor, c),
      net_cash_movement: major(r.cash.netMovementMinor, c),
      online_sales: { gross: major(r.online.grossMinor, c), ringo_commission: major(r.online.commissionMinor, c), net_seller_earnings: major(r.online.netMinor, c), net_not_yet_paid_out: major(r.online.netNotYetPaidOutMinor, c) },
      left_out_of_the_figures: { voided_entries: r.exclusions.voidedEntries, records_in_other_currencies: r.exclusions.otherCurrency, orders_currently_marked_refunded: r.refundedOrders.count },
      definitions: DEFINITIONS,
      category_notes: categoryNotes(shapeOf(ctx)),
    };
  },
};

// ------------------------------------------------------------------------------------------------------------------------------ get_business_trends
const MONTH_SPANS = [3, 6, 12] as const;
const COMPARED = [...TREND_METRICS];

const cmpOut = (c: Comparison, currency: string) => ({
  current: major(c.currentMinor, currency),
  previous: major(c.previousMinor, currency),
  change: major(c.changeMinor, currency),
  percent_change: c.percent,
  ...(c.percent === null ? { percent_unavailable: c.percentReason === "sign_change" ? "the sign changed" : "nothing was recorded in the previous period" } : {}),
});

export const getBusinessTrends: AiTool<{ months: 3 | 6 | 12; end: "this_month" | "previous_month"; include_year_to_date: boolean }> = {
  name: "get_business_trends",
  description:
    "Monthly trend over the last 3, 6 or 12 months (revenue recorded, expenses recorded, money received/paid out, net cash movement, online sales gross, Ringo commission, net online earnings) plus the comparison of the latest month with the previous equivalent period, and optionally the year to date. The current month is month to date and is compared with the SAME DAYS of the previous month. Use it for 'how are my sales trending' and 'compare this month with last month'. Same definitions as the Monthly report; never reports profit.",
  kind: "read",
  permission: "reports.view",
  available: (s) => s.businessToolkitAi,
  inputSchema: {
    type: "object",
    properties: {
      months: { type: "number", enum: [...MONTH_SPANS], description: "How many months to show: 3, 6 or 12." },
      end: { type: "string", enum: ["this_month", "previous_month"], description: "this_month = ends with the current month so far; previous_month = ends with the last completed month." },
      include_year_to_date: { type: "boolean", description: "Also return the year to date (January to the end month). Slower; only when asked." },
    },
    required: ["months", "end", "include_year_to_date"],
    additionalProperties: false,
  },
  parseInput: (raw) => {
    const r = raw as { months?: unknown; end?: unknown; include_year_to_date?: unknown } | null;
    if (!r || typeof r !== "object") return null;
    if (!(MONTH_SPANS as readonly unknown[]).includes(r.months)) return null;
    if (r.end !== "this_month" && r.end !== "previous_month") return null;
    if (typeof r.include_year_to_date !== "boolean") return null;
    return { months: r.months as 3 | 6 | 12, end: r.end, include_year_to_date: r.include_year_to_date };
  },
  async run(ctx, input) {
    const g = await gate(ctx);
    if (!g.ok) return g.refusal;
    const now = ctx.now ?? new Date();
    const [ty, tm] = todayKeyOf(now).split("-").map(Number);
    const target = input.end === "this_month" ? { year: ty, month: tm } : tm === 1 ? { year: ty - 1, month: 12 } : { year: ty, month: tm - 1 };
    const sel = periodFor(target.year, target.month, now);
    if (!sel.ok) return { error: sel.error, note: "That month is outside the reportable range." };
    const owner = g.owner as any;
    const work = Promise.all([buildTrends(owner, sel.period, input.months, { now }), input.include_year_to_date ? buildYtd(owner, sel.period, { now }) : Promise.resolve(null)]);
    const r = await withinBudget(work);
    if (r === "timeout") return TOO_SLOW;
    const [t, y] = r;
    const c = t.currency;
    return {
      source: "business_toolkit_trends",
      note: SOURCE_NOTE,
      currency: c,
      months: t.points.map((p) => ({
        month: `${p.year}-${String(p.month).padStart(2, "0")}`,
        month_to_date: p.kind === "month_to_date",
        revenue_recorded: major(p.revenueMinor, c),
        expenses_recorded: major(p.expensesMinor, c),
        money_received_directly: major(p.cashReceivedMinor, c),
        money_paid_out: major(p.cashPaidOutMinor, c),
        net_cash_movement: major(p.netCashMinor, c),
        online_sales_gross: major(p.onlineGrossMinor, c),
        ringo_commission: major(p.commissionMinor, c),
        net_online_earnings: major(p.onlineNetMinor, c),
      })),
      comparison: t.comparison.previous && t.comparison.metrics
        ? {
            latest_month: `${t.selected.year}-${String(t.selected.month).padStart(2, "0")}`,
            compared_with: t.comparison.previous.basis === "same_days" ? `the same days (${t.comparison.previous.from} to ${t.comparison.previous.to}) of the previous month` : `the whole previous month (${t.comparison.previous.from} to ${t.comparison.previous.to})`,
            metrics: Object.fromEntries(COMPARED.map((m) => [m, cmpOut(t.comparison.metrics![m], c)])),
            note: "A change is a difference between two periods, not a profit or a loss.",
          }
        : "no earlier period to compare with",
      year_to_date: y
        ? {
            from: y.from,
            to: y.to,
            includes_current_month_to_date: y.partial,
            revenue_recorded: major(y.totals.revenueMinor, c),
            expenses_recorded: major(y.totals.expensesMinor, c),
            money_received_directly: major(y.totals.cashReceivedMinor, c),
            money_paid_out: major(y.totals.cashPaidOutMinor, c),
            net_cash_movement: major(y.totals.netCashMinor, c),
            online_sales_gross: major(y.totals.onlineGrossMinor, c),
            net_online_earnings: major(y.totals.onlineNetMinor, c),
            note: "Only amounts that add up over time; receivables and inventory are snapshots and are not part of it.",
          }
        : undefined,
      left_out_of_the_figures: { voided_entries: t.disclosures.exclusions.voidedEntries, records_in_other_currencies: t.disclosures.exclusions.otherCurrency, orders_currently_marked_refunded: t.disclosures.refunded.count },
      definitions: DEFINITIONS,
    };
  },
};

// ------------------------------------------------------------------------------------------------------------------------------ get_outstanding_invoices
export const getOutstandingInvoices: AiTool<{ only_overdue: boolean; limit: number }> = {
  name: "get_outstanding_invoices",
  description:
    "Who owes the business money: totals per currency (outstanding, overdue, open invoice counts, invoices not linked to a customer) and the most urgent open invoices (overdue first) with customer name, invoice number, due date, total, paid and amount due. Use it for 'who owes me money' and 'what invoices are overdue'. Receivables are not revenue and not cash. No phone numbers or e-mails are returned.",
  kind: "read",
  permission: "payments.view",
  available: (s) => s.businessToolkitAi,
  inputSchema: {
    type: "object",
    properties: {
      only_overdue: { type: "boolean", description: "true = only invoices past their due date." },
      limit: { type: "number", description: "How many invoices to list (1-15). The server clamps this." },
    },
    required: ["only_overdue", "limit"],
    additionalProperties: false,
  },
  parseInput: (raw) => {
    const r = raw as { only_overdue?: unknown; limit?: unknown } | null;
    if (!r || typeof r !== "object" || typeof r.only_overdue !== "boolean") return null;
    return { only_overdue: r.only_overdue, limit: clamp(r.limit, 10, 15) };
  },
  async run(ctx, input) {
    const g = await gate(ctx);
    if (!g.ok) return g.refusal;
    const owner = ownerOf(g.owner);
    const r = await withinBudget(Promise.all([receivablesSummary(owner), receivableInvoices(owner, { overdue: input.only_overdue ? "1" : null, limit: String(input.limit), offset: "0" })]));
    if (r === "timeout") return TOO_SLOW;
    const [sum, list] = r;
    if (sum.status !== 200 || "pdf" in sum || list.status !== 200 || "pdf" in list) return UNREADABLE;
    return {
      source: "business_toolkit_receivables",
      note: "As of today (Africa/Douala). Amounts are per currency and never added together. Receivables are not revenue and not cash.",
      today: sum.body.today,
      totals_per_currency: sum.body.currencies.map((c: any) => ({
        currency: c.currency,
        outstanding: major(c.outstanding_minor, c.currency),
        overdue: major(c.overdue_minor, c.currency),
        open_invoices: c.invoice_count,
        overdue_invoices: c.overdue_count,
        not_linked_to_a_customer: { open_invoices: c.unassigned.invoice_count, outstanding: major(c.unassigned.outstanding_minor, c.currency) },
      })),
      invoices: (list.body.items as any[]).map((i) => ({
        customer: shownName(ctx, i.customer_name) ?? "(not linked to a customer)",
        invoice: i.number,
        status: i.status,
        issued: i.issue_date,
        due: i.due_date,
        currency: i.currency,
        total: major(i.total_minor, i.currency),
        paid: major(i.amount_paid_minor, i.currency),
        amount_due: major(i.amount_due_minor, i.currency),
        overdue: i.overdue,
        days_overdue: i.overdue ? i.days_overdue : 0,
      })),
      invoices_shown: (list.body.items as any[]).length,
      invoices_matching: list.body.total,
    };
  },
};

// ------------------------------------------------------------------------------------------------------------------------------ get_customer_statement
const MATCH_LIMIT = 8;

export const getCustomerStatement: AiTool<{ person_name: string }> = {
  name: "get_customer_statement",
  description:
    "A customer's statement from the business's OWN customer book: per-currency totals (invoiced, payments received, outstanding, overdue), their open invoices and their latest payments with receipt numbers. Give the customer's name; if several customers match, the tool returns the matches and you must ask the user which one, never guess. No phone, e-mail or notes are returned. Payments received are not revenue figures and are never added across currencies.",
  kind: "read",
  permission: "payments.view",
  available: (s) => s.businessToolkitAi,
  inputSchema: {
    type: "object",
    properties: { person_name: { type: "string", description: "The customer's name as the user said it (2-80 characters)." } },
    required: ["person_name"],
    additionalProperties: false,
  },
  parseInput: (raw) => {
    const v = (raw as { person_name?: unknown } | null)?.person_name;
    if (typeof v !== "string") return null;
    const t = v.replace(/\s+/g, " ").trim();
    return t.length >= 2 && t.length <= 80 ? { person_name: t } : null;
  },
  async run(ctx, { person_name }) {
    const g = await gate(ctx);
    if (!g.ok) return g.refusal;
    const owner = ownerOf(g.owner);
    const found = await withinBudget(listCustomers(owner, { q: person_name, status: "all", limit: String(MATCH_LIMIT), offset: "0" }));
    if (found === "timeout") return TOO_SLOW;
    if (found.status !== 200 || "pdf" in found) return UNREADABLE;
    const items = found.body.items as { id: string; name: string; archived: boolean }[];
    if (items.length === 0) return { status: "not_found", note: "No customer in the business's own customer book matches that name. Ask the user to check the spelling; do not guess." };

    const exact = items.filter((i) => norm(i.name) === norm(person_name));
    const chosen = items.length === 1 ? items[0] : exact.length === 1 ? exact[0] : null;
    if (!chosen) {
      return {
        status: "ambiguous",
        matches: items.map((i) => ({ name: shownName(ctx, i.name), archived: i.archived })),
        total_matches: found.body.total ?? items.length,
        identical_names: exact.length > 1,
        note: exact.length > 1 ? "Several customers have exactly this name. Ask the user to tell them apart, or to open the customer in Customers." : "Several customers match. Ask the user which one they mean; do not guess.",
      };
    }

    const st = await withinBudget(contactStatement(owner, chosen.id));
    if (st === "timeout") return TOO_SLOW;
    if (st.status !== 200 || "pdf" in st) return UNREADABLE;
    const s = st.body;
    const totals = deriveTotals(s.invoices, s.payments, s.totals);
    const open = (s.invoices as any[]).filter((i) => i.amount_due_minor > 0 && (i.status === "issued" || i.status === "partially_paid"));
    const payments = (s.payments as any[]).filter((p) => !p.voided).sort((a, b) => String(b.paid_on).localeCompare(String(a.paid_on)));
    const trunc = statementTruncation(s.invoices, s.payments);
    return {
      status: "ok",
      source: "business_toolkit_customer_statement",
      note: "Payments received are what the business recorded on this customer's invoices; they are not revenue figures. Amounts are per currency.",
      customer: { name: shownName(ctx, s.customer.name), archived: s.customer.archived === true },
      totals_per_currency: totals.map((t) => ({
        currency: t.currency,
        invoiced: major(t.invoiced_minor, t.currency),
        payments_received: major(t.payments_received_minor, t.currency),
        outstanding: major(t.outstanding_minor, t.currency),
        overdue: major(t.overdue_minor, t.currency),
        invoices: t.invoice_count,
        payments: t.payment_count,
        last_invoice_date: t.last_invoice_date,
        last_payment_date: t.last_payment_date,
      })),
      open_invoices: open.slice(0, 8).map((i) => ({ invoice: i.number, status: i.status, issued: i.issue_date, due: i.due_date, currency: i.currency, total: major(i.total_minor, i.currency), amount_due: major(i.amount_due_minor, i.currency), overdue: i.overdue })),
      open_invoices_total: open.length,
      latest_payments: payments.slice(0, 5).map((p) => ({ paid_on: p.paid_on, amount: major(p.amount_minor, p.currency), currency: p.currency, invoice: p.invoice_number, receipt: p.receipt_number, method: p.method })),
      statement_incomplete: trunc.invoices || trunc.payments ? "Only the latest 200 invoices and 500 payments are included." : undefined,
    };
  },
};

// ------------------------------------------------------------------------------------------------------------------------------ get_inventory / get_low_stock
const SCAN_PAGE = 100;
const SCAN_PAGES = 5;

type InvItem = { name: string; state: string; tracked: boolean; count: number | null; low_stock_threshold: number | null; reserved: number; sold_units: number; available: boolean };
const invOut = (i: InvItem) => ({
  product: clipText(i.name, 60),
  state: i.state,
  stock_tracked: i.tracked,
  on_hand: i.count,
  low_stock_threshold: i.low_stock_threshold,
  reserved_for_unpaid_orders: i.reserved,
  units_sold: i.sold_units,
  listed_for_sale: i.available,
});
const STATE_NOTE = "state: out = none left, low = at or below the product's own low-stock threshold, ok = in stock, legacy = a count exists but tracking was not adopted, untracked = Ringo is not tracking stock for it.";

export const getInventory: AiTool<{ name: string | null; limit: number }> = {
  name: "get_inventory",
  description:
    "Stock from the Business Toolkit inventory: counts of tracked products by state (out of stock, low, in stock), and either the products matching a name ('how many T-shirts do I have') or the first tracked products. Only products whose stock the owner chose to track have a reliable count. Use get_low_stock for 'what is running low'.",
  kind: "read",
  permission: "reports.view",
  available: (s) => s.businessToolkitAi && categoryHasInventory({ category: s.profile.category, categories: s.profile.categories }),
  inputSchema: {
    type: "object",
    properties: {
      name: { type: ["string", "null"], description: "Part of a product name to look for, or null to list tracked products." },
      limit: { type: "number", description: "How many products to return (1-15). The server clamps this." },
    },
    required: ["name", "limit"],
    additionalProperties: false,
  },
  parseInput: (raw) => {
    const r = raw as { name?: unknown; limit?: unknown } | null;
    if (!r || typeof r !== "object") return null;
    let name: string | null = null;
    if (r.name !== null && r.name !== undefined) {
      if (typeof r.name !== "string") return null;
      const t = r.name.replace(/\s+/g, " ").trim();
      if (t.length > 80) return null;
      name = t.length >= 1 ? t : null;
    }
    return { name, limit: clamp(r.limit, 10, 15) };
  },
  async run(ctx, { name, limit }) {
    const g = await gate(ctx);
    if (!g.ok) return g.refusal;
    const owner = ownerOf(g.owner);
    const work = (async () => {
      if (!name) return { first: await inventoryOverview(owner, { filter: "tracked", limit: String(limit), offset: "0" }), matches: null as InvItem[] | null, scanned: 0, complete: true };
      const needle = norm(name);
      const hits: InvItem[] = [];
      let first: Awaited<ReturnType<typeof inventoryOverview>> | null = null;
      let scanned = 0, total = Infinity;
      for (let page = 0; page < SCAN_PAGES && scanned < total; page++) {
        const r = await inventoryOverview(owner, { limit: String(SCAN_PAGE), offset: String(page * SCAN_PAGE) });
        if (page === 0) first = r;
        if (r.status !== 200 || "pdf" in r) return { first: r, matches: null, scanned, complete: false };
        total = Number(r.body.total) || 0;
        const items = r.body.items as InvItem[];
        scanned += items.length;
        for (const it of items) if (norm(String(it.name ?? "")).includes(needle)) hits.push(it);
        if (items.length === 0) break;
      }
      return { first: first!, matches: hits, scanned, complete: scanned >= total };
    })();
    const r = await withinBudget(work);
    if (r === "timeout") return TOO_SLOW;
    const { first } = r;
    if (first.status !== 200 || "pdf" in first) return UNREADABLE;
    const sum = first.body.summary;
    const c = first.body.profile_currency as string;
    const base = {
      source: "business_toolkit_inventory",
      note: `${STATE_NOTE} Counts are as of now. The estimated stock value is informational only (count x the owner's unit cost): it is not an accounting valuation, profit or cash.`,
      summary: { tracked_products: sum.tracked, out_of_stock: sum.out, low_stock: sum.low, in_stock: sum.ok, tracking_not_adopted: sum.legacy, not_tracked: sum.untracked, estimated_stock_value: major(sum.estimated_value_minor, c), currency: c },
    };
    if (name) {
      const m = r.matches ?? [];
      return { ...base, searched_for: clipText(name, 80), matches: m.slice(0, limit).map(invOut), matches_total: m.length, search_complete: r.complete, ...(r.matches === null ? { error_partial: "could_not_finish_the_search" } : {}) };
    }
    return { ...base, products: (first.body.items as InvItem[]).map(invOut), products_total_tracked: sum.tracked };
  },
};

export const getLowStock: AiTool<{ limit: number }> = {
  name: "get_low_stock",
  description:
    "Products that are out of stock or at/below their own low-stock threshold (each product's threshold is set by the owner; the default is 5). Out-of-stock products come first. Use it for 'what is low in stock' and 'what do I need to restock'.",
  kind: "read",
  permission: "reports.view",
  available: (s) => s.businessToolkitAi && categoryHasInventory({ category: s.profile.category, categories: s.profile.categories }),
  inputSchema: {
    type: "object",
    properties: { limit: { type: "number", description: "How many products per list (1-15). The server clamps this." } },
    required: ["limit"],
    additionalProperties: false,
  },
  parseInput: (raw) => {
    const r = raw as { limit?: unknown } | null;
    return r && typeof r === "object" ? { limit: clamp(r.limit, 10, 15) } : null;
  },
  async run(ctx, { limit }) {
    const g = await gate(ctx);
    if (!g.ok) return g.refusal;
    const owner = ownerOf(g.owner);
    const r = await withinBudget(Promise.all([inventoryOverview(owner, { filter: "out", limit: String(limit), offset: "0" }), inventoryOverview(owner, { filter: "low", limit: String(limit), offset: "0" })]));
    if (r === "timeout") return TOO_SLOW;
    const [out, low] = r;
    if (out.status !== 200 || "pdf" in out || low.status !== 200 || "pdf" in low) return UNREADABLE;
    const sum = out.body.summary;
    return {
      source: "business_toolkit_inventory",
      note: `${STATE_NOTE} The threshold is each product's own setting, never a number invented here.`,
      summary: { tracked_products: sum.tracked, out_of_stock: sum.out, low_stock: sum.low },
      out_of_stock: (out.body.items as InvItem[]).map(invOut),
      low_stock: (low.body.items as InvItem[]).map(invOut),
      out_of_stock_total: sum.out,
      low_stock_total: sum.low,
    };
  },
};

export const BUSINESS_AI_TOOLS = [getBusinessSummary, getSales, getBusinessTrends, getOutstandingInvoices, getCustomerStatement, getInventory, getLowStock] as const;
