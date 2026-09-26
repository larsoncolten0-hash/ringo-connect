// Ringo Protection — Phase 7 dispute types. Dependency-free, same discipline as types.ts/refundTypes.ts.

export type ProtectionDisputeStatus = "open" | "resolved_release" | "resolved_refund";

export interface ProtectionDisputeRow {
  id: string;
  protection_transaction_id: string;
  order_id: string;
  customer_id: string | null;
  profile_id: string;
  reason: string;
  message: string | null;
  status: ProtectionDisputeStatus;
  resolved_by: string | null;
  resolved_at: string | null;
  opened_at: string;
}
