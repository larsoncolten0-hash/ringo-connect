// Builds a DocumentModel from stored rows (as returned by the database / PostgREST). Pure. Text is passed through untouched.
// A value that cannot be read exactly throws: a document whose stored numbers are unreadable must not be rendered as if
// it were fine (the caller treats this as a data-integrity problem, never as something to paper over).
import { currencyMinorDigits, parseMinor } from "@/lib/bookkeeping/money";
import { DOCUMENT_LOCALES, DOCUMENT_STATUSES, DOCUMENT_TYPES, type DocumentLocale, type DocumentStatus, type DocumentType } from "./constants";
import { parseQuantityMilli } from "./totals";
import type { BrandingModel, DocumentModel, LineModel, PartyModel, PaymentFacts, PaymentDetails } from "./types";

type Row = Record<string, any>;

function minor(value: unknown, digits: number, what: string): number {
  const m = parseMinor(value, digits);
  if (m === null) throw new Error(`document snapshot: unreadable ${what}`);
  return m;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

function party(snap: unknown, kind: "seller" | "customer"): PartyModel {
  const s = (snap && typeof snap === "object" ? snap : {}) as Row;
  return kind === "seller"
    ? { name: str(s.display_name), legalName: str(s.legal_name), address: str(s.address), phone: str(s.phone), email: str(s.email), taxId: str(s.tax_id), registrationNo: str(s.registration_no) }
    : { name: str(s.name), legalName: null, address: str(s.address), phone: str(s.phone), email: str(s.email), taxId: str(s.tax_id), registrationNo: null };
}

const HEX = /^#[0-9a-f]{6}$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The branding frozen in the seller snapshot at issue (template v2). Anything that is not exactly a hex colour / stored-logo id / known text is dropped. */
export function brandingFrom(snap: unknown): BrandingModel {
  const s = (snap && typeof snap === "object" ? snap : {}) as Row;
  const pd = s.payment_details && typeof s.payment_details === "object" ? (s.payment_details as Row) : null;
  const paymentDetails: PaymentDetails | null = pd
    ? { bankName: str(pd.bank_name), accountName: str(pd.account_name), accountNumber: str(pd.account_number), momoProvider: str(pd.momo_provider), momoNumber: str(pd.momo_number), instructions: str(pd.instructions) }
    : null;
  const hasAny = paymentDetails && Object.values(paymentDetails).some((v) => v !== null);
  return {
    accent: typeof s.accent_color === "string" && HEX.test(s.accent_color) ? s.accent_color.toLowerCase() : null,
    logoAssetId: typeof s.logo_asset_id === "string" && UUID_RE.test(s.logo_asset_id) ? s.logo_asset_id.toLowerCase() : null,
    paymentDetails: hasAny ? paymentDetails : null,
  };
}

export function lineModels(lines: Row[], digits: number): LineModel[] {
  return [...lines]
    .sort((a, b) => Number(a.position) - Number(b.position))
    .map((l) => {
      const qty = parseQuantityMilli(l.quantity);
      if (qty === null) throw new Error("document snapshot: unreadable quantity");
      return {
        position: Number(l.position),
        description: typeof l.description === "string" ? l.description : "",
        quantityMilli: qty,
        unitPriceMinor: minor(l.unit_price, digits, "unit price"),
        grossMinor: minor(l.gross_amount, digits, "line amount"),
        discountMinor: minor(l.discount_amount ?? 0, digits, "line discount"),
        taxMinor: minor(l.tax_amount ?? 0, digits, "line tax"),
        totalMinor: minor(l.line_total, digits, "line total"),
      };
    });
}

export function modelFromRows(input: { doc: Row; lines: Row[]; parent?: { doc: Row; lines: Row[] } | null; todayKey?: string }): DocumentModel {
  const d = input.doc;
  if (!(DOCUMENT_TYPES as readonly string[]).includes(d.doc_type)) throw new Error("document snapshot: unknown type");
  if (!(DOCUMENT_STATUSES as readonly string[]).includes(d.status)) throw new Error("document snapshot: unknown status");
  const locale: DocumentLocale = (DOCUMENT_LOCALES as readonly string[]).includes(d.locale) ? d.locale : "fr";
  const currency = String(d.currency || "").toUpperCase();
  const digits = currencyMinorDigits(currency);

  let payment: PaymentFacts | null = null;
  const t = d.type_snapshot as Row | null;
  if (d.doc_type === "receipt" && t && typeof t === "object") {
    payment = {
      method: typeof t.method === "string" ? t.method : "other",
      reference: str(t.reference),
      paidOn: typeof t.paid_on === "string" ? t.paid_on : "",
      amountMinor: minor(t.amount, digits, "payment amount"),
      balanceAfterMinor: minor(t.balance_after ?? 0, digits, "balance after"),
      invoiceNumber: typeof t.invoice_number === "string" ? t.invoice_number : "",
      sale: t.kind === "sale",
    };
  }

  return {
    docType: d.doc_type as DocumentType,
    templateVersion: Number(d.template_version) || 1,
    locale,
    status: d.status as DocumentStatus,
    number: str(d.number),
    currency,
    minorDigits: digits,
    issueDate: str(d.issue_date),
    dueDate: str(d.due_date),
    seller: party(d.seller_snapshot, "seller"),
    customer: party(d.customer_snapshot, "customer"),
    lines: lineModels(input.lines, digits),
    subtotalMinor: minor(d.subtotal, digits, "subtotal"),
    discountMinor: minor(d.discount_total, digits, "discount"),
    taxLabel: str(d.tax_label),
    taxRateBp: d.tax_rate_bp === null || d.tax_rate_bp === undefined ? null : Number(d.tax_rate_bp),
    taxMinor: minor(d.tax_total, digits, "tax"),
    totalMinor: minor(d.total, digits, "total"),
    amountPaidMinor: minor(d.amount_paid ?? 0, digits, "amount paid"),
    notes: str(d.notes),
    terms: str(d.terms),
    payment,
    parent: input.parent ? { number: String(input.parent.doc.number || ""), lines: lineModels(input.parent.lines, digits) } : null,
    isVoid: d.status === "void",
    branding: brandingFrom(d.seller_snapshot),
    todayKey: input.todayKey,
  };
}
