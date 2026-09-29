// Fapshi's own technical limits for a disbursement (external constraints, NOT
// Ringo business rules — the Ambassador/Team Leader minimum payout is the
// database setting, see settings.ts). One place, so the value isn't repeated.

/** Fapshi documents a minimum of 100 XAF per disbursement. */
export const fapshiMinDisbursementXaf = () => 100;

/** How Fapshi's answer to a payout request should be treated. Only
 *  'definitive' and 'not_sent' allow the payout to be retried; 'uncertain'
 *  (timeouts, 5xx, 429, 408, 409, unreadable/lost responses…) never does —
 *  the payout is held for reconciliation because the money may have moved. */
export type FapshiPayoutErrorKind = "definitive" | "not_sent" | "uncertain";

// HTTP statuses where Fapshi clearly refused the request as invalid or
// unauthorized, so nothing was disbursed: 400/422 validation, 401/403
// credentials or IP whitelist, 402 insufficient balance, 404 not found.
const DEFINITIVE_STATUSES = new Set([400, 401, 402, 403, 404, 422]);

export function classifyFapshiPayoutError(err: any): { kind: FapshiPayoutErrorKind; reason: string } {
  const status = err?.httpStatus;
  if (typeof status === "number") {
    if (DEFINITIVE_STATUSES.has(status)) return { kind: "definitive", reason: `HTTP ${status}` };
    // 408 / 409 (possible duplicate) / 429 / 5xx / anything else: the request
    // may have been executed.
    return { kind: "uncertain", reason: `HTTP ${status}` };
  }
  // fetch() failed (TypeError), the response could not be read (SyntaxError),
  // or the request was aborted/timed out AFTER it may have been sent.
  if (err instanceof TypeError || err instanceof SyntaxError || err?.name === "AbortError" || err?.name === "TimeoutError") {
    return { kind: "uncertain", reason: err?.name || "network" };
  }
  // Anything else was thrown before an HTTP request existed (Fapshi disabled,
  // credentials missing, unsafe config, invalid phone): nothing was sent.
  return { kind: "not_sent", reason: "not_sent" };
}
