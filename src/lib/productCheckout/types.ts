// Shapes and boundaries for the product checkout lane. The core logic (createOrder, payment,
// settlement) only talks to these two interfaces, so it is unit-testable with in-memory fakes and
// never imports Supabase, Next or the Fapshi client directly. Dependency-free.

import type { CheckoutErrorCode } from "./errors";

export type OrderStatus = "awaiting_payment" | "paid" | "fulfilled" | "cancelled" | "expired" | "refunded" | "payment_review";
export type PaymentStatus = "initiated" | "pending" | "succeeded" | "failed" | "expired" | "cancelled";
export type PaymentMedium = "mobile money" | "orange money";

export interface CommerceSettings {
  commerceEnabled: boolean;
  commissionRate: number | null; // fraction, e.g. 0.05; null = not configured
  fapshiEnabled: boolean;
}

export interface ProfileRow {
  id: string;
  user_id: string;
  username: string | null;
  currency: string | null;
  published: boolean;
  is_demo: boolean;
  category: string | null;
  categories: string[] | null;
}

export interface ProductRow {
  id: string;
  profile_id: string;
  name: string | null;
  price: number | string | null;
  available: boolean | null;
  inventory_count: number | null;
}

export interface OrderRow {
  id: string;
  order_number: number;
  profile_id: string;
  customer_id: string | null;
  customer_name: string;
  customer_phone: string;
  currency: string;
  subtotal: number | string;
  total: number | string;
  status: OrderStatus;
  expires_at: string;
  paid_at: string | null;
  stock_released_at: string | null;
  created_at: string;
}

export interface OrderItemRow {
  id: string;
  order_id: string;
  product_id: string | null;
  name_snapshot: string;
  image_snapshot: string | null;
  unit_price_snapshot: number | string;
  quantity: number;
  line_total: number | string;
}

export interface PaymentRow {
  id: string;
  provider: string;
  provider_transaction_id: string | null;
  external_id: string;
  target_type: string;
  target_id: string;
  profile_id: string;
  customer_id: string | null;
  amount: number | string;
  currency: string;
  payer_medium: PaymentMedium | null;
  status: PaymentStatus;
  provider_status: string | null;
  failure_reason: string | null;
  expires_at: string;
  confirmed_at: string | null;
  created_at: string;
}

export interface EarningRow {
  id?: string;
  order_id: string;
  payment_id: string;
  profile_id: string;
  creator_user_id: string;
  gross_amount: number;
  commission_rate: number;
  platform_fee: number;
  net_amount: number;
  currency: string;
  status?: string;
}

export interface CreateOrderArgs {
  profileId: string;
  productId: string;
  quantity: number;
  customerId: string | null;
  name: string;
  phone: string;
  email: string | null;
  note: string | null;
  reservationMinutes: number;
}

/** Persistence boundary. Every mutation is conditional so callers can claim state exactly once. */
export interface CheckoutStore {
  getSettings(): Promise<CommerceSettings>;
  getProduct(id: string): Promise<ProductRow | null>;
  getProfile(id: string): Promise<ProfileRow | null>;
  /** Wraps create_product_order(): the database is authoritative for stock, price and the order rows. */
  createOrder(args: CreateOrderArgs): Promise<{ ok: true; order: OrderRow; item: OrderItemRow } | { ok: false; code: CheckoutErrorCode }>;
  getOrder(id: string): Promise<{ order: OrderRow; items: OrderItemRow[] } | null>;
  /** Only applies while the order is still in `expectStatus`. Returns whether a row changed. */
  updateOrder(id: string, patch: Partial<Pick<OrderRow, "status" | "paid_at" | "expires_at">>, expectStatus: OrderStatus): Promise<boolean>;
  /** release_product_order_stock(): exactly-once stock release for an existing order. */
  releaseOrder(id: string, status: "expired" | "cancelled"): Promise<boolean>;
  /** Newest first. */
  listPayments(orderId: string): Promise<PaymentRow[]>;
  getPayment(id: string): Promise<PaymentRow | null>;
  insertPayment(row: PaymentRow): Promise<{ ok: true } | { ok: false; reason: "duplicate_live" }>;
  /** Only applies while the payment is in one of `expectStatuses`. Returns whether a row changed. */
  updatePayment(
    id: string,
    patch: Partial<Pick<PaymentRow, "status" | "provider_transaction_id" | "provider_status" | "failure_reason" | "confirmed_at">>,
    expectStatuses: PaymentStatus[]
  ): Promise<boolean>;
  getEarningByOrder(orderId: string): Promise<EarningRow | null>;
  /** 'exists' when the unique (order / payment) constraint already holds an earning. */
  insertEarning(row: EarningRow): Promise<"inserted" | "exists">;
}

export type ProviderStatus = "CREATED" | "SUCCESSFUL" | "FAILED" | "EXPIRED";

export interface PaymentProvider {
  directPay(params: { amount: number; phone: string; medium: PaymentMedium; userId: string; externalId: string; message?: string }): Promise<{ transId: string }>;
  getStatus(transId: string): Promise<{ status: ProviderStatus; amount: number | null; reason?: string | null }>;
}

export interface CheckoutDeps {
  store: CheckoutStore;
  provider: PaymentProvider;
  now: () => Date;
  newId: () => string;
  /** Called exactly once, by the caller that flips the order to paid. Best effort — never blocks settlement. */
  onOrderPaid?: (info: { order: OrderRow; profile: ProfileRow | null; gross: number }) => Promise<void>;
  /** Server-side diagnostics only. Must never include phone numbers, emails or provider secrets. */
  log: (event: string, data?: Record<string, unknown>) => void;
}
