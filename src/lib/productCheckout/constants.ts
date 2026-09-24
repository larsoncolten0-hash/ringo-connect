// Product checkout (generic commerce lane) — tunable constants. Dependency-free.
// The database enforces the same quantity cap inside create_product_order() (c_max_quantity);
// keep MAX_QUANTITY in step with it. Changing either needs no schema change.

export const MAX_QUANTITY = 10;

// How long an unpaid order holds its stock (passed to create_product_order; the DB allows 5–120).
export const RESERVATION_MINUTES = 30;

// How long one payment attempt (the phone prompt) stays live before we treat it as expired locally.
// A provider confirmation that still arrives later is honoured (expired -> succeeded is allowed).
export const PAYMENT_WINDOW_MINUTES = 15;

// Per order, so payment prompts can't be fired repeatedly at someone else's phone.
export const MAX_PAYMENT_ATTEMPTS = 5;

// Late provider confirmations are only looked for on attempts younger than this.
export const LATE_CONFIRMATION_LOOKBACK_HOURS = 24;

// Only XAF, only Fapshi (V1). Also enforced inside create_product_order().
export const SUPPORTED_CURRENCY = "XAF";
export const PROVIDER = "fapshi" as const;
export const TARGET_TYPE = "product_order" as const;

// Compare the amount Fapshi reports with the amount we asked for, and send the order to
// payment_review on a mismatch. (Whether Fapshi's `amount` always equals the requested amount
// in every mode is unverified — flip this off if sandbox testing shows it reports differently.)
export const VERIFY_PROVIDER_AMOUNT = true;

// Fapshi allows at most 6 payment-status requests per minute PER TRANSACTION ID (429 above that).
// Two independent layers keep us under it:
//  - the browser polls no more often than PAYMENT_STATUS_POLL_INTERVAL_MS (12s -> 5/min), and
//  - the server never asks Fapshi about the same transaction more than once per
//    PROVIDER_STATUS_MIN_GAP_MS (11s -> at most 6 in any 60s window), however many tabs/clients poll.
// A skipped check simply answers from what we already know (still pending) — it never changes state.
export const PAYMENT_STATUS_POLL_INTERVAL_MS = 12_000;
export const PAYMENT_STATUS_FIRST_POLL_MS = 3_000;
export const PROVIDER_STATUS_MIN_GAP_MS = 11_000;
