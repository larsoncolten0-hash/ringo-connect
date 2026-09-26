// Shapes and boundaries for Ringo Protection's checkout/payment lane (Phase 4). Same discipline as
// productCheckout/types.ts: the core logic only talks to these two interfaces, so it is
// unit-testable with in-memory fakes and never imports Supabase or Next directly. Dependency-free.

import type { ProtectionActor, ProtectionStatus } from "./types";
import type { ProtectionRateKind, ProtectionRateLimiter } from "./checkoutRateLimit";
import type { ProtectionCheckoutErrorCode } from "./checkoutErrors";

export type PaymentMedium = "mobile money" | "orange money";
export type ProtectionPaymentStatus = "initiated" | "pending" | "succeeded" | "failed" | "expired" | "cancelled";

export interface ProtectionSettingsView {
  protectionEnabled: boolean;
  protectionFeeRate: number | null;
  protectionAutoReleaseHours: number;
}

/** The subset of an EXISTING product_orders row this lane needs. Never written by this lane except
 *  status (awaiting_payment -> paid, the same already-legal transition settlement.ts uses) and
 *  expires_at (extending the reservation, the same field initiateProductPayment already extends). */
export interface ProtectionOrderRow {
  id: string;
  profile_id: string;
  customer_id: string | null;
  currency: string;
  total: number | string;
  status: "awaiting_payment" | "paid" | "fulfilled" | "cancelled" | "expired" | "refunded" | "payment_review";
  expires_at: string;
  paid_at: string | null;
  /** Digital Products V1 — true when this order's item carries a digital file snapshot. Ringo
   *  Protection is Normal-Payment-only for digital products (see checkProtectionEligibility). */
  isDigital?: boolean;
}

export interface ProtectionProfileRow {
  id: string;
  user_id: string;
  username: string | null;
  currency: string | null;
  published: boolean;
  is_demo: boolean;
  category: string | null;
  categories: string[] | null;
}

export interface ProtectionTransactionRow {
  id: string;
  target_id: string; // the product_orders.id
  status: ProtectionStatus;
  profile_id: string;
  creator_user_id: string;
  customer_id: string | null;
  currency: string;
  product_amount: number | string;
  protection_fee_rate: number | string;
  protection_fee_amount: number | string;
  customer_total: number | string;
  seller_protected_amount: number | string;
}

export interface ProtectionPaymentRow {
  id: string;
  protection_transaction_id: string;
  provider: string;
  provider_transaction_id: string | null;
  external_id: string;
  profile_id: string;
  customer_id: string | null;
  amount: number | string;
  currency: string;
  payer_medium: PaymentMedium | null;
  status: ProtectionPaymentStatus;
  provider_status: string | null;
  failure_reason: string | null;
  expires_at: string;
  confirmed_at: string | null;
  created_at: string;
}

export type ProviderStatus = "CREATED" | "SUCCESSFUL" | "FAILED" | "EXPIRED";

export interface ProtectionPaymentProvider {
  directPay(params: { amount: number; phone: string; medium: PaymentMedium; userId: string; externalId: string; message?: string }): Promise<{ transId: string }>;
  getStatus(transId: string): Promise<{ status: ProviderStatus; amount: number | null; reason?: string | null }>;
}

/** Persistence boundary. Every mutation is conditional so callers can claim state exactly once. */
export interface ProtectionCheckoutStore {
  getProtectionSettings(): Promise<ProtectionSettingsView>;
  getCommerceSettings(): Promise<{ commerceEnabled: boolean; fapshiEnabled: boolean }>;
  /** Reads the underlying product_orders row (owned by Normal Payment's own schema, read-only here). */
  getOrder(orderId: string): Promise<ProtectionOrderRow | null>;
  getProfile(profileId: string): Promise<ProtectionProfileRow | null>;
  /** Only applies while the order is still in `expectStatus`. Mirrors CheckoutStore.updateOrder exactly. */
  updateOrder(id: string, patch: Partial<Pick<ProtectionOrderRow, "status" | "expires_at" | "paid_at">>, expectStatus: ProtectionOrderRow["status"]): Promise<boolean>;
  /** release_product_order_stock() — the SAME existing RPC Normal Payment uses, unmodified. */
  releaseOrder(id: string, status: "expired" | "cancelled"): Promise<boolean>;

  getProtectionTransactionByOrder(orderId: string): Promise<ProtectionTransactionRow | null>;
  getProtectionTransaction(id: string): Promise<ProtectionTransactionRow | null>;
  /** Insert; 'exists' on the (target_type,target_id) unique violation — the caller re-reads via getProtectionTransactionByOrder. */
  insertProtectionTransaction(row: {
    targetId: string;
    profileId: string;
    creatorUserId: string;
    customerId: string | null;
    currency: string;
    productAmount: number;
    protectionFeeRate: number;
    protectionFeeAmount: number;
    customerTotal: number;
  }): Promise<{ ok: true; row: ProtectionTransactionRow } | { ok: false; code: "exists" }>;

  listProtectionPayments(protectionTransactionId: string): Promise<ProtectionPaymentRow[]>;
  getProtectionPayment(id: string): Promise<ProtectionPaymentRow | null>;
  insertProtectionPayment(row: ProtectionPaymentRow): Promise<{ ok: true } | { ok: false; reason: "duplicate_live" }>;
  updateProtectionPayment(
    id: string,
    patch: Partial<Pick<ProtectionPaymentRow, "status" | "provider_transaction_id" | "provider_status" | "failure_reason" | "confirmed_at">>,
    expectStatuses: ProtectionPaymentStatus[]
  ): Promise<boolean>;

  /** Orders the reconciliation sweep should look at — mirrors CheckoutStore.listReconcilableOrderIds. */
  listReconcilableProtectionTransactionIds(args: { sinceIso: string; limit: number }): Promise<string[]>;
}

export interface ProtectionCheckoutDeps {
  store: ProtectionCheckoutStore;
  provider: ProtectionPaymentProvider;
  now: () => Date;
  newId: () => string;
  /** Runs the ALREADY-BUILT, unmodified Phase 2 engine transition (transitionProtectionTransaction).
   *  Injected so this file never imports Supabase — engine.ts itself takes a loosely-typed admin
   *  client. Return shape mirrors TransitionOutcome exactly. */
  transition: (
    id: string,
    to: ProtectionStatus,
    actor: ProtectionActor,
    opts?: { autoReleaseHours?: number }
  ) => Promise<{ ok: true; status: ProtectionStatus; alreadyInStatus: boolean } | { ok: false; code: string; status: ProtectionStatus | null }>;
  /** Called exactly once, by the caller that flips the transaction to `protected`. Best effort. */
  onProtected?: (info: { orderId: string; protectionTransactionId: string }) => Promise<void>;
  pollGate?: { tryAcquire(transactionId: string, nowMs: number): boolean };
  limiter?: ProtectionRateLimiter;
  log: (event: string, data?: Record<string, unknown>) => void;
}

/** Canonical customer-facing view of a protection_transactions row, shared by createTransaction.ts
 *  and checkPayment.ts so the client-side controller sees one consistent shape throughout the flow. */
export interface ProtectionTransactionView {
  id: string;
  orderId: string;
  status: ProtectionStatus;
  currency: string;
  productAmount: number;
  protectionFeeRate: number;
  protectionFeeAmount: number;
  customerTotal: number;
  /** the underlying order's reservation clock, only meaningful while still awaiting_payment */
  expiresAt: string | null;
}

export function toProtectionTransactionView(row: ProtectionTransactionRow, expiresAt: string | null = null): ProtectionTransactionView {
  return {
    id: row.id,
    orderId: row.target_id,
    status: row.status,
    currency: row.currency,
    productAmount: Number(row.product_amount),
    protectionFeeRate: Number(row.protection_fee_rate),
    protectionFeeAmount: Number(row.protection_fee_amount),
    customerTotal: Number(row.customer_total),
    expiresAt,
  };
}

export type { ProtectionRateKind, ProtectionCheckoutErrorCode };
