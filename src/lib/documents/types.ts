import type { DocumentLocale, DocumentStatus, DocumentType } from "./constants";
import type { Translations } from "@/lib/i18n/translations";

// The neutral, renderer-facing shape of a document. It is built from stored rows (seller-issued invoices and receipts) and,
// later, from existing platform order data, so ONE renderer serves both sources. Text fields hold the ORIGINAL stored
// strings: nothing here is sanitised (only the PDF renderer falls back for glyphs it cannot draw). Money is integer minor
// units of `currency`; quantities are thousandths.

export type PartyModel = {
  name: string | null; // seller: display name; customer: name
  legalName: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  taxId: string | null;
  registrationNo: string | null;
};

export type LineModel = {
  position: number;
  description: string;
  quantityMilli: number;
  unitPriceMinor: number;
  grossMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
};

/** Receipts only: the facts of the seller-recorded payment, frozen at issue. */
export type PaymentFacts = {
  method: string;
  reference: string | null;
  paidOn: string; // YYYY-MM-DD
  amountMinor: number;
  balanceAfterMinor: number;
  invoiceNumber: string;
};

export type DocumentModel = {
  docType: DocumentType;
  templateVersion: number;
  locale: DocumentLocale;
  status: DocumentStatus;
  number: string | null; // null only for an unissued draft preview
  currency: string;
  minorDigits: number;
  issueDate: string | null;
  dueDate: string | null;
  seller: PartyModel;
  customer: PartyModel;
  lines: LineModel[];
  subtotalMinor: number;
  discountMinor: number;
  taxLabel: string | null;
  taxRateBp: number | null;
  taxMinor: number;
  totalMinor: number;
  amountPaidMinor: number;
  notes: string | null;
  terms: string | null;
  payment: PaymentFacts | null;
  /** Receipts: the invoice this payment belongs to (for reference printing). */
  parent: { number: string; lines: LineModel[] } | null;
  isVoid: boolean;
  /** Business-local "today", supplied by the caller, used only to show an overdue marker. */
  todayKey?: string;
};

export type DocumentLabels = Translations["documents"]["pdf"];
