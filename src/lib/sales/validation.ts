// Record Sale: validation of the request body. The database function sale_record re-validates everything (it is the authority); this gives the owner a
// precise error before a round trip and keeps junk out of the RPC. Prices and quantities are exact decimal TEXT, never floating point.
import { currencyMinorDigits, parseMinor } from "@/lib/bookkeeping/money";
import { DOCUMENT_LOCALES, PAYMENT_METHODS } from "@/lib/documents/constants";
import { parseQuantityMilli } from "@/lib/documents/totals";
import { isDateKey, isUuid } from "@/lib/documents/validation";

export const MAX_SALE_LINES = 20;

export type SaleLineInput = { product_id?: string; description?: string; quantity: string; unit_price?: string };
export type SaleInput = {
  locale: "en" | "fr";
  lines: SaleLineInput[];
  customer_id: string | null;
  method: string;
  sold_on: string | null;
  notes: string | null;
  client_request_id: string;
};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const asText = (v: unknown): string | null => {
  if (typeof v === "number") return Number.isFinite(v) && Math.abs(v) < 1e15 ? String(v) : null;
  if (typeof v === "string" && v.trim()) return v.trim().replace(",", ".");
  return null;
};

export type Parsed = { ok: true; value: SaleInput } | { ok: false; details: string[] };

export function parseSaleBody(body: unknown, currency: string): Parsed {
  if (!isObj(body)) return { ok: false, details: ["invalid_body"] };
  const errors: string[] = [];
  const digits = currencyMinorDigits(currency);

  const locale = (DOCUMENT_LOCALES as readonly unknown[]).includes(body.locale) ? (body.locale as "en" | "fr") : "fr";
  if (!(PAYMENT_METHODS as readonly unknown[]).includes(body.method)) errors.push("invalid_method");
  if (!isUuid(body.client_request_id)) errors.push("invalid_request_id");

  let customerId: string | null = null;
  if (body.customer_id !== undefined && body.customer_id !== null && body.customer_id !== "") {
    if (!isUuid(body.customer_id)) errors.push("invalid_customer");
    else customerId = body.customer_id;
  }
  let soldOn: string | null = null;
  if (body.sold_on !== undefined && body.sold_on !== null && body.sold_on !== "") {
    if (!isDateKey(body.sold_on)) errors.push("invalid_sold_on");
    else soldOn = body.sold_on;
  }
  let notes: string | null = null;
  if (body.notes !== undefined && body.notes !== null && body.notes !== "") {
    if (typeof body.notes !== "string" || Array.from(body.notes).length > 1000) errors.push("invalid_notes");
    else notes = body.notes.trim() || null;
  }

  const lines: SaleLineInput[] = [];
  if (!Array.isArray(body.lines) || body.lines.length < 1) errors.push("invalid_lines");
  else if (body.lines.length > MAX_SALE_LINES) errors.push("too_many_lines");
  else {
    body.lines.forEach((l, i) => {
      if (!isObj(l)) return void errors.push(`invalid_line:${i}`);
      const qty = asText(l.quantity);
      const unit = l.unit_price === undefined || l.unit_price === null || l.unit_price === "" ? null : asText(l.unit_price);
      if (isUuid(l.product_id)) {
        // a catalogue line: whole units only, the price defaults to the product's own (resolved by the database)
        if (qty === null || !/^[0-9]{1,9}$/.test(qty) || Number(qty) < 1) errors.push(`invalid_quantity:${i}`);
        if (unit !== null && parseMinor(unit, digits) === null) errors.push(`invalid_unit_price:${i}`);
        lines.push({ product_id: l.product_id, quantity: qty ?? "", ...(unit !== null ? { unit_price: unit } : {}) });
      } else {
        if (l.product_id !== undefined && l.product_id !== null && l.product_id !== "") errors.push(`invalid_product:${i}`);
        const desc = typeof l.description === "string" ? l.description : "";
        if (Array.from(desc.trim()).length < 1 || Array.from(desc).length > 300) errors.push(`invalid_description:${i}`);
        if (qty === null || parseQuantityMilli(qty) === null) errors.push(`invalid_quantity:${i}`);
        if (unit === null || parseMinor(unit, digits) === null) errors.push(`invalid_unit_price:${i}`);
        lines.push({ description: desc.trim(), quantity: qty ?? "", unit_price: unit ?? "" });
      }
    });
  }
  if (errors.length) return { ok: false, details: errors };
  return { ok: true, value: { locale, lines, customer_id: customerId, method: body.method as string, sold_on: soldOn, notes, client_request_id: body.client_request_id as string } };
}
