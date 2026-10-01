// Exact invoice arithmetic. Money is integer MINOR UNITS of the document currency (0 decimals for XAF, 2 for USD, 3 for KWD…).
// The ONE rounding rule is half-up to the currency's decimals, applied to two products only:
//   gross = quantity × unit price            tax = (gross − discount) × rate
// Everything else is exact addition/subtraction of already-rounded values, so totals are sums of stored line values.
// SQL (bk_doc_compute_line) is authoritative; this mirror exists for previews and is tested for parity.
// The project targets ES2017, so BigInt is used through BigInt(...) calls only (no `n` literals).
import { addMinor, currencyMinorDigits, parseMinor } from "@/lib/bookkeeping/money";
import { LIMITS } from "./constants";

const TWO = BigInt(2);

/** round-half-up of n / d for n >= 0, d > 0 */
function divRoundHalfUp(n: bigint, d: bigint): bigint {
  return (n * TWO + d) / (TWO * d);
}

/** Quantity as an integer count of thousandths (up to 3 decimals), or null. Rejects exponents, signs, zero and excess precision. */
export function parseQuantityMilli(value: unknown): number | null {
  const s = typeof value === "number" && Number.isFinite(value) ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const [whole, fracRaw = ""] = s.split(".");
  const frac = fracRaw.replace(/0+$/, "");
  if (frac.length > LIMITS.maxQuantityDecimals) return null;
  if (whole.replace(/^0+(?=\d)/, "").length > 9) return null;
  const milli = Number(whole) * 1000 + (frac ? Number(frac.padEnd(3, "0")) : 0);
  return milli > 0 && Number.isSafeInteger(milli) ? milli : null;
}

export type LineResult = { grossMinor: number; discountMinor: number; taxMinor: number; totalMinor: number };
export type LineError = "invalid_quantity" | "invalid_unit_price" | "invalid_discount" | "invalid_tax_rate" | "discount_exceeds_amount" | "amount_too_large";

function toSafe(b: bigint): number | null {
  const n = Number(b);
  return Number.isSafeInteger(n) ? n : null;
}

/** One line. `rateBp` is basis points (1900 = 19%) or null/undefined when tax is off. */
export function computeLine(
  input: { quantity: unknown; unitPrice: unknown; discount?: unknown },
  currency: string,
  rateBp: number | null | undefined
): { ok: true; line: LineResult } | { ok: false; error: LineError } {
  const digits = currencyMinorDigits(currency);
  const qtyMilli = parseQuantityMilli(input.quantity);
  if (qtyMilli === null) return { ok: false, error: "invalid_quantity" };
  const unit = parseMinor(input.unitPrice, digits);
  if (unit === null) return { ok: false, error: "invalid_unit_price" };
  const discount = input.discount === undefined || input.discount === null || input.discount === "" ? 0 : parseMinor(input.discount, digits);
  if (discount === null) return { ok: false, error: "invalid_discount" };

  const gross = toSafe(divRoundHalfUp(BigInt(qtyMilli) * BigInt(unit), BigInt(1000)));
  if (gross === null) return { ok: false, error: "amount_too_large" };
  if (discount > gross) return { ok: false, error: "discount_exceeds_amount" };
  const net = gross - discount;
  let tax = 0;
  if (rateBp !== null && rateBp !== undefined) {
    if (!Number.isInteger(rateBp) || rateBp < 0 || rateBp > 10000) return { ok: false, error: "invalid_tax_rate" };
    const t = toSafe(divRoundHalfUp(BigInt(net) * BigInt(rateBp), BigInt(10000)));
    if (t === null) return { ok: false, error: "amount_too_large" };
    tax = t;
  }
  return { ok: true, line: { grossMinor: gross, discountMinor: discount, taxMinor: tax, totalMinor: net + tax } };
}

export type DocumentTotals = { subtotalMinor: number; discountMinor: number; taxMinor: number; totalMinor: number; lines: LineResult[] };

/** Whole document: sums of the per-line results. total = subtotal − discount + tax always holds. */
export function computeDocument(
  lines: { quantity: unknown; unitPrice: unknown; discount?: unknown }[],
  currency: string,
  rateBp: number | null | undefined
): { ok: true; totals: DocumentTotals } | { ok: false; error: LineError | "too_many_lines"; lineIndex?: number } {
  if (lines.length > LIMITS.maxLines) return { ok: false, error: "too_many_lines" };
  const out: LineResult[] = [];
  let subtotal = 0, discount = 0, tax = 0, total = 0;
  for (let i = 0; i < lines.length; i++) {
    const r = computeLine(lines[i], currency, rateBp);
    if (!r.ok) return { ok: false, error: r.error, lineIndex: i };
    out.push(r.line);
    subtotal = addMinor(subtotal, r.line.grossMinor);
    discount = addMinor(discount, r.line.discountMinor);
    tax = addMinor(tax, r.line.taxMinor);
    total = addMinor(total, r.line.totalMinor);
  }
  return { ok: true, totals: { subtotalMinor: subtotal, discountMinor: discount, taxMinor: tax, totalMinor: total, lines: out } };
}

/** Outstanding balance of an invoice (never negative). */
export function balanceMinor(totalMinor: number, amountPaidMinor: number): number {
  return Math.max(0, totalMinor - amountPaidMinor);
}

/**
 * Overdue is CALCULATED, never stored: an invoice that is issued or partially paid, has a due date before `todayKey`
 * (business-local YYYY-MM-DD) and still has a balance.
 */
export function isOverdue(d: { status: string; dueDate: string | null; totalMinor: number; amountPaidMinor: number }, todayKey: string): boolean {
  return (d.status === "issued" || d.status === "partially_paid") && !!d.dueDate && d.dueDate < todayKey && balanceMinor(d.totalMinor, d.amountPaidMinor) > 0;
}
