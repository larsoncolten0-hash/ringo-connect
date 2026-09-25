// Input validation for the product checkout API. Pure. Whitelists exactly the fields the browser
// may send; everything else (price, total, currency, profile, stock, amount…) is never read.

import { MAX_QUANTITY } from "./constants";
import type { CheckoutErrorCode } from "./errors";
import type { PaymentMedium } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

type Parsed<T> = { ok: true; value: T } | { ok: false; code: CheckoutErrorCode };
const bad = (code: CheckoutErrorCode): { ok: false; code: CheckoutErrorCode } => ({ ok: false, code });
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/g;
const clean = (s: string) => s.replace(CONTROL, " ").replace(/\s+/g, " ").trim();

export interface CreateOrderInput {
  productId: string;
  quantity: number;
  name: string;
  phone: string; // contact number as typed (normalised), not necessarily the payer's
  email: string | null;
  note: string | null;
  /** the language the customer was using (optional; anything else is ignored, never an error) */
  lang: "en" | "fr" | null;
}

export function parseCreateOrderInput(raw: unknown): Parsed<CreateOrderInput> {
  if (!isObject(raw)) return bad("invalid_request");

  if (!isUuid(raw.product_id)) return bad("product_unavailable");

  const q = typeof raw.quantity === "string" && /^\d{1,4}$/.test(raw.quantity.trim()) ? Number(raw.quantity) : raw.quantity;
  if (typeof q !== "number" || !Number.isInteger(q) || q < 1) return bad("invalid_quantity");
  if (q > MAX_QUANTITY) return bad("quantity_exceeds_max");

  if (typeof raw.customer_name !== "string") return bad("invalid_name");
  const name = clean(raw.customer_name);
  if (name.length < 1 || name.length > 120) return bad("invalid_name");

  if (typeof raw.customer_phone !== "string") return bad("invalid_phone");
  const phone = raw.customer_phone.replace(/[\s().-]/g, "");
  if (!/^\+?\d{6,15}$/.test(phone)) return bad("invalid_phone");

  let email: string | null = null;
  if (raw.customer_email !== undefined && raw.customer_email !== null && raw.customer_email !== "") {
    if (typeof raw.customer_email !== "string") return bad("invalid_email");
    const e = raw.customer_email.trim();
    if (e.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return bad("invalid_email");
    email = e.toLowerCase();
  }

  let note: string | null = null;
  if (raw.note !== undefined && raw.note !== null && raw.note !== "") {
    if (typeof raw.note !== "string") return bad("invalid_request");
    const n = clean(raw.note);
    if (n.length > 500) return bad("invalid_request");
    note = n || null;
  }

  const lang = raw.lang === "en" || raw.lang === "fr" ? raw.lang : null;

  return { ok: true, value: { productId: raw.product_id, quantity: q, name, phone, email, note, lang } };
}

export interface PayInput {
  phone: string; // 9-digit Cameroon mobile number, local format (what Fapshi expects)
  medium: PaymentMedium;
}

/** Same normalisation as fapshi.ts normalizeCameroonPhone: strip formatting and a leading 237. */
export function normalizePayerPhone(phone: string): string {
  let digits = phone.replace(/[^0-9]/g, "");
  if (digits.startsWith("237") && digits.length > 9) digits = digits.slice(3);
  return digits;
}

export function parsePayInput(raw: unknown): Parsed<PayInput> {
  if (!isObject(raw)) return bad("invalid_request");
  if (raw.medium !== "mobile money" && raw.medium !== "orange money") return bad("invalid_payment_medium");
  if (typeof raw.phone !== "string") return bad("invalid_phone");
  const phone = normalizePayerPhone(raw.phone);
  if (!/^6\d{8}$/.test(phone)) return bad("invalid_phone");
  return { ok: true, value: { phone, medium: raw.medium } };
}
