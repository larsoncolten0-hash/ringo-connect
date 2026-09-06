// Client-side referral capture. When someone lands on the site with
// ?ref=CODE (an affiliate's link), we remember it in localStorage — not a
// cookie, since the two places that need to read it (the signup page and
// the get-started flow) are both client components that already run in
// the browser, and localStorage survives across the multiple pages of the
// get-started flow the same way a cookie would.
//
// First-touch attribution: once a code is stored, a later ?ref= on another
// page never overwrites it. Matches the DB trigger's own "first write
// wins" behavior on users.referred_by (see the affiliate migration).

const STORAGE_KEY = "rc_ref";
const MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000; // 60 days

type StoredReferral = { code: string; ts: number };

function readStored(): StoredReferral | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.code || typeof parsed.ts !== "number") return null;
    if (Date.now() - parsed.ts > MAX_AGE_MS) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed as StoredReferral;
  } catch {
    // localStorage can throw (private browsing, disabled storage) —
    // referral capture is best-effort and should never break the page.
    return null;
  }
}

/** Call once on mount, anywhere — reads ?ref= off the current URL and
 *  stores it if nothing valid is stored yet. See ReferralCapture.tsx. */
export function captureReferralFromUrl() {
  if (typeof window === "undefined") return;
  try {
    const ref = new URLSearchParams(window.location.search).get("ref");
    if (!ref) return;
    // 40 chars, not the shorter length you'd expect from a "code" —
    // set_affiliate_code()'s fallback path (when its usual short random
    // code generator fails) stamps the affiliate's full 32-char id as
    // their code instead, so this has to be long enough not to truncate
    // that and silently break attribution.
    const code = ref.trim().toUpperCase().slice(0, 40);
    if (!code || readStored()) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ code, ts: Date.now() } as StoredReferral));
  } catch {
    // best-effort — see readStored()
  }
}

/** The stored referral code, if any and not expired. Pass this as `ref` in
 *  supabase.auth.signUp()'s options.data, or as referral_code in a
 *  /api/signup-requests submission. */
export function getReferralCode(): string | null {
  return readStored()?.code ?? null;
}

export function clearReferralCode() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // best-effort
  }
}
