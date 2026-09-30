// Browser-safe helpers for the get-started payment screen — no server imports, so the client
// component and the server route can share ONE definition of a valid number.

/** A Cameroon mobile number as Fapshi wants it: 9 digits starting with 6. Accepts spaces, dashes,
 *  "+237", "237" and "00237". Returns "" when it isn't one. */
export function normalizeSignupPhone(raw: string): string {
  let digits = (raw || "").replace(/[^0-9]/g, "");
  if (digits.startsWith("00237")) digits = digits.slice(5);
  else if (digits.startsWith("237") && digits.length > 9) digits = digits.slice(3);
  return /^6\d{8}$/.test(digits) ? digits : "";
}

export type SignupMedium = "mobile money" | "orange money";

/** Which network a number belongs to — ONLY where the prefix is unambiguous (MTN: 67x, 650–654;
 *  Orange: 69x, 655–659). Anything else returns null: we would rather say nothing than guess
 *  wrong and steer a customer away from a correct choice. Used to pre-select the provider and to
 *  warn on an obvious mismatch (a wrong provider is a common reason a payment request is refused). */
export function detectOperator(phone: string): SignupMedium | null {
  const n = normalizeSignupPhone(phone);
  if (!n) return null;
  if (/^67\d/.test(n) || /^65[0-4]/.test(n)) return "mobile money";
  if (/^69\d/.test(n) || /^65[5-9]/.test(n)) return "orange money";
  return null;
}

// Mobile money approval is done on the customer's phone and can take minutes. The screen keeps
// checking for a long time, calmly, and never calls a still-pending payment "failed".
export const POLL_SLOW_AFTER_MS = 120_000; // after this: reassuring "still waiting" state (not an error)
export const POLL_GIVE_UP_AFTER_MS = 15 * 60_000; // stop the on-screen countdown; the server keeps confirming

/** Gap before the next status check: quick at first, gentler later (fewer requests). */
export function pollDelayMs(elapsedMs: number): number {
  if (elapsedMs < 60_000) return 3000;
  if (elapsedMs < 180_000) return 4000;
  return 6000;
}

// ------------------------------------------------------------------------------------------
// Remember an in-flight payment across a reload. Phones often discard a backgrounded tab while
// the customer approves in another app; without this the page comes back as an empty form and the
// customer pays a second time. Only the request's id (an unguessable UUID) is stored — never a
// phone number or any personal data.
const STORAGE_KEY = "rc_signup_pay";
export const PENDING_PAYMENT_TTL_MS = 3 * 60 * 60_000;

export function savePendingPayment(requestId: string, now = Date.now()) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ requestId, ts: now }));
  } catch {
    // storage unavailable (private mode) — resuming simply won't be offered
  }
}

export function readPendingPayment(now = Date.now()): string | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.requestId !== "string" || typeof parsed?.ts !== "number") return null;
    if (now - parsed.ts > PENDING_PAYMENT_TTL_MS) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return /^[0-9a-f-]{36}$/i.test(parsed.requestId) ? parsed.requestId : null;
  } catch {
    return null;
  }
}

export function clearPendingPayment() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
