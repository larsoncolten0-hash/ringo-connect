// Business Toolkit Phase 2 — Invoices & Professional Receipts. Shared constants.
// See docs/business-toolkit-phase2-invoices-receipts.md (the canonical design).
import { DEFAULT_TIME_ZONE } from "@/lib/bookkeeping/summary";

/** Implemented document types. A quotation type is deliberately NOT here: it is not built in Phase 2. */
export const DOCUMENT_TYPES = ["invoice", "receipt"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** Seller-issued invoices and seller-recorded payment receipts. Distinct from the platform's `RCP-` shop receipts. */
export const NUMBER_PREFIX: Record<DocumentType, string> = { invoice: "INV", receipt: "RCT" };

export const DOCUMENT_STATUSES = ["draft", "issued", "partially_paid", "paid", "void"] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const DOCUMENT_LOCALES = ["en", "fr"] as const;
export type DocumentLocale = (typeof DOCUMENT_LOCALES)[number];

export const PAYMENT_METHODS = ["cash", "mobile_money", "bank_transfer", "card", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Layout version stamped on a document at issue. Old versions must stay renderable so a re-download looks the same. */
export const TEMPLATE_VERSION = 1;

/** Numbering years and "today" are business-local (same zone as bookkeeping). */
export const DOCUMENT_TIME_ZONE = DEFAULT_TIME_ZONE;

/** Field limits — mirror the database CHECKs. The database stores text exactly as given (UTF-8); only the PDF renderer falls back. */
export const LIMITS = {
  maxLines: 100,
  description: 300,
  customerName: 120,
  customerPhone: 40,
  customerEmail: 200,
  customerAddress: 300,
  customerTaxId: 60,
  notes: 1000,
  terms: 1000,
  paymentReference: 100,
  voidReason: 300,
  displayName: 120,
  legalName: 160,
  address: 300,
  phone: 40,
  email: 200,
  taxId: 60,
  registrationNo: 60,
  taxLabel: 30,
  maxQuantityDecimals: 3,
  maxShareDays: 90,
  defaultShareDays: 14,
  maxActiveShares: 5,
} as const;
