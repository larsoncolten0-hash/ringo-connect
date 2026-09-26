// Seller-facing read model for product orders (Increment 5A). Pure and dependency-free: it turns raw
// rows (read through the seller's own RLS-scoped client) into the view data the dashboard shows, and
// never touches Supabase itself - the data access lives behind SellerReader. Nothing is recalculated:
// commission, fee and net always come from the immutable commerce_sale_earnings record, never from a
// product's current price or the current commission rate. Reusable by other surfaces (e.g. Ringo AI).

import { centsToAmount, toCents } from "./money";
import { formatProductOrderNumber } from "./format";
import type { EarningRow, OrderItemRow, OrderRow, OrderStatus } from "./types";

export const SHOP_PAGE_SIZE = 20;
export const MAX_PAGE = 500;

// ---------------------------------------------------------------- statuses shown to a seller
export type PaymentState = "paid" | "awaiting" | "expired" | "cancelled" | "review" | "refunded";
export type FulfillmentState = "to_fulfill" | "fulfilled" | "none";

export function paymentStateOf(status: OrderStatus): PaymentState {
  switch (status) {
    case "paid":
    case "fulfilled":
      return "paid";
    case "awaiting_payment":
      return "awaiting";
    case "expired":
      return "expired";
    case "cancelled":
      return "cancelled";
    case "payment_review":
      return "review";
    default:
      return "refunded";
  }
}

/** Only a paid order is waiting to be fulfilled; a fulfilled one is done; everything else has no fulfillment. */
export function fulfillmentStateOf(status: OrderStatus): FulfillmentState {
  if (status === "paid") return "to_fulfill";
  if (status === "fulfilled") return "fulfilled";
  return "none";
}

/** The ONLY status a seller may fulfil from. The database trigger is the final authority. */
export const canFulfil = (status: OrderStatus): boolean => status === "paid";

export type OrderGroup = "sales" | "to_fulfill" | "unpaid";
export const ORDER_GROUPS: readonly OrderGroup[] = ["sales", "to_fulfill", "unpaid"];

const GROUP_STATUSES: Record<OrderGroup, OrderStatus[]> = {
  sales: ["paid", "fulfilled", "payment_review", "refunded"],
  to_fulfill: ["paid"],
  unpaid: ["awaiting_payment", "expired", "cancelled"],
};
export const statusesForGroup = (group: OrderGroup): OrderStatus[] => GROUP_STATUSES[group];

export function parseGroup(value: unknown): OrderGroup {
  return typeof value === "string" && (ORDER_GROUPS as readonly string[]).includes(value) ? (value as OrderGroup) : "sales";
}

export function parsePage(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  if (!Number.isInteger(n) || n < 1) return 1;
  return Math.min(n, MAX_PAGE);
}

// ---------------------------------------------------------------- raw rows
/** An order row as read by the seller: OrderRow plus the columns the table also has. */
export type SellerOrderRecord = OrderRow & { customer_email?: string | null; customer_note?: string | null; updated_at?: string | null };
export interface SellerOrderRow {
  order: SellerOrderRecord;
  items: OrderItemRow[];
}
/** An earning record as stored (immutable amounts; only `status` can ever change). */
export type EarningRecord = EarningRow & { id: string; status: string; created_at: string };
export interface EarningListRow extends EarningRecord {
  order_number: number | null;
}
/** The minimum of the payment ledger a seller may see. No provider ids, no raw provider status. */
export interface PaymentSummary {
  status: string;
  method: "mobile money" | "orange money" | null;
  confirmed_at: string | null;
  reference: string;
}

/** Ringo Protection — Phase 5: the minimum a seller may see about their order's Protection status.
 *  `null` for a Normal Payment order (no protection_transactions row exists for it). */
export interface SellerProtectionSummary {
  status: string;
  protectedAmount: number;
  feeAmount: number;
}

export interface SellerReader {
  listOrders(a: { profileId: string; statuses: OrderStatus[]; offset: number; limit: number }): Promise<{ rows: SellerOrderRow[]; total: number }>;
  /** Scoped to the seller's profile AND read under RLS: another seller's order is simply not found. */
  getOrder(a: { profileId: string; orderId: string }): Promise<SellerOrderRow | null>;
  getEarningForOrder(a: { profileId: string; orderId: string }): Promise<EarningRecord | null>;
  listEarnings(a: { profileId: string; offset: number; limit: number }): Promise<{ rows: EarningListRow[]; total: number }>;
  /** Every earning record of the profile (amounts and status only), for totals. */
  listEarningAmounts(profileId: string): Promise<Pick<EarningRecord, "gross_amount" | "platform_fee" | "net_amount" | "status" | "currency">[]>;
  /** Service-role read of the ledger. ONLY called after getOrder proved ownership of the order. */
  getPaymentSummary(orderId: string): Promise<PaymentSummary | null>;
  countByStatuses(a: { profileId: string; statuses: OrderStatus[] }): Promise<number>;
  /** Optional (Ringo Protection, Phase 5): reads protection_transactions under the seller's own RLS
   *  "owner read" policy (Phase 1). Optional so a reader that predates Protection stays valid —
   *  getSellerOrderDetail() only calls this when present, and treats its absence as "no Protection
   *  info", never as an error. ONLY called after getOrder proved ownership of the order. */
  getProtectionSummaryForOrder?(a: { profileId: string; orderId: string }): Promise<SellerProtectionSummary | null>;
}

// ---------------------------------------------------------------- view models
export interface SellerOrderListItem {
  id: string;
  reference: string;
  status: OrderStatus;
  payment: PaymentState;
  fulfillment: FulfillmentState;
  product: string;
  extraItems: number; // further line items beyond the first (0 for V1's single-item orders)
  quantity: number;
  currency: string;
  gross: number;
  customerName: string;
  customerPhone: string;
  createdAt: string;
  paidAt: string | null;
}

export interface SellerOrderPage {
  group: OrderGroup;
  items: SellerOrderListItem[];
  page: number;
  pageSize: number;
  pageCount: number;
  total: number;
  toFulfillCount: number;
}

export interface SellerLine {
  name: string;
  image: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface SellerEarningView {
  gross: number;
  commissionRatePct: number;
  commission: number;
  net: number;
  currency: string;
  status: string;
  reversed: boolean;
}

export interface SellerOrderDetail {
  id: string;
  reference: string;
  status: OrderStatus;
  payment: PaymentState;
  fulfillment: FulfillmentState;
  canFulfil: boolean;
  currency: string;
  subtotal: number;
  total: number;
  lines: SellerLine[];
  customer: { name: string; phone: string; email: string | null; note: string | null };
  paymentInfo: { method: "mobile money" | "orange money" | null; reference: string; confirmedAt: string | null } | null;
  earning: SellerEarningView | null;
  timestamps: { createdAt: string; paidAt: string | null; fulfilledAt: string | null; expiresAt: string };
  protection: SellerProtectionSummary | null;
}

const num = (v: unknown): number => {
  const c = toCents(v);
  return c === null ? 0 : centsToAmount(c);
};

export function toListItem(row: SellerOrderRow): SellerOrderListItem {
  const { order, items } = row;
  const first = items[0];
  return {
    id: order.id,
    reference: formatProductOrderNumber(order.order_number),
    status: order.status,
    payment: paymentStateOf(order.status),
    fulfillment: fulfillmentStateOf(order.status),
    product: first?.name_snapshot ?? "",
    extraItems: Math.max(0, items.length - 1),
    quantity: items.reduce((s, i) => s + i.quantity, 0),
    currency: order.currency,
    gross: num(order.total),
    customerName: order.customer_name,
    customerPhone: order.customer_phone,
    createdAt: order.created_at,
    paidAt: order.paid_at,
  };
}

export async function listSellerOrders(reader: SellerReader, a: { profileId: string; group: unknown; page: unknown; pageSize?: number }): Promise<SellerOrderPage> {
  const group = parseGroup(a.group);
  const pageSize = Math.max(1, Math.min(a.pageSize ?? SHOP_PAGE_SIZE, 100));
  const requested = parsePage(a.page);
  const statuses = statusesForGroup(group);
  let { rows, total } = await reader.listOrders({ profileId: a.profileId, statuses, offset: (requested - 1) * pageSize, limit: pageSize });
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  let page = requested;
  if (requested > pageCount) {
    // A stale link past the last page: show the last page instead of an empty screen.
    page = pageCount;
    ({ rows, total } = await reader.listOrders({ profileId: a.profileId, statuses, offset: (page - 1) * pageSize, limit: pageSize }));
  }
  const toFulfillCount = await reader.countByStatuses({ profileId: a.profileId, statuses: ["paid"] });
  return { group, items: rows.map(toListItem), page, pageSize, pageCount, total, toFulfillCount };
}

export function toEarningView(e: EarningRecord): SellerEarningView {
  return {
    gross: num(e.gross_amount),
    commissionRatePct: Math.round(Number(e.commission_rate) * 10000) / 100,
    commission: num(e.platform_fee),
    net: num(e.net_amount),
    currency: e.currency,
    status: e.status,
    reversed: e.status === "reversed",
  };
}

export async function getSellerOrderDetail(reader: SellerReader, a: { profileId: string; orderId: string }): Promise<SellerOrderDetail | null> {
  const found = await reader.getOrder(a);
  // Ownership first: only an order the seller's own (RLS-scoped) read returned reaches the ledger read.
  if (!found || found.order.profile_id !== a.profileId) return null;
  const { order, items } = found;
  const [earning, pay, protection] = await Promise.all([
    reader.getEarningForOrder({ profileId: a.profileId, orderId: order.id }),
    reader.getPaymentSummary(order.id),
    reader.getProtectionSummaryForOrder ? reader.getProtectionSummaryForOrder({ profileId: a.profileId, orderId: order.id }) : Promise.resolve(null),
  ]);
  return {
    id: order.id,
    reference: formatProductOrderNumber(order.order_number),
    status: order.status,
    payment: paymentStateOf(order.status),
    fulfillment: fulfillmentStateOf(order.status),
    canFulfil: canFulfil(order.status),
    currency: order.currency,
    subtotal: num(order.subtotal),
    total: num(order.total),
    lines: items.map((i) => ({ name: i.name_snapshot, image: i.image_snapshot, quantity: i.quantity, unitPrice: num(i.unit_price_snapshot), lineTotal: num(i.line_total) })),
    customer: { name: order.customer_name, phone: order.customer_phone, email: order.customer_email ?? null, note: order.customer_note ?? null },
    paymentInfo: pay ? { method: pay.method, reference: pay.reference, confirmedAt: pay.confirmed_at } : null,
    earning: earning ? toEarningView(earning) : null,
    // No fulfilled_at column exists (by decision): a fulfilled order's last update IS its fulfillment,
    // because the only transition out of fulfilled is a refund, which changes the status too.
    timestamps: {
      createdAt: order.created_at,
      paidAt: order.paid_at,
      fulfilledAt: order.status === "fulfilled" ? order.updated_at ?? null : null,
      expiresAt: order.expires_at,
    },
    protection,
  };
}

// ---------------------------------------------------------------- earnings
export interface EarningsTotals {
  currency: string;
  count: number;
  gross: number;
  commission: number;
  net: number;
  reversedCount: number;
}

/** Sums the immutable records in whole cents. Reversed records are excluded from every total. */
export function summariseEarnings(rows: Pick<EarningRecord, "gross_amount" | "platform_fee" | "net_amount" | "status" | "currency">[], currency = "XAF"): EarningsTotals {
  let gross = 0;
  let fee = 0;
  let net = 0;
  let count = 0;
  let reversedCount = 0;
  for (const r of rows) {
    if (r.currency !== currency) continue;
    if (r.status === "reversed") {
      reversedCount++;
      continue;
    }
    gross += toCents(r.gross_amount) ?? 0;
    fee += toCents(r.platform_fee) ?? 0;
    net += toCents(r.net_amount) ?? 0;
    count++;
  }
  return { currency, count, gross: centsToAmount(gross), commission: centsToAmount(fee), net: centsToAmount(net), reversedCount };
}

export interface SellerEarningsPage {
  totals: EarningsTotals;
  items: (SellerEarningView & { id: string; orderId: string; reference: string; createdAt: string })[];
  page: number;
  pageSize: number;
  pageCount: number;
  total: number;
}

export async function getSellerEarnings(reader: SellerReader, a: { profileId: string; page: unknown; pageSize?: number }): Promise<SellerEarningsPage> {
  const pageSize = Math.max(1, Math.min(a.pageSize ?? SHOP_PAGE_SIZE, 100));
  const requested = parsePage(a.page);
  let { rows, total } = await reader.listEarnings({ profileId: a.profileId, offset: (requested - 1) * pageSize, limit: pageSize });
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  let page = requested;
  if (requested > pageCount) {
    page = pageCount;
    ({ rows, total } = await reader.listEarnings({ profileId: a.profileId, offset: (page - 1) * pageSize, limit: pageSize }));
  }
  const totals = summariseEarnings(await reader.listEarningAmounts(a.profileId));
  return {
    totals,
    items: rows.map((r) => ({ ...toEarningView(r), id: r.id, orderId: r.order_id, reference: r.order_number != null ? formatProductOrderNumber(r.order_number) : "", createdAt: r.created_at })),
    page,
    pageSize,
    pageCount,
    total,
  };
}
