// Ringo AI x Business Toolkit: finding the owner's OWN customer, invoice or product from what a person said (a name or an invoice number), so a draft can carry
// a server-resolved id. The model never supplies an id. Every lookup goes through the Toolkit's own readers with the server-resolved owner (so it can only
// ever see this business's records), returns names/numbers only for the model, and treats "several matches" as a question for the user, never a guess.
import { listCustomers } from "@/lib/customers/handlers";
import type { DocOwner } from "@/lib/documents/handlers";
import { inventoryOverview } from "@/lib/inventory/handlers";
import { receivableInvoices } from "@/lib/receivables/handlers";

export const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

export type CustomerMatch =
  | { status: "none" }
  | { status: "one"; id: string; name: string }
  | { status: "many"; matches: { name: string; archived: boolean }[]; identical: boolean }
  | { status: "error" };

/** Finds an ACTIVE customer of this business by name. An exact (accent/case-insensitive) name wins over partial matches; otherwise several matches = "many". */
export async function findCustomer(owner: DocOwner, name: string): Promise<CustomerMatch> {
  const r = await listCustomers(owner, { q: name, status: "active", limit: "8", offset: "0" });
  if (r.status !== 200 || "pdf" in r) return { status: "error" };
  const items = r.body.items as { id: string; name: string; archived: boolean }[];
  if (items.length === 0) return { status: "none" };
  if (items.length === 1) return { status: "one", id: items[0].id, name: items[0].name };
  const exact = items.filter((i) => norm(i.name) === norm(name));
  if (exact.length === 1) return { status: "one", id: exact[0].id, name: exact[0].name };
  return { status: "many", matches: items.map((i) => ({ name: i.name, archived: i.archived })), identical: exact.length > 1 };
}

export type OpenInvoice = { id: string; number: string; currency: string; dueMinor: number; customer: string | null };
export type InvoiceMatch = { status: "none" } | { status: "one"; invoice: OpenInvoice } | { status: "many"; invoices: { number: string; due: number; currency: string }[] } | { status: "error" };

/** The owner's open (issued / partly paid) invoices that can take a payment, optionally for one customer or one invoice number. Uses the receivables reader. */
export async function findOpenInvoices(owner: DocOwner, opts: { customerId?: string | null; number?: string | null }): Promise<InvoiceMatch> {
  const r = await receivableInvoices(owner, { customer: opts.customerId ?? null, limit: "100", offset: "0" });
  if (r.status !== 200 || "pdf" in r) return { status: "error" };
  const open = (r.body.items as any[])
    .filter((i) => i.can_record_payment === true && i.amount_due_minor > 0 && (i.status === "issued" || i.status === "partially_paid"))
    .map((i) => ({ id: i.id as string, number: String(i.number ?? ""), currency: String(i.currency).toUpperCase(), dueMinor: i.amount_due_minor as number, customer: (i.customer_name as string | null) ?? null }));
  const pool = opts.number ? open.filter((i) => i.number.toUpperCase() === opts.number!.trim().toUpperCase()) : open;
  if (pool.length === 0) return { status: "none" };
  if (pool.length === 1) return { status: "one", invoice: pool[0] };
  return { status: "many", invoices: pool.slice(0, 8).map((i) => ({ number: i.number, due: i.dueMinor, currency: i.currency })) };
}

export type ProductMatch =
  | { status: "none" }
  | { status: "not_tracked"; name: string }
  | { status: "one"; id: string; name: string }
  | { status: "many"; names: string[] }
  | { status: "error" };

const PAGE = 100;
const PAGES = 5;

/** Finds one TRACKED product of this business by name (the inventory reader pages through at most 500 products). */
export async function findTrackedProduct(owner: DocOwner, name: string): Promise<ProductMatch> {
  const needle = norm(name);
  const hits: { id: string; name: string; state: string }[] = [];
  let seen = 0, total = Infinity;
  for (let page = 0; page < PAGES && seen < total; page++) {
    const r = await inventoryOverview(owner, { limit: String(PAGE), offset: String(page * PAGE) });
    if (r.status !== 200 || "pdf" in r) return { status: "error" };
    total = Number(r.body.total) || 0;
    const items = r.body.items as { product_id: string; name: string; state: string }[];
    seen += items.length;
    for (const it of items) if (norm(String(it.name ?? "")).includes(needle)) hits.push({ id: it.product_id, name: String(it.name), state: it.state });
    if (items.length === 0) break;
  }
  if (hits.length === 0) return { status: "none" };
  const exact = hits.filter((h) => norm(h.name) === needle);
  const pool = exact.length === 1 ? exact : hits;
  if (pool.length > 1) return { status: "many", names: pool.slice(0, 8).map((h) => h.name) };
  const h = pool[0];
  return h.state === "untracked" || h.state === "legacy" ? { status: "not_tracked", name: h.name } : { status: "one", id: h.id, name: h.name };
}
