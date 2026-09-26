// Ringo Protection — Phase 4 checkout/payment tunables. Mirrors productCheckout/constants.ts's own
// values exactly (this is the same Fapshi collection service, same rate limits, same UX pacing) —
// kept as a separate file rather than imported so Protection's lane never shares a mutable module
// with Normal Payment's. Dependency-free.

export const PAYMENT_WINDOW_MINUTES = 15;
export const MAX_PAYMENT_ATTEMPTS = 5;
export const LATE_CONFIRMATION_LOOKBACK_HOURS = 24;

export const SUPPORTED_CURRENCY = "XAF";
export const PROVIDER = "fapshi" as const;

// Same verification posture as productCheckout's VERIFY_PROVIDER_AMOUNT.
export const VERIFY_PROVIDER_AMOUNT = true;

export const PAYMENT_STATUS_POLL_INTERVAL_MS = 12_000;
export const PAYMENT_STATUS_FIRST_POLL_MS = 3_000;
export const PROVIDER_STATUS_MIN_GAP_MS = 11_000;

export const RECONCILE_MAX_TRANSACTIONS_PER_RUN = 25;
export const RECONCILE_CONCURRENCY = 4;
export const RECONCILE_TIME_BUDGET_MS = 40_000;
