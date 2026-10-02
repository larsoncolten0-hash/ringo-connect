import { currencyMinorDigits, minorToAmountString } from "@/lib/bookkeeping/money";
import { recordEntry } from "@/lib/bookkeeping/recordEntry";
import { ENTRY_KINDS, validateEntryInput } from "@/lib/bookkeeping/summary";
import { requireBusinessAi } from "@/lib/ai/business/gate";
import { categoryHasInventory } from "@/lib/bookkeeping/decision";
import { DOCUMENT_LOCALES } from "@/lib/documents/constants";
import { createDraft, recordPayment, type ApiResult, type DocOwner } from "@/lib/documents/handlers";
import { computeDocument } from "@/lib/documents/totals";
import { isUuid, parseDraftBody, parsePaymentBody } from "@/lib/documents/validation";
import { adjustStock, correctCount } from "@/lib/inventory/handlers";
import { ADJUST_KINDS, REASON_REQUIRED_KINDS, STOCK_LIMITS } from "@/lib/inventory/constants";
import { saveContact, setDocumentCustomer } from "@/lib/receivables/handlers";
import { parseContactBody } from "@/lib/receivables/validation";
import { todayKeyOf } from "@/lib/reports/period";
import { emailFromOwner, phoneFromOwner } from "./provenance";
import type { ApplyFailure, ApplyResult, DraftDefinition, DraftFacts, DraftValidationContext, ValidationResult } from "./types";

// Ringo AI x Business Toolkit, Phase B/C: the Business Toolkit DRAFT types. Ringo AI can only PREPARE one of these; the owner's own click on
// "Confirm & Apply" (POST /api/ai/drafts/[id]/apply, the existing mechanism) is the only thing that applies it, and applying calls the Toolkit's OWN
// server functions (recordEntry, createDraft, recordPayment, saveContact, adjustStock, correctCount) after re-running the Toolkit gate. Nothing here runs
// SQL, calls an RPC directly, or takes a profile id: the profile is the server-resolved workspace, and every id a draft carries (customer, invoice,
// product) was resolved by the server inside the owner's own records and is re-checked by the Toolkit function that applies it.
//
// Idempotency: every apply uses the draft's own unique target id as the Toolkit request id (client_request_id), so a replayed or double-clicked confirm
// returns the first result and never writes twice. Dates are Africa/Douala business days.

const ZERO_UUID = "00000000-0000-4000-8000-000000000000"; // placeholder request id used only to run the Toolkit's own parsers; never stored
const bad = (fields: string[]): ValidationResult<never> => ({ ok: false, reason: "invalid_input", fields });
const missing = (fields: string[]): ValidationResult<never> => ({ ok: false, reason: "missing_fields", fields });
const obj = (raw: unknown): Record<string, unknown> | null => (raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null);
const toolkitGate = (facts: DraftFacts) => (facts.businessToolkitAi === true ? ({ ok: true } as const) : ({ ok: false, reason: "feature_unavailable" } as const));
const today = () => todayKeyOf(new Date());
const amountText = (v: unknown): string | null => (typeof v === "number" && Number.isFinite(v) ? String(v) : typeof v === "string" && v.trim() ? v.trim().replace(",", ".") : null);
const major = (amount: string) => Number(amount);
/** A stored payload is re-validated at apply time, so every validator accepts BOTH the tool's snake_case input and its own camelCase payload. */
const get = (r: Record<string, unknown>, snake: string, camel: string): unknown => (r[snake] !== undefined ? r[snake] : r[camel]);

async function owner(workspace: Parameters<DraftDefinition<any>["apply"]>[1]): Promise<DocOwner | null> {
  const g = await requireBusinessAi({ workspace });
  return g.ok ? g.owner : null;
}

/** Maps a Toolkit function's HTTP-style answer to the draft apply outcome. `codes` maps the Toolkit's own error names to a more specific failure. */
function outcome(r: ApiResult, onOk: (body: any) => { resultId: string | null }, codes: Record<string, ApplyFailure> = {}): ApplyResult {
  if ("pdf" in r) return { ok: false, code: "write_failed" };
  if (r.status === 200 || r.status === 201) {
    const { resultId } = onOk(r.body);
    return { ok: true, resultId: resultId && isUuid(resultId) ? resultId : null, alreadyApplied: r.body?.duplicate === true };
  }
  const named = typeof r.body?.error === "string" ? codes[r.body.error] : undefined;
  if (named) return { ok: false, code: named };
  if (r.status === 400) return { ok: false, code: "invalid_payload" };
  if (r.status === 401 || r.status === 403) return { ok: false, code: "business_unavailable" };
  if (r.status === 404) return { ok: false, code: "target_not_found" };
  if (r.status === 409) return { ok: false, code: "rejected_by_rules" };
  if (r.status === 503) return { ok: false, code: "business_unavailable" };
  return { ok: false, code: "write_failed" };
}

// ============================================================================================================================ bk.entry.create
export interface EntryDraftPayload {
  kind: string;
  /** Exact decimal in the business currency (e.g. "25000" or "12.50"). */
  amount: string;
  date: string;
  category: string | null;
  description: string | null;
  settled: boolean;
  currency: string;
}

const ENTRY_FIELD: Record<string, string> = { invalid_kind: "kind", invalid_amount: "amount", amount_too_precise: "amount", invalid_date: "date", date_in_future: "date", invalid_category: "category", description_too_long: "description", invalid_cash_settled: "settled", cash_entry_must_be_settled: "settled" };
const OUT = ["expense", "cash_out"];

export function validateEntryDraft(raw: unknown, ctx: DraftValidationContext): ValidationResult<EntryDraftPayload> {
  const r = obj(raw);
  if (!r) return { ok: false, reason: "invalid_input" };
  const currency = ctx.facts.currency;
  const kind = typeof r.kind === "string" ? r.kind : "";
  if (!(ENTRY_KINDS as readonly string[]).includes(kind)) return bad(["kind"]);
  const cash = kind === "cash_in" || kind === "cash_out";
  const amount = amountText(r.amount);
  if (amount === null) return missing(["amount"]);
  const date = r.date === null || r.date === undefined || r.date === "" ? today() : r.date;
  const category = cash ? null : typeof r.category === "string" && r.category.trim() ? r.category.trim() : r.category == null ? null : (undefined as any);
  const description = typeof r.description === "string" && r.description.trim() ? r.description.trim() : r.description == null ? null : (undefined as any);
  const settled = cash ? true : r.settled === undefined || r.settled === null ? true : r.settled;
  if (category !== null && typeof category !== "string") return bad(["category"]);
  if (description !== null && typeof description !== "string") return bad(["description"]);
  // an entry in the reserved invoice_payment category is created ONLY by recording a payment on an invoice: never typed in, never by the AI
  if (typeof category === "string" && category.toLowerCase() === "invoice_payment") return bad(["category"]);
  const v = validateEntryInput({ kind, amount, entry_date: date, category, description, cash_settled: settled } as any, { currency, today: today() });
  if (!v.ok) return bad(Array.from(new Set(v.errors.map((e) => ENTRY_FIELD[e] ?? "amount"))));
  return { ok: true, payload: { kind, amount: minorToAmountString(v.minor, currencyMinorDigits(currency)), date: date as string, category, description, settled: settled as boolean, currency } };
}

export const entryCreateDraft: DraftDefinition<EntryDraftPayload> = {
  type: "bk.entry.create",
  validate: validateEntryDraft,
  availability: (facts) => toolkitGate(facts),
  changes: (p) => [
    { field: "bk_kind", kind: "enum", before: null, after: p.kind },
    { field: "bk_amount", kind: "price", before: null, after: { amount: major(p.amount), currency: p.currency } },
    { field: "bk_date", kind: "date", before: null, after: p.date },
    ...(p.category ? [{ field: "bk_category", kind: "enum" as const, before: null, after: p.category }] : []),
    ...(p.description ? [{ field: "bk_description", kind: "text" as const, before: null, after: p.description }] : []),
    ...(p.kind === "cash_in" || p.kind === "cash_out" ? [] : [{ field: "bk_settled", kind: "enum" as const, before: null, after: `${p.settled ? "" : "not_"}${OUT.includes(p.kind) ? "paid" : "received"}` }]),
  ],
  summary: (p) => `Record ${p.kind}: ${p.amount} ${p.currency}`.slice(0, 120),
  fieldNames: (p) => ["kind", "amount", "entry_date", ...(p.category ? ["category"] : []), ...(p.description ? ["description"] : [])],
  async apply(_db, workspace, draft, facts) {
    const p = draft.payload;
    if (facts.currency !== p.currency) return { ok: false, code: "stale" };
    const o = await owner(workspace);
    if (!o) return { ok: false, code: "business_unavailable" };
    const r = await recordEntry(o, { kind: p.kind, amount: p.amount, entry_date: p.date, category: p.category, description: p.description, cash_settled: p.settled, client_request_id: draft.targetId });
    return outcome({ status: r.status, body: r.body }, (b) => ({ resultId: b?.entry?.id ?? null }));
  },
  reviewPath: () => "/dashboard/reports/entries",
};

// ============================================================================================================================ bk.invoice.create
export interface InvoiceDraftPayload {
  locale: "en" | "fr";
  customerName: string | null;
  /** A customer found by the SERVER in the owner's own customer book (re-checked by the Toolkit at apply). */
  customerId: string | null;
  lines: { description: string; quantity: string; unitPrice: string }[];
  dueDate: string | null;
  notes: string | null;
  currency: string;
}

export function validateInvoiceDraft(raw: unknown, ctx: DraftValidationContext): ValidationResult<InvoiceDraftPayload> {
  const r = obj(raw);
  if (!r) return { ok: false, reason: "invalid_input" };
  const currency = ctx.facts.currency;
  const rawName = get(r, "customer_name", "customerName");
  const customerName = typeof rawName === "string" && rawName.trim() ? rawName.trim() : null;
  const rawCustomerId = get(r, "customer_id", "customerId");
  const customerId = rawCustomerId === null || rawCustomerId === undefined ? null : rawCustomerId;
  if (customerId !== null && !isUuid(customerId)) return bad(["customer"]);
  if (!Array.isArray(r.lines) || r.lines.length === 0) return missing(["lines"]);
  if (r.lines.length > 20) return bad(["lines"]); // a draft the owner can review on one card (the Toolkit itself allows more once it is a real invoice)
  const locale = (DOCUMENT_LOCALES as readonly unknown[]).includes(r.locale) ? r.locale : "fr";
  const parsed = parseDraftBody(
    {
      locale, customer: customerName ? { name: customerName } : null, due_date: get(r, "due_date", "dueDate") ?? null, notes: r.notes ?? null, tax_enabled: false,
      lines: r.lines.map((l: any) => ({ description: l?.description, quantity: l?.quantity, unit_price: l?.unit_price !== undefined ? l.unit_price : l?.unitPrice })), client_request_id: null,
    },
    currency
  );
  if (!parsed.ok) return bad(Array.from(new Set(parsed.details.map((d) => (/line|quantity|unit_price|description|discount/.test(d) ? "lines" : /due/.test(d) ? "due_date" : /notes/.test(d) ? "notes" : /customer/.test(d) ? "customer" : "invoice")))));
  const v = parsed.value;
  const totals = computeDocument(v.lines.map((l) => ({ quantity: l.quantity, unitPrice: l.unit_price })), currency, null);
  if (!totals.ok || totals.totals.totalMinor <= 0) return bad(["lines"]);
  return { ok: true, payload: { locale: v.locale, customerName, customerId: customerId as string | null, lines: v.lines.map((l) => ({ description: l.description.trim(), quantity: l.quantity, unitPrice: l.unit_price })), dueDate: v.due_date, notes: v.notes, currency } };
}

export const invoiceCreateDraft: DraftDefinition<InvoiceDraftPayload> = {
  type: "bk.invoice.create",
  validate: validateInvoiceDraft,
  availability: (facts) => toolkitGate(facts),
  changes: (p) => {
    const total = computeDocument(p.lines.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice })), p.currency, null);
    return [
      { field: "bk_customer", kind: "text", before: null, after: p.customerName },
      { field: "bk_lines", kind: "longtext", before: null, after: p.lines.map((l) => `${l.quantity} x ${l.description} @ ${l.unitPrice} ${p.currency}`).join("\n") },
      ...(total.ok ? [{ field: "bk_invoice_total", kind: "price" as const, before: null, after: { amount: total.totals.totalMinor / 10 ** currencyMinorDigits(p.currency), currency: p.currency } }] : []),
      ...(p.dueDate ? [{ field: "bk_due_date", kind: "date" as const, before: null, after: p.dueDate }] : []),
      ...(p.notes ? [{ field: "bk_notes", kind: "text" as const, before: null, after: p.notes }] : []),
    ];
  },
  summary: (p) => `Invoice draft${p.customerName ? ` for ${p.customerName}` : ""}: ${p.lines.length} line${p.lines.length === 1 ? "" : "s"}`.slice(0, 160),
  fieldNames: (p) => ["lines", ...(p.customerName ? ["customer"] : []), ...(p.dueDate ? ["due_date"] : []), ...(p.notes ? ["notes"] : [])],
  async apply(_db, workspace, draft, facts) {
    const p = draft.payload;
    if (facts.currency !== p.currency) return { ok: false, code: "stale" };
    const o = await owner(workspace);
    if (!o) return { ok: false, code: "business_unavailable" };
    // the invoice is created as a DRAFT DOCUMENT (no number yet, not counted anywhere): the owner reviews and issues it in Invoices
    const r = await createDraft(o, {
      locale: p.locale, customer: p.customerName ? { name: p.customerName } : null, due_date: p.dueDate, notes: p.notes, tax_enabled: false,
      lines: p.lines.map((l) => ({ description: l.description, quantity: l.quantity, unit_price: l.unitPrice })), client_request_id: draft.targetId,
    });
    const res = outcome(r, (b) => ({ resultId: b?.document?.id ?? null }));
    if (res.ok && res.resultId && p.customerId && !res.alreadyApplied) {
      // link to the customer found by the server; a refusal (e.g. the customer was archived since) leaves the draft invoice in place
      const link = await setDocumentCustomer(o, res.resultId, { customer_id: p.customerId });
      if ("pdf" in link || link.status >= 400) console.error("ai invoice draft: customer link refused:", "pdf" in link ? "pdf" : link.status);
    }
    return res;
  },
  reviewPath: (id) => (id ? `/dashboard/documents/${id}` : "/dashboard/documents"),
};

// ============================================================================================================================ bk.invoice.payment
export interface PaymentDraftPayload {
  invoiceId: string;
  invoiceNumber: string;
  amount: string;
  method: string;
  paidOn: string;
  reference: string | null;
  currency: string;
}

export function validatePaymentDraft(raw: unknown, ctx: DraftValidationContext): ValidationResult<PaymentDraftPayload> {
  const r = obj(raw);
  if (!r) return { ok: false, reason: "invalid_input" };
  const currency = ctx.facts.currency;
  const invoiceId = get(r, "invoice_id", "invoiceId");
  if (!isUuid(invoiceId)) return missing(["invoice"]);
  const rawNumber = get(r, "invoice_number", "invoiceNumber");
  const invoiceNumber = typeof rawNumber === "string" && rawNumber.trim() && rawNumber.length <= 40 ? rawNumber.trim() : null;
  if (!invoiceNumber) return missing(["invoice"]);
  const amount = amountText(r.amount);
  if (amount === null) return missing(["amount"]);
  const p = parsePaymentBody({ amount, method: r.method, reference: r.reference ?? null, paid_on: get(r, "paid_on", "paidOn") ?? today(), client_request_id: ZERO_UUID }, currency, today());
  if (!p.ok) return bad(Array.from(new Set(p.details.map((d) => (/amount/.test(d) ? "amount" : /method/.test(d) ? "method" : /reference/.test(d) ? "reference" : /paid_on/.test(d) ? "paid_on" : "payment")))));
  return { ok: true, payload: { invoiceId: invoiceId as string, invoiceNumber, amount: p.value.amount, method: p.value.method, paidOn: p.value.paid_on, reference: p.value.reference, currency } };
}

export const invoicePaymentDraft: DraftDefinition<PaymentDraftPayload> = {
  type: "bk.invoice.payment",
  validate: validatePaymentDraft,
  availability: (facts) => toolkitGate(facts),
  changes: (p) => [
    { field: "bk_invoice", kind: "text", before: null, after: p.invoiceNumber },
    { field: "bk_amount", kind: "price", before: null, after: { amount: major(p.amount), currency: p.currency } },
    { field: "bk_method", kind: "enum", before: null, after: p.method },
    { field: "bk_paid_on", kind: "date", before: null, after: p.paidOn },
    ...(p.reference ? [{ field: "bk_reference", kind: "text" as const, before: null, after: p.reference }] : []),
  ],
  summary: (p) => `Payment ${p.amount} ${p.currency} on ${p.invoiceNumber}`.slice(0, 160),
  fieldNames: (p) => ["invoice", "amount", "method", "paid_on", ...(p.reference ? ["reference"] : [])],
  async apply(_db, workspace, draft, facts) {
    const p = draft.payload;
    if (facts.currency !== p.currency) return { ok: false, code: "stale" };
    const o = await owner(workspace);
    if (!o) return { ok: false, code: "business_unavailable" };
    // the Toolkit's own payment function: it checks the invoice belongs to this business, is payable and not over-paid, then creates the receipt and the
    // bookkeeping sale together in one transaction (this is the ONLY place an invoice payment becomes revenue, so nothing is counted twice)
    const r = await recordPayment(o, p.invoiceId, { amount: p.amount, method: p.method, reference: p.reference, paid_on: p.paidOn, client_request_id: draft.targetId });
    return outcome(r, (b) => ({ resultId: b?.receipt?.document?.id ?? b?.payment?.id ?? null }), { exceeds_balance: "amount_exceeds_balance", invoice_not_payable: "rejected_by_rules", document_void: "rejected_by_rules", document_not_found: "target_not_found" });
  },
  reviewPath: (id) => (id ? `/dashboard/documents/${id}` : "/dashboard/documents"),
};

// ============================================================================================================================ bk.customer.create
export interface CustomerDraftPayload {
  name: string;
  phone: string | null;
  email: string | null;
}

export function validateCustomerDraft(raw: unknown, ctx: DraftValidationContext): ValidationResult<CustomerDraftPayload> {
  const r = obj(raw);
  if (!r) return { ok: false, reason: "invalid_input" };
  const name = typeof r.name === "string" ? r.name.trim() : "";
  if (!name) return missing(["name"]);
  const p = parseContactBody({ name, phone: r.phone ?? null, email: r.email ?? null, notes: null, client_request_id: ZERO_UUID }, true);
  if (!p.ok) return bad(Array.from(new Set(p.details.map((d) => (/name/.test(d) ? "name" : /phone/.test(d) ? "phone" : /email/.test(d) ? "email" : "customer")))));
  // contact details only if the OWNER typed them in this conversation (the same strict provenance as every other draft)
  if (p.value.phone && !phoneFromOwner(p.value.phone.replace(/\D/g, ""), ctx.userText)) return { ok: false, reason: "contact_not_from_user", fields: ["phone"] };
  if (p.value.email && !emailFromOwner(p.value.email, ctx.userText)) return { ok: false, reason: "contact_not_from_user", fields: ["email"] };
  return { ok: true, payload: { name: p.value.name, phone: p.value.phone, email: p.value.email } };
}

export const customerCreateDraft: DraftDefinition<CustomerDraftPayload> = {
  type: "bk.customer.create",
  validate: validateCustomerDraft,
  availability: (facts) => toolkitGate(facts),
  changes: (p) => [
    { field: "bk_customer", kind: "text", before: null, after: p.name },
    ...(p.phone ? [{ field: "bk_phone", kind: "phone" as const, before: null, after: p.phone }] : []),
    ...(p.email ? [{ field: "bk_email", kind: "email" as const, before: null, after: p.email }] : []),
  ],
  summary: (p) => `New customer: ${p.name.slice(0, 80)}`,
  fieldNames: (p) => ["name", ...(p.phone ? ["phone"] : []), ...(p.email ? ["email"] : [])],
  async apply(_db, workspace, draft) {
    const p = draft.payload;
    const o = await owner(workspace);
    if (!o) return { ok: false, code: "business_unavailable" };
    // the customer book's own save: an existing active customer with the same phone or e-mail is REPORTED (never merged, never duplicated)
    const r = await saveContact(o, null, { name: p.name, phone: p.phone, email: p.email, client_request_id: draft.targetId });
    return outcome(r, (b) => ({ resultId: b?.customer?.id ?? null }), { duplicate_customer: "duplicate_customer" });
  },
  reviewPath: (id) => (id ? `/dashboard/customers/${id}` : "/dashboard/customers"),
};

// ============================================================================================================================ bk.stock.adjust
const STOCK_KINDS = [...ADJUST_KINDS, "set_count"] as const;
export interface StockDraftPayload {
  productId: string;
  productName: string;
  kind: string;
  quantity: number;
  reason: string | null;
  note: string | null;
}

export function validateStockDraft(raw: unknown): ValidationResult<StockDraftPayload> {
  const r = obj(raw);
  if (!r) return { ok: false, reason: "invalid_input" };
  const productId = get(r, "product_id", "productId");
  if (!isUuid(productId)) return missing(["product"]);
  const rawProduct = get(r, "product_name", "productName");
  const productName = typeof rawProduct === "string" && rawProduct.trim() ? rawProduct.trim().slice(0, 120) : null;
  if (!productName) return missing(["product"]);
  const kind = typeof r.kind === "string" ? r.kind : "";
  if (!(STOCK_KINDS as readonly string[]).includes(kind)) return bad(["kind"]);
  const q = r.quantity;
  const max = kind === "set_count" ? STOCK_LIMITS.maxCount : STOCK_LIMITS.maxAdjust;
  const min = kind === "set_count" ? 0 : 1;
  if (typeof q !== "number" || !Number.isInteger(q) || q < min || q > max) return bad(["quantity"]);
  const reason = r.reason == null ? null : typeof r.reason === "string" ? r.reason.trim() || null : undefined;
  const note = r.note == null ? null : typeof r.note === "string" ? r.note.trim() || null : undefined;
  if (reason === undefined || (reason && Array.from(reason).length > STOCK_LIMITS.reason)) return bad(["reason"]);
  if (note === undefined || (note && Array.from(note).length > STOCK_LIMITS.note)) return bad(["note"]);
  if (REASON_REQUIRED_KINDS.includes(kind) && !reason) return missing(["reason"]);
  return { ok: true, payload: { productId: productId as string, productName, kind, quantity: q, reason, note } };
}

export const stockAdjustDraft: DraftDefinition<StockDraftPayload> = {
  type: "bk.stock.adjust",
  validate: validateStockDraft,
  // stock tracking is enforced for Business & E-commerce profiles by the database itself; the draft is only offered where it can work
  availability: (facts) => (facts.businessToolkitAi === true && categoryHasInventory({ category: facts.category, categories: facts.categories }) ? { ok: true } : { ok: false, reason: "feature_unavailable" }),
  changes: (p) => [
    { field: "bk_product", kind: "text", before: null, after: p.productName },
    { field: "bk_stock_kind", kind: "enum", before: null, after: p.kind },
    { field: "bk_quantity", kind: "text", before: null, after: String(p.quantity) },
    ...(p.reason ? [{ field: "bk_reason", kind: "text" as const, before: null, after: p.reason }] : []),
    ...(p.note ? [{ field: "bk_notes", kind: "text" as const, before: null, after: p.note }] : []),
  ],
  summary: (p) => `Stock ${p.kind} ${p.quantity}: ${p.productName}`.slice(0, 160),
  fieldNames: (p) => ["product", "kind", "quantity", ...(p.reason ? ["reason"] : []), ...(p.note ? ["note"] : [])],
  async apply(_db, workspace, draft) {
    const p = draft.payload;
    const o = await owner(workspace);
    if (!o) return { ok: false, code: "business_unavailable" };
    // the Toolkit's own stock functions: they check the product is this business's TRACKED product and refuse a movement that would go below zero
    const r =
      p.kind === "set_count"
        ? await correctCount(o, p.productId, { target: p.quantity, reason: p.reason, note: p.note, client_request_id: draft.targetId })
        : await adjustStock(o, p.productId, { kind: p.kind, quantity: p.quantity, reason: p.reason, note: p.note, client_request_id: draft.targetId });
    return outcome(r, () => ({ resultId: p.productId }), { insufficient_stock: "rejected_by_rules", not_tracked: "rejected_by_rules", no_change: "rejected_by_rules", product_not_found: "target_not_found", category_not_enabled: "business_unavailable" });
  },
  reviewPath: (id) => (id ? `/dashboard/inventory/${id}` : "/dashboard/inventory"),
};
