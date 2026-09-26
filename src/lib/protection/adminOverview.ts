import { createAdminClient } from "@/lib/supabase/server";

// Ringo Protection — Phase 8: read-only admin operational overview. Reuses the EXISTING
// protection_transactions/protection_disputes/protection_refunds/platform_settings tables directly
// (service-role reads only, same posture as getAdminShopPayoutOverview()) — no new table, no new
// aggregation system. Every count/total here is informational; nothing here writes anything.

export type ProtectionTransactionStatus =
  | "awaiting_payment"
  | "protected"
  | "fulfillment_started"
  | "awaiting_confirmation"
  | "released"
  | "disputed"
  | "resolved_release"
  | "resolved_refund"
  | "refunded"
  | "cancelled"
  | "expired"
  | "payment_failed";

export const PROTECTION_STATUSES: ProtectionTransactionStatus[] = [
  "awaiting_payment",
  "protected",
  "fulfillment_started",
  "awaiting_confirmation",
  "disputed",
  "resolved_release",
  "resolved_refund",
  "released",
  "refunded",
  "payment_failed",
  "expired",
  "cancelled",
];

export type ProtectionAdminOverview = {
  protectionEnabled: boolean;
  refundProviderEnabled: boolean;
  autoReleaseHours: number;
  feeRate: number | null;
  /** Count of transactions per status — every status key is always present, 0 if none. */
  countsByStatus: Record<ProtectionTransactionStatus, number>;
  /** Sums by currency, split by what they represent — never blended into one "financial total". */
  totalsByCurrency: Record<
    string,
    {
      /** Sum of product_amount across every transaction that has ever existed (protected + beyond) — a volume figure, NOT a live liability. */
      protectedVolume: number;
      /** Sum of protection_fee_amount across the same set — Ringo's own collected/expected Protection fee revenue. */
      feesCollected: number;
      /** Sum of seller_protected_amount for transactions NOT YET released/refunded/terminal-failed — money still held, awaiting a legitimate release/refund path. */
      pendingSellerAmount: number;
      /** Sum of net_amount already released to sellers via commerce_sale_earnings (protection-origin rows only). */
      releasedToSellers: number;
    }
  >;
  disputesOpenCount: number;
  refundsRequestedCount: number;
};

function emptyCurrencyTotals() {
  return { protectedVolume: 0, feesCollected: 0, pendingSellerAmount: 0, releasedToSellers: 0 };
}

const PENDING_STATUSES = new Set<ProtectionTransactionStatus>(["protected", "fulfillment_started", "awaiting_confirmation", "disputed", "resolved_release", "resolved_refund"]);

export async function getProtectionAdminOverview(): Promise<ProtectionAdminOverview> {
  const admin = createAdminClient();

  const [{ data: settings }, { data: txns }, { data: earnings }, { count: disputesOpenCount }, { count: refundsRequestedCount }] = await Promise.all([
    admin.from("platform_settings").select("protection_enabled, protection_refund_provider_enabled, protection_auto_release_hours, protection_fee_rate").limit(1).single(),
    admin.from("protection_transactions").select("status, currency, product_amount, protection_fee_amount, seller_protected_amount").limit(20000),
    admin.from("commerce_sale_earnings").select("currency, net_amount").not("protection_transaction_id", "is", null).limit(20000),
    admin.from("protection_disputes").select("id", { count: "exact", head: true }).eq("status", "open"),
    admin.from("protection_refunds").select("id", { count: "exact", head: true }).eq("status", "requested"),
  ]);

  const countsByStatus = Object.fromEntries(PROTECTION_STATUSES.map((s) => [s, 0])) as Record<ProtectionTransactionStatus, number>;
  const totalsByCurrency: ProtectionAdminOverview["totalsByCurrency"] = {};

  for (const row of txns || []) {
    const status = row.status as ProtectionTransactionStatus;
    if (status in countsByStatus) countsByStatus[status]++;
    const currency = row.currency as string;
    totalsByCurrency[currency] ??= emptyCurrencyTotals();
    totalsByCurrency[currency].protectedVolume += Number(row.product_amount);
    totalsByCurrency[currency].feesCollected += Number(row.protection_fee_amount);
    if (PENDING_STATUSES.has(status)) totalsByCurrency[currency].pendingSellerAmount += Number(row.seller_protected_amount);
  }
  for (const row of earnings || []) {
    const currency = row.currency as string;
    totalsByCurrency[currency] ??= emptyCurrencyTotals();
    totalsByCurrency[currency].releasedToSellers += Number(row.net_amount);
  }

  return {
    protectionEnabled: settings?.protection_enabled === true,
    refundProviderEnabled: settings?.protection_refund_provider_enabled === true,
    autoReleaseHours: typeof settings?.protection_auto_release_hours === "number" ? settings.protection_auto_release_hours : 48,
    feeRate: settings?.protection_fee_rate != null ? Number(settings.protection_fee_rate) : null,
    countsByStatus,
    totalsByCurrency,
    disputesOpenCount: disputesOpenCount || 0,
    refundsRequestedCount: refundsRequestedCount || 0,
  };
}
