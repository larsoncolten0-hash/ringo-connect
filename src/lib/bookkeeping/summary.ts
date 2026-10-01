// Simple Bookkeeping — pure calculation layer (no database, no network, no React). The server loader
// supplies rows; tests pass fixtures. All arithmetic is on integer MINOR UNITS of the business currency
// (see ./money.ts: 0 decimals for XAF, 2 for USD/EUR, 3 for KWD…), never floating-point amounts.
//
// Four figures are kept DISTINCT on purpose and must never be folded into one another:
//   * revenue      — what the business earned in the period (sales + other income), paid or not
//   * cash flow    — money that actually moved in / out
//   * uncollected  — revenue recorded but not yet received (credit sales); NOT a payment
//   * profit       — only reported when cost data is sufficient; never "cash in minus cash out"
import { addMinor, currencyMinorDigits, parseMinor } from "./money";

export const DEFAULT_TIME_ZONE = "Africa/Douala";

export const ENTRY_KINDS = ["sale", "other_income", "expense", "cash_in", "cash_out"] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

/** Order sources a manual entry may point at. Only `product_order` is auto-counted as a sale today. */
export const LINKED_ORDER_TYPES = ["product_order", "restaurant_order", "music_order"] as const;
export type LinkedOrderType = (typeof LINKED_ORDER_TYPES)[number];

/** Expense category that is NOT an operating expense: goods bought for resale. Inventory is an asset
 *  until it is sold, so it is reported separately and excluded from the profit calculation. */
export const STOCK_PURCHASE_CATEGORY = "stock_purchase";

export type BkEntry = {
  id: string;
  kind: EntryKind;
  amount: number | string;
  currency: string;
  entry_date: string; // YYYY-MM-DD, the merchant's own calendar date
  category?: string | null;
  cash_settled: boolean;
  linked_order_type?: LinkedOrderType | null;
  linked_order_id?: string | null;
  voided_at?: string | null;
};

/** A sale that is counted automatically from an existing, server-verified order. */
export type AutoSale = {
  id: string;
  source: "product_order";
  amount: number | string;
  currency: string;
  paidAt: string; // ISO timestamp
};

export type CostBasis =
  | { kind: "none_needed" } // a pure service business: no goods sold, no cost of goods
  | { kind: "known"; costOfGoodsSoldMinor: number } // supplied by Inventory (a later phase)
  | { kind: "unknown" }; // goods are sold but their cost is not recorded

export type ProfitEstimate =
  | { status: "available"; minor: number; basis: "revenue_minus_operating_expenses_and_cost_of_goods" }
  | { status: "unavailable"; reason: "cost_of_goods_unknown" };

export type BookkeepingSummary = {
  currency: string;
  /** Decimals of the currency; every `…Minor` figure is in units of 10^-minorDigits. */
  minorDigits: number;
  from: string;
  to: string;
  revenue: { autoSalesMinor: number; manualSalesMinor: number; salesMinor: number; otherIncomeMinor: number; totalMinor: number };
  expenses: { operatingMinor: number; stockPurchasesMinor: number; totalMinor: number; byCategory: Record<string, number> };
  cash: { inflowMinor: number; outflowMinor: number; netMovementMinor: number };
  uncollected: { salesMinor: number; otherIncomeMinor: number };
  unpaidExpensesMinor: number;
  profit: ProfitEstimate;
  counts: { autoSales: number; manualEntries: number };
  /** Rows deliberately NOT counted — surfaced so a total is never silently lower than the ledger. */
  excluded: { voided: number; currencyMismatch: number; doubleCountPrevented: number; unreadableAmount: number };
};

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
export const isDateKey = (s: unknown): s is string => {
  if (typeof s !== "string" || !DATE_KEY.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().startsWith(s); // rejects 2026-13-40 and 2026-02-30
};

// ---------------------------------------------------------------------------------------------
// Business-local dates. Every "which day / which month is this instant in" question goes through
// here, so daily and monthly figures use the same boundaries everywhere.
// ---------------------------------------------------------------------------------------------
function resolveZone(tz: string): string {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

/** The calendar date (YYYY-MM-DD) an instant falls on in `timeZone` (invalid zone -> default zone). */
export function toLocalDateKey(input: string | Date, timeZone: string = DEFAULT_TIME_ZONE): string {
  const d = typeof input === "string" ? new Date(input) : input;
  return new Intl.DateTimeFormat("en-CA", { timeZone: resolveZone(timeZone), year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function zoneOffsetMs(utcMs: number, tz: string): number {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(utcMs));
  const n = (t: string) => Number(p.find((x) => x.type === t)!.value);
  return Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second")) - Math.floor(utcMs / 1000) * 1000;
}

/** The instant a local calendar day begins in `timeZone` (handles DST zones; Douala has none). */
export function localDayStart(dateKey: string, timeZone: string = DEFAULT_TIME_ZONE): Date {
  const tz = resolveZone(timeZone);
  const [y, m, d] = dateKey.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  let start = guess - zoneOffsetMs(guess, tz);
  start = guess - zoneOffsetMs(start, tz); // re-evaluate at the candidate to settle across a DST change
  return new Date(start);
}

/** [from 00:00 local, day after `to` 00:00 local) as instants — for filtering timestamp columns such as
 *  product_orders.paid_at in SQL/PostgREST with `>= start` and `< endExclusive`. */
export function localRangeInstants(from: string, to: string, timeZone: string = DEFAULT_TIME_ZONE): { start: string; endExclusive: string } {
  if (!isDateKey(from) || !isDateKey(to) || from > to) throw new Error("localRangeInstants: invalid date range");
  const next = new Date(`${to}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return { start: localDayStart(from, timeZone).toISOString(), endExclusive: localDayStart(next.toISOString().slice(0, 10), timeZone).toISOString() };
}

/** First and last calendar day of the month containing `dateKey`, e.g. "2026-02-14" -> 2026-02-01..2026-02-28. */
export function monthRange(dateKey: string): { from: string; to: string } {
  const [y, m] = dateKey.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, "0");
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, "0")}` };
}

/** Product-order row -> auto sale. Only a SERVER-VERIFIED paid order counts: status paid|fulfilled with
 *  a paid_at. Awaiting-payment, expired, cancelled, payment_review and refunded orders are never sales. */
export function autoSaleFromProductOrder(o: { id: string; status: string; total: number | string; currency: string; paid_at?: string | null }): AutoSale | null {
  if (o.status !== "paid" && o.status !== "fulfilled") return null;
  if (!o.paid_at) return null;
  return { id: o.id, source: "product_order", amount: o.total, currency: o.currency, paidAt: o.paid_at };
}

const inRange = (day: string, from: string, to: string) => day >= from && day <= to;

export function summarize(input: {
  entries: BkEntry[];
  autoSales?: AutoSale[];
  from: string;
  to: string;
  currency: string;
  timeZone?: string;
  cost?: CostBasis;
}): BookkeepingSummary {
  const { from, to } = input;
  if (!isDateKey(from) || !isDateKey(to) || from > to) throw new Error("summarize: invalid date range");
  const currency = input.currency.toUpperCase();
  const digits = currencyMinorDigits(currency);
  const tz = input.timeZone || DEFAULT_TIME_ZONE;
  const excluded = { voided: 0, currencyMismatch: 0, doubleCountPrevented: 0, unreadableAmount: 0 };
  const amountOf = (v: number | string) => {
    const m = parseMinor(v, digits);
    if (m === null || m <= 0) {
      excluded.unreadableAmount++;
      return null;
    }
    return m;
  };

  // ---- auto sales: one per order id, verified-paid, in range, same currency
  const seenAuto = new Set<string>();
  let autoSalesMinor = 0;
  let autoCount = 0;
  for (const s of input.autoSales ?? []) {
    if (seenAuto.has(`${s.source}:${s.id}`)) {
      excluded.doubleCountPrevented++;
      continue;
    }
    seenAuto.add(`${s.source}:${s.id}`);
    if (s.currency.toUpperCase() !== currency) {
      excluded.currencyMismatch++;
      continue;
    }
    if (!inRange(toLocalDateKey(s.paidAt, tz), from, to)) continue;
    const c = amountOf(s.amount);
    if (c === null) continue;
    autoSalesMinor = addMinor(autoSalesMinor, c);
    autoCount++;
  }

  let manualSales = 0, otherIncome = 0, operating = 0, stockPurchases = 0;
  let cashIn = 0, cashOut = 0, uncollectedSales = 0, uncollectedOther = 0, unpaidExpenses = 0, manualCount = 0;
  const byCategory: Record<string, number> = {};

  for (const e of input.entries) {
    if (e.voided_at) {
      excluded.voided++;
      continue;
    }
    if (!inRange(e.entry_date, from, to)) continue;
    if (e.currency.toUpperCase() !== currency) {
      excluded.currencyMismatch++;
      continue;
    }
    // Defence in depth behind the database rule: a manual sale pointing at an order that is already
    // counted automatically would be the same sale twice.
    if (e.kind === "sale" && e.linked_order_type === "product_order" && e.linked_order_id && seenAuto.has(`product_order:${e.linked_order_id}`)) {
      excluded.doubleCountPrevented++;
      continue;
    }
    const c = amountOf(e.amount);
    if (c === null) continue;
    manualCount++;
    switch (e.kind) {
      case "sale":
        manualSales = addMinor(manualSales, c);
        if (e.cash_settled) cashIn = addMinor(cashIn, c); else uncollectedSales = addMinor(uncollectedSales, c);
        break;
      case "other_income":
        otherIncome = addMinor(otherIncome, c);
        if (e.cash_settled) cashIn = addMinor(cashIn, c); else uncollectedOther = addMinor(uncollectedOther, c);
        break;
      case "expense": {
        const cat = e.category || "uncategorised";
        byCategory[cat] = addMinor(byCategory[cat] || 0, c);
        if (cat === STOCK_PURCHASE_CATEGORY) stockPurchases = addMinor(stockPurchases, c); else operating = addMinor(operating, c);
        if (e.cash_settled) cashOut = addMinor(cashOut, c); else unpaidExpenses = addMinor(unpaidExpenses, c);
        break;
      }
      case "cash_in":
        cashIn = addMinor(cashIn, c); // money received that is not revenue (capital, loan, float): cash only
        break;
      case "cash_out":
        cashOut = addMinor(cashOut, c); // money paid out that is not an expense (owner drawing, loan repayment): cash only
        break;
    }
  }

  // Auto sales are server-verified paid orders, so they are cash received.
  cashIn = addMinor(cashIn, autoSalesMinor);

  const salesMinor = addMinor(autoSalesMinor, manualSales);
  const revenueTotal = addMinor(salesMinor, otherIncome);
  const cost: CostBasis = input.cost ?? { kind: "unknown" };

  let profit: ProfitEstimate;
  if (cost.kind === "known") {
    profit = { status: "available", minor: revenueTotal - operating - cost.costOfGoodsSoldMinor, basis: "revenue_minus_operating_expenses_and_cost_of_goods" };
  } else if (cost.kind === "none_needed" || salesMinor === 0) {
    profit = { status: "available", minor: revenueTotal - operating, basis: "revenue_minus_operating_expenses_and_cost_of_goods" };
  } else {
    profit = { status: "unavailable", reason: "cost_of_goods_unknown" };
  }

  return {
    currency, minorDigits: digits, from, to,
    revenue: { autoSalesMinor, manualSalesMinor: manualSales, salesMinor, otherIncomeMinor: otherIncome, totalMinor: revenueTotal },
    expenses: { operatingMinor: operating, stockPurchasesMinor: stockPurchases, totalMinor: addMinor(operating, stockPurchases), byCategory },
    cash: { inflowMinor: cashIn, outflowMinor: cashOut, netMovementMinor: cashIn - cashOut },
    uncollected: { salesMinor: uncollectedSales, otherIncomeMinor: uncollectedOther },
    unpaidExpensesMinor: unpaidExpenses,
    profit,
    counts: { autoSales: autoCount, manualEntries: manualCount },
    excluded,
  };
}

// ---------------------------------------------------------------------------------------------
// Input validation (mirrors the database CHECKs and the RPC's rules; the server route calls this
// before the RPC so the merchant gets a precise error instead of a raw constraint failure).
// ---------------------------------------------------------------------------------------------
export type EntryInput = {
  kind: unknown;
  amount: unknown;
  entry_date: unknown;
  category?: unknown;
  description?: unknown;
  cash_settled?: unknown;
  linked_order_type?: unknown;
  linked_order_id?: unknown;
};
export type EntryError = "invalid_kind" | "invalid_amount" | "amount_too_precise" | "invalid_date" | "date_in_future" | "invalid_category" | "description_too_long" | "cash_entry_must_be_settled" | "invalid_link" | "sale_link_auto_counted" | "invalid_cash_settled";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateEntryInput(i: EntryInput, opts: { currency: string; today: string }): { ok: true; minor: number } | { ok: false; errors: EntryError[] } {
  const errors: EntryError[] = [];
  const digits = currencyMinorDigits(opts.currency);
  if (typeof i.kind !== "string" || !(ENTRY_KINDS as readonly string[]).includes(i.kind)) errors.push("invalid_kind");
  const minor = parseMinor(i.amount, digits);
  if (minor === null) {
    // A well-formed decimal that failed to parse has more decimals than the currency supports (or is
    // over the maximum); anything else is simply not an amount.
    const raw = typeof i.amount === "number" ? String(i.amount) : typeof i.amount === "string" ? i.amount.trim() : "";
    const [, frac = ""] = raw.split(".");
    errors.push(/^\d+\.\d+$/.test(raw) && frac.replace(/0+$/, "").length > digits ? "amount_too_precise" : "invalid_amount");
  } else if (minor <= 0) errors.push("invalid_amount");
  if (!isDateKey(i.entry_date)) errors.push("invalid_date");
  else if (i.entry_date > opts.today) errors.push("date_in_future");
  if (i.category != null && (typeof i.category !== "string" || i.category.trim().length < 1 || i.category.trim().length > 60)) errors.push("invalid_category");
  if (i.description != null && (typeof i.description !== "string" || i.description.length > 500)) errors.push("description_too_long");
  if (i.cash_settled != null && typeof i.cash_settled !== "boolean") errors.push("invalid_cash_settled");
  if ((i.kind === "cash_in" || i.kind === "cash_out") && i.cash_settled === false) errors.push("cash_entry_must_be_settled");
  const hasType = i.linked_order_type != null, hasId = i.linked_order_id != null;
  if (hasType !== hasId || (hasType && !(LINKED_ORDER_TYPES as readonly unknown[]).includes(i.linked_order_type)) || (hasId && !(typeof i.linked_order_id === "string" && UUID.test(i.linked_order_id)))) errors.push("invalid_link");
  if (i.kind === "sale" && i.linked_order_type === "product_order") errors.push("sale_link_auto_counted");
  return errors.length ? { ok: false, errors } : { ok: true, minor: minor as number };
}
