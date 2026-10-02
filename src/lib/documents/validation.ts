// Request validation for the document API. This is a FAST, friendly pre-check (precise error codes before any database call);
// the database functions re-validate everything and remain the authority. Nothing here computes a total or a number.
// Text is passed through UNCHANGED (stored exactly, UTF-8). Lengths are counted in code points, like PostgreSQL's char_length.
import { currencyMinorDigits, minorToAmountString, parseMinor } from "@/lib/bookkeeping/money";
import { DOCUMENT_LOCALES, LIMITS, PAYMENT_METHODS } from "./constants";
import { parseQuantityMilli } from "./totals";

export type Parsed<T> = { ok: true; value: T } | { ok: false; details: string[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const len = (s: string) => Array.from(s).length;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export function isDateKey(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().startsWith(s);
}

/** "19" -> 1900, "7.5" -> 750 (basis points). Exact decimal parsing; at most 2 decimals; 0..100. */
export function percentToBp(value: unknown): number | null {
  const s = typeof value === "number" && Number.isFinite(value) ? String(value) : typeof value === "string" ? value.trim().replace(",", ".") : "";
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) return null;
  const [w, f = ""] = s.split(".");
  const bp = Number(w) * 100 + (f ? Number(f.padEnd(2, "0")) : 0);
  return bp <= 10000 ? bp : null;
}

/** Numbers as the exact text the client sent (never re-formatted through floating point). */
const asText = (v: unknown): string | null => (typeof v === "string" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : null);

export type DraftInput = {
  locale: "en" | "fr";
  customer: Record<string, unknown> | null;
  due_date: string | null;
  notes: string | null;
  terms: string | null;
  tax_enabled: boolean;
  lines: { description: string; quantity: string; unit_price: string; discount_amount?: string; product_id?: string }[];
  replaces_document_id: string | null;
  client_request_id: string | null;
};

const CUSTOMER_LIMITS: Record<string, number> = { name: LIMITS.customerName, phone: LIMITS.customerPhone, email: LIMITS.customerEmail, address: LIMITS.customerAddress, tax_id: LIMITS.customerTaxId };

export function parseDraftBody(body: unknown, currency: string): Parsed<DraftInput> {
  if (!isObj(body)) return { ok: false, details: ["invalid_body"] };
  const errors: string[] = [];
  const digits = currencyMinorDigits(currency);

  const locale = body.locale;
  if (!(DOCUMENT_LOCALES as readonly unknown[]).includes(locale)) errors.push("invalid_locale");

  let customer: Record<string, unknown> | null = null;
  if (body.customer !== undefined && body.customer !== null) {
    if (!isObj(body.customer)) errors.push("invalid_customer");
    else {
      for (const [k, max] of Object.entries(CUSTOMER_LIMITS)) {
        const v = (body.customer as Record<string, unknown>)[k];
        if (v !== undefined && v !== null && (typeof v !== "string" || len(v) > max)) errors.push("invalid_customer");
      }
      customer = body.customer as Record<string, unknown>;
    }
  }

  let dueDate: string | null = null;
  if (body.due_date !== undefined && body.due_date !== null && body.due_date !== "") {
    if (!isDateKey(body.due_date)) errors.push("invalid_due_date");
    else dueDate = body.due_date;
  }
  const text = (key: "notes" | "terms", max: number, code: string): string | null => {
    const v = body[key];
    if (v === undefined || v === null) return null;
    if (typeof v !== "string" || len(v) > max) {
      errors.push(code);
      return null;
    }
    return v;
  };
  const notes = text("notes", LIMITS.notes, "invalid_notes");
  const terms = text("terms", LIMITS.terms, "invalid_terms");

  const taxEnabled = body.tax_enabled === undefined ? false : body.tax_enabled;
  if (typeof taxEnabled !== "boolean") errors.push("invalid_tax_enabled");

  const lines: DraftInput["lines"] = [];
  if (!Array.isArray(body.lines)) errors.push("invalid_lines");
  else if (body.lines.length > LIMITS.maxLines) errors.push("too_many_lines");
  else {
    body.lines.forEach((l, i) => {
      if (!isObj(l)) return void errors.push(`invalid_line:${i}`);
      const desc = l.description;
      if (typeof desc !== "string" || len(desc.trim()) < 1 || len(desc) > LIMITS.description) errors.push(`invalid_description:${i}`);
      const qty = asText(l.quantity);
      if (qty === null || parseQuantityMilli(qty) === null) errors.push(`invalid_quantity:${i}`);
      const unit = asText(l.unit_price);
      if (unit === null || parseMinor(unit, digits) === null) errors.push(`invalid_unit_price:${i}`);
      const discRaw = l.discount_amount;
      const disc = discRaw === undefined || discRaw === null || discRaw === "" ? null : asText(discRaw);
      if (discRaw !== undefined && discRaw !== null && discRaw !== "" && (disc === null || parseMinor(disc, digits) === null)) errors.push(`invalid_discount:${i}`);
      const pid = l.product_id;
      if (pid !== undefined && pid !== null && !isUuid(pid)) errors.push(`invalid_product:${i}`);
      if (typeof desc === "string" && qty !== null && unit !== null)
        lines.push({ description: desc, quantity: qty, unit_price: unit, ...(disc !== null ? { discount_amount: disc } : {}), ...(isUuid(pid) ? { product_id: pid } : {}) });
    });
  }

  const replaces = body.replaces_document_id ?? null;
  if (replaces !== null && !isUuid(replaces)) errors.push("invalid_replacement");
  const requestId = body.client_request_id ?? null;
  if (requestId !== null && !isUuid(requestId)) errors.push("invalid_request_id");

  if (errors.length) return { ok: false, details: errors };
  return { ok: true, value: { locale: locale as "en" | "fr", customer, due_date: dueDate, notes, terms, tax_enabled: taxEnabled as boolean, lines, replaces_document_id: replaces as string | null, client_request_id: requestId as string | null } };
}

export type PaymentInput = { amount: string; method: string; reference: string | null; paid_on: string; client_request_id: string };

export function parsePaymentBody(body: unknown, currency: string, todayKey: string): Parsed<PaymentInput> {
  if (!isObj(body)) return { ok: false, details: ["invalid_body"] };
  const errors: string[] = [];
  const digits = currencyMinorDigits(currency);
  const raw = asText(body.amount);
  let amount = "";
  if (raw === null) errors.push("invalid_amount");
  else {
    const minor = parseMinor(raw, digits);
    if (minor === null || minor <= 0) {
      // distinguish "valid number with too many decimals" from garbage
      const frac = (raw.split(".")[1] || "").replace(/0+$/, "");
      errors.push(/^\d+\.\d+$/.test(raw) && frac.length > digits ? "amount_too_precise" : "invalid_amount");
    } else amount = minorToAmountString(minor, digits);
  }
  if (typeof body.method !== "string" || !(PAYMENT_METHODS as readonly string[]).includes(body.method)) errors.push("invalid_method");
  let reference: string | null = null;
  if (body.reference !== undefined && body.reference !== null && body.reference !== "") {
    if (typeof body.reference !== "string" || len(body.reference) > LIMITS.paymentReference) errors.push("invalid_reference");
    else reference = body.reference;
  }
  let paidOn = todayKey;
  if (body.paid_on !== undefined && body.paid_on !== null && body.paid_on !== "") {
    if (!isDateKey(body.paid_on)) errors.push("invalid_paid_on");
    else if (body.paid_on > todayKey) errors.push("invalid_paid_on");
    else paidOn = body.paid_on;
  }
  if (!isUuid(body.client_request_id)) errors.push("request_id_required");
  if (errors.length) return { ok: false, details: errors };
  return { ok: true, value: { amount, method: body.method as string, reference, paid_on: paidOn, client_request_id: body.client_request_id as string } };
}

export function parseReasonBody(body: unknown): Parsed<{ reason: string }> {
  const reason = isObj(body) && typeof body.reason === "string" ? body.reason : "";
  if (reason.trim() === "" || len(reason) > LIMITS.voidReason) return { ok: false, details: ["reason_required"] };
  return { ok: true, value: { reason } };
}

export type BusinessProfileInput = {
  display_name: string; legal_name: string | null; address: string | null; phone: string | null; email: string | null; tax_id: string | null;
  registration_no: string | null; default_terms: string | null; default_due_days: number | null; tax_label: string | null; tax_rate_bp: number | null;
  /** Structured payment instructions (bank, account, mobile money, other); null when none. Keys are whitelisted; the database re-cleans them. */
  payment_details: Record<string, string> | null;
};

export const PAYMENT_DETAIL_KEYS = ["bank_name", "account_name", "account_number", "momo_provider", "momo_number", "instructions"] as const;
export const PAYMENT_DETAIL_MAX = { bank_name: 120, account_name: 120, account_number: 120, momo_provider: 120, momo_number: 120, instructions: 500 } as const;

export function parseBusinessProfileBody(body: unknown): Parsed<BusinessProfileInput> {
  if (!isObj(body)) return { ok: false, details: ["invalid_body"] };
  const errors: string[] = [];
  const opt = (key: string, max: number): string | null => {
    const v = body[key];
    if (v === undefined || v === null || v === "") return null;
    if (typeof v !== "string" || len(v) > max) {
      errors.push(`invalid_${key}`);
      return null;
    }
    return v;
  };
  const name = body.display_name;
  if (typeof name !== "string" || len(name.trim()) < 1 || len(name) > LIMITS.displayName) errors.push("invalid_display_name");
  const email = opt("email", LIMITS.email);
  if (email !== null && email.indexOf("@") < 1) errors.push("invalid_email");
  let dueDays: number | null = null;
  if (body.default_due_days !== undefined && body.default_due_days !== null && body.default_due_days !== "") {
    const n = Number(body.default_due_days);
    if (!Number.isInteger(n) || n < 0 || n > 365) errors.push("invalid_due_days");
    else dueDays = n;
  }
  const label = opt("tax_label", LIMITS.taxLabel);
  let rate: number | null = null;
  if (body.tax_rate_bp !== undefined && body.tax_rate_bp !== null && body.tax_rate_bp !== "") {
    const n = Number(body.tax_rate_bp);
    if (!Number.isInteger(n) || n < 0 || n > 10000) errors.push("invalid_tax_rate");
    else rate = n;
  }
  if ((label === null || label.trim() === "") !== (rate === null)) errors.push("tax_incomplete");   // tax is ON only when both are set; OFF by default
  let paymentDetails: Record<string, string> | null = null;
  const pd = body.payment_details;
  if (pd !== undefined && pd !== null) {
    if (!isObj(pd)) errors.push("invalid_payment_details");
    else {
      const out: Record<string, string> = {};
      for (const k of PAYMENT_DETAIL_KEYS) {
        const v = pd[k];
        if (v === undefined || v === null || v === "") continue;
        if (typeof v !== "string" || len(v) > PAYMENT_DETAIL_MAX[k]) errors.push("invalid_payment_details");
        else if (v.trim() !== "") out[k] = v.trim();
      }
      paymentDetails = Object.keys(out).length ? out : null;
    }
  }
  const value: BusinessProfileInput = {
    display_name: typeof name === "string" ? name : "", legal_name: opt("legal_name", LIMITS.legalName), address: opt("address", LIMITS.address),
    phone: opt("phone", LIMITS.phone), email, tax_id: opt("tax_id", LIMITS.taxId), registration_no: opt("registration_no", LIMITS.registrationNo),
    default_terms: opt("default_terms", LIMITS.terms), default_due_days: dueDays, tax_label: label, tax_rate_bp: rate, payment_details: paymentDetails,
  };
  return errors.length ? { ok: false, details: errors } : { ok: true, value };
}

/** Basis points -> the percentage text a person edits: 1900 -> "19", 750 -> "7.5", 1225 -> "12.25". Exact (no floating point). */
export function bpToPercentText(bp: number): string {
  if (!Number.isInteger(bp) || bp < 0 || bp > 10000) return "";
  const frac = String(bp % 100).padStart(2, "0").replace(/0+$/, "");
  return String(Math.trunc(bp / 100)) + (frac ? `.${frac}` : "");
}
