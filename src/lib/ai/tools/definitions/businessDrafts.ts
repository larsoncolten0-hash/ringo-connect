import { categoryHasInventory } from "@/lib/bookkeeping/decision";
import { ENTRY_KINDS } from "@/lib/bookkeeping/summary";
import { currencyMinorDigits } from "@/lib/bookkeeping/money";
import { PAYMENT_METHODS } from "@/lib/documents/constants";
import { ADJUST_KINDS } from "@/lib/inventory/constants";
import { requireBusinessAi } from "@/lib/ai/business/gate";
import { findCustomer, findOpenInvoices, findTrackedProduct } from "@/lib/ai/business/lookup";
import type { AiTool, AiToolContext } from "../types";
import { prepareDraft, refuse } from "./drafts";

// Ringo AI x Business Toolkit, Phase B/C: the tools that PREPARE a Business Toolkit action. They are "draft" tools exactly like the existing ones: they
// create a review card (an ai_drafts row) and NOTHING else. The owner's own click on Confirm & Apply is the only thing that applies it (the existing
// POST /api/ai/drafts/[id]/apply), and that calls the Toolkit's own server functions again behind the Toolkit gate. A typed "yes" never applies anything.
//
// The model supplies WORDS (a customer's name, an invoice number, a product name, amounts and dates); it never supplies an id of any kind except a draft id
// from this conversation. Names are resolved HERE, on the server, inside the owner's own records: no match is reported, several matches are returned as a
// question (never a guess), and one match gives the draft a server-resolved id that the Toolkit function re-verifies when the draft is applied.

const nullable = (schema: Record<string, unknown>, description: string) => ({ anyOf: [schema, { type: "null" }], description });
const draftIdParam = nullable({ type: "string", format: "uuid" }, "To REVISE a draft you prepared earlier in this conversation, its draft_id; otherwise null to prepare a new one.");
const pick = (raw: unknown, keys: string[]): Record<string, unknown> | null => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  return Object.fromEntries(keys.map((k) => [k, r[k]]));
};

async function gate(ctx: AiToolContext) {
  const g = await requireBusinessAi(ctx);
  return g.ok ? { ok: true as const, owner: g.owner } : { ok: false as const, result: g.refusal };
}

// ------------------------------------------------------------------------------------------------------------------------------ prepare_bookkeeping_entry
export const prepareBookkeepingEntry: AiTool<Record<string, unknown>> = {
  name: "prepare_bookkeeping_entry",
  description:
    "Prepare a DRAFT bookkeeping entry for the owner's Business Toolkit: a sale, other income, an expense, cash in or cash out. Nothing is recorded until the owner clicks Confirm & Apply on the card; a typed 'yes' does nothing. The amount is in the business currency (never convert). The date defaults to today (Africa/Douala) and cannot be in the future. Online Shop orders and invoice payments are counted automatically and are NEVER recorded here: for a payment on an invoice use prepare_invoice_payment. Use null for anything the owner did not say; ask for the amount or the type if missing.",
  kind: "draft",
  permission: "settings.manage",
  available: (s) => s.businessToolkitAi,
  inputSchema: {
    type: "object",
    properties: {
      draft_id: draftIdParam,
      kind: { type: "string", enum: [...ENTRY_KINDS], description: "sale (a sale made outside the Shop and outside an invoice), other_income, expense, cash_in (money that is not income), cash_out (money that is not an expense)." },
      amount: { type: "number", description: "The amount in the business currency, greater than zero." },
      date: nullable({ type: "string" }, "YYYY-MM-DD, or null for today. Not in the future."),
      category: nullable({ type: "string" }, "Optional category, 1-60 characters (e.g. rent, transport, salaries, supplies, utilities, marketing, stock_purchase). Not for cash in/out."),
      description: nullable({ type: "string" }, "Optional short description (max 500 characters)."),
      settled: nullable({ type: "boolean" }, "true = the money was already received/paid; false = recorded but not yet received/paid; null = already received/paid."),
    },
    required: ["draft_id", "kind", "amount", "date", "category", "description", "settled"],
    additionalProperties: false,
  },
  parseInput: (raw) => pick(raw, ["draft_id", "kind", "amount", "date", "category", "description", "settled"]),
  async run(ctx, input) {
    const g = await gate(ctx);
    if (!g.ok) return g.result;
    return prepareDraft(ctx, "bk.entry.create", input);
  },
};

// ------------------------------------------------------------------------------------------------------------------------------ prepare_invoice
export const prepareInvoice: AiTool<Record<string, unknown>> = {
  name: "prepare_invoice",
  description:
    "Prepare a DRAFT invoice for the owner's Business Toolkit. Confirming creates a DRAFT invoice document (no invoice number yet, nothing issued or sent, not counted as revenue); the owner opens it in Invoices to review and issue it. Give the client's name as the owner said it (it is looked up in the owner's own customer book; if several customers match you get the names back and must ask which one). Each line has a description, a quantity and a unit price in the business currency. An invoice is never revenue until a payment is recorded on it.",
  kind: "draft",
  permission: "settings.manage",
  available: (s) => s.businessToolkitAi,
  inputSchema: {
    type: "object",
    properties: {
      draft_id: draftIdParam,
      client_name: nullable({ type: "string" }, "The client's name as the owner said it, or null for an invoice without a named client."),
      lines: {
        type: "array",
        description: "1 to 20 invoice lines.",
        items: {
          type: "object",
          properties: { description: { type: "string" }, quantity: { type: "number" }, unit_price: { type: "number" } },
          required: ["description", "quantity", "unit_price"],
          additionalProperties: false,
        },
      },
      due_date: nullable({ type: "string" }, "YYYY-MM-DD payment due date, or null."),
      notes: nullable({ type: "string" }, "Optional note printed on the invoice."),
    },
    required: ["draft_id", "client_name", "lines", "due_date", "notes"],
    additionalProperties: false,
  },
  parseInput: (raw) => pick(raw, ["draft_id", "client_name", "lines", "due_date", "notes"]),
  async run(ctx, input) {
    const g = await gate(ctx);
    if (!g.ok) return g.result;
    const name = typeof input.client_name === "string" && input.client_name.trim() ? input.client_name.trim() : null;
    let customerId: string | null = null;
    let customerName: string | null = name;
    if (name) {
      const m = await findCustomer(g.owner, name);
      if (m.status === "error") return refuse("facts_unavailable");
      if (m.status === "many") return refuse("ambiguous_target", undefined, { matches: m.matches, identical_names: m.identical });
      if (m.status === "one") { customerId = m.id; customerName = m.name; }
    }
    const lines = Array.isArray(input.lines) ? input.lines.map((l: any) => ({ description: l?.description, quantity: l?.quantity, unit_price: l?.unit_price })) : input.lines;
    return prepareDraft(ctx, "bk.invoice.create", { draft_id: input.draft_id, customer_name: customerName, customer_id: customerId, lines, due_date: input.due_date, notes: input.notes, locale: ctx.locale });
  },
};

// ------------------------------------------------------------------------------------------------------------------------------ prepare_invoice_payment
export const prepareInvoicePayment: AiTool<Record<string, unknown>> = {
  name: "prepare_invoice_payment",
  description:
    "Prepare a DRAFT payment on one of the owner's OPEN invoices. Confirming records the payment, creates its receipt automatically (the existing receipt, never a second one) and counts it as revenue once. Identify the invoice by its number, or by the client's name when that client has exactly one open invoice (several open invoices are returned as a question: ask which). The amount may not exceed what is still owed. Never use this for a payment that is not on an invoice: use prepare_bookkeeping_entry for that.",
  kind: "draft",
  permission: "settings.manage",
  available: (s) => s.businessToolkitAi,
  inputSchema: {
    type: "object",
    properties: {
      draft_id: draftIdParam,
      invoice_number: nullable({ type: "string" }, "The invoice number as the owner said it (e.g. INV-2026-0003), or null."),
      client_name: nullable({ type: "string" }, "The client's name when no invoice number was given, or null."),
      amount: { type: "number", description: "The amount received, in the business currency." },
      method: { type: "string", enum: [...PAYMENT_METHODS], description: "How it was paid." },
      paid_on: nullable({ type: "string" }, "YYYY-MM-DD, or null for today. Not in the future."),
      reference: nullable({ type: "string" }, "Optional payment reference, as the owner typed it."),
    },
    required: ["draft_id", "invoice_number", "client_name", "amount", "method", "paid_on", "reference"],
    additionalProperties: false,
  },
  parseInput: (raw) => pick(raw, ["draft_id", "invoice_number", "client_name", "amount", "method", "paid_on", "reference"]),
  async run(ctx, input) {
    const g = await gate(ctx);
    if (!g.ok) return g.result;
    const number = typeof input.invoice_number === "string" && input.invoice_number.trim() ? input.invoice_number.trim() : null;
    const name = typeof input.client_name === "string" && input.client_name.trim() ? input.client_name.trim() : null;
    if (!number && !name) return refuse("missing_fields", ["invoice"]);
    let customerId: string | null = null;
    if (!number && name) {
      const m = await findCustomer(g.owner, name);
      if (m.status === "error") return refuse("facts_unavailable");
      if (m.status === "none") return refuse("target_not_found", ["client"]);
      if (m.status === "many") return refuse("ambiguous_target", ["client"], { matches: m.matches, identical_names: m.identical });
      customerId = m.id;
    }
    const f = await findOpenInvoices(g.owner, { customerId, number });
    if (f.status === "error") return refuse("facts_unavailable");
    if (f.status === "none") return refuse("target_not_found", ["invoice"]);
    if (f.status === "many") return refuse("ambiguous_target", ["invoice"], { open_invoices: f.invoices.map((i) => ({ invoice: i.number, amount_due: i.due / 10 ** currencyMinorDigits(i.currency), currency: i.currency })) });
    const inv = f.invoice;
    // early, friendly check against what is still owed (the Toolkit re-checks it when the draft is applied)
    const amount = typeof input.amount === "number" ? input.amount : NaN;
    if (Number.isFinite(amount) && Math.round(amount * 10 ** currencyMinorDigits(inv.currency)) > inv.dueMinor) {
      return refuse("amount_exceeds_balance", ["amount"], { invoice: inv.number, amount_due: inv.dueMinor / 10 ** currencyMinorDigits(inv.currency), currency: inv.currency });
    }
    return prepareDraft(ctx, "bk.invoice.payment", { draft_id: input.draft_id, invoice_id: inv.id, invoice_number: inv.number, amount: input.amount, method: input.method, paid_on: input.paid_on, reference: input.reference });
  },
};

// ------------------------------------------------------------------------------------------------------------------------------ prepare_customer
export const prepareCustomer: AiTool<Record<string, unknown>> = {
  name: "prepare_customer",
  description:
    "Prepare a DRAFT new entry in the owner's OWN customer book (their contacts for invoices and statements; not a Ringo account). Confirming adds the customer. A phone number or e-mail may only be used if the owner typed it in this conversation; never guess or complete one. If a customer with the same phone or e-mail already exists it is reported and nothing is added. Use null for details the owner did not give.",
  kind: "draft",
  permission: "settings.manage",
  available: (s) => s.businessToolkitAi,
  inputSchema: {
    type: "object",
    properties: {
      draft_id: draftIdParam,
      name: { type: "string", description: "The customer's name as the owner said it (max 120 characters)." },
      phone: nullable({ type: "string" }, "Phone exactly as the owner typed it, or null."),
      email: nullable({ type: "string" }, "E-mail exactly as the owner typed it, or null."),
    },
    required: ["draft_id", "name", "phone", "email"],
    additionalProperties: false,
  },
  parseInput: (raw) => pick(raw, ["draft_id", "name", "phone", "email"]),
  async run(ctx, input) {
    const g = await gate(ctx);
    if (!g.ok) return g.result;
    return prepareDraft(ctx, "bk.customer.create", input);
  },
};

// ------------------------------------------------------------------------------------------------------------------------------ prepare_stock_adjustment
const STOCK_KINDS = [...ADJUST_KINDS, "set_count"] as const;
export const prepareStockAdjustment: AiTool<Record<string, unknown>> = {
  name: "prepare_stock_adjustment",
  description:
    "Prepare a DRAFT stock movement for a product whose stock the owner TRACKS in Inventory: stock_in (goods received), increase, decrease, damaged, lost, sold_elsewhere, or set_count (a stocktake: set the count to a number). Increase, decrease and sold_elsewhere need a reason. Nothing changes until the owner clicks Confirm & Apply; a movement that would take the stock below zero is refused. Give the product's name as the owner said it (looked up among the owner's own tracked products; several matches are returned as a question).",
  kind: "draft",
  permission: "settings.manage",
  available: (s) => s.businessToolkitAi && categoryHasInventory({ category: s.profile.category, categories: s.profile.categories }),
  inputSchema: {
    type: "object",
    properties: {
      draft_id: draftIdParam,
      product_name: { type: "string", description: "The product's name as the owner said it." },
      kind: { type: "string", enum: [...STOCK_KINDS], description: "The movement." },
      quantity: { type: "number", description: "A whole number of units (for set_count: the new count, which may be 0)." },
      reason: nullable({ type: "string" }, "A short reason (required for increase, decrease and sold_elsewhere)."),
      note: nullable({ type: "string" }, "Optional note."),
    },
    required: ["draft_id", "product_name", "kind", "quantity", "reason", "note"],
    additionalProperties: false,
  },
  parseInput: (raw) => pick(raw, ["draft_id", "product_name", "kind", "quantity", "reason", "note"]),
  async run(ctx, input) {
    const g = await gate(ctx);
    if (!g.ok) return g.result;
    const name = typeof input.product_name === "string" ? input.product_name.trim() : "";
    if (!name) return refuse("missing_fields", ["product"]);
    const m = await findTrackedProduct(g.owner, name);
    if (m.status === "error") return refuse("facts_unavailable");
    if (m.status === "none") return refuse("target_not_found", ["product"]);
    if (m.status === "many") return refuse("ambiguous_target", ["product"], { matches: m.names });
    if (m.status === "not_tracked") return refuse("not_tracked", ["product"], { product: m.name });
    return prepareDraft(ctx, "bk.stock.adjust", { draft_id: input.draft_id, product_id: m.id, product_name: m.name, kind: input.kind, quantity: input.quantity, reason: input.reason, note: input.note });
  },
};

export const BUSINESS_DRAFT_TOOLS = [prepareBookkeepingEntry, prepareInvoice, prepareInvoicePayment, prepareCustomer, prepareStockAdjustment] as const;
