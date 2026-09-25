// Ringo Protection — Phase 3 refund types. Dependency-free, same discipline as types.ts.

export type ProtectionRefundStatus = "requested" | "processing" | "completed" | "failed";

export type ProtectionRefundNetwork = "mtn" | "orange";

export interface ProtectionRefundDestination {
  phone: string;
  network: ProtectionRefundNetwork;
}

// Mirrors FapshiTransaction's own status vocabulary (src/lib/fapshi.ts) exactly — this is not a
// new status set, it's the one the provider already returns, so reconciliation never has to
// translate between two different vocabularies.
export type ProviderPayoutStatus = "CREATED" | "SUCCESSFUL" | "FAILED" | "EXPIRED";
