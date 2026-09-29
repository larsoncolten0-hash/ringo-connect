// Client-side Ambassador code capture. When someone lands on the site with
// ?amb=CODE (a Brand Ambassador's sales link), we remember it in
// localStorage — a wholly separate mechanism from the existing referral
// system (src/lib/referral.ts / referral_code / users.referred_by):
// different storage key, different URL param, never read by or written
// into anything the referral system owns, and never merged with it.
//
// First-touch attribution: once a code is stored, a later ?amb= on
// another page never overwrites it — same reasoning as referral.ts's own
// first-write-wins behavior.
//
// This capture is ONLY a browser-side convenience. The database
// (ambassador_attribute_sale(), called from /api/signup-requests) is the
// sole authority on whether a captured code is actually a real, active
// Ambassador, or a self-referral — nothing here validates any of that.

const STORAGE_KEY = "rc_amb";
const MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000; // 60 days — matches referral.ts's own window.

type StoredAmbassadorCode = { code: string; ts: number };

function readStored(): StoredAmbassadorCode | null {
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
    return parsed as StoredAmbassadorCode;
  } catch {
    // localStorage can throw (private browsing, disabled storage) —
    // capture is best-effort and should never break the page.
    return null;
  }
}

/** Call once on mount, anywhere — reads ?amb= off the current URL and
 *  stores it if nothing valid is stored yet. See AmbassadorCodeCapture.tsx. */
export function captureAmbassadorCodeFromUrl() {
  if (typeof window === "undefined") return;
  try {
    const amb = new URLSearchParams(window.location.search).get("amb");
    if (!amb) return;
    // Trim + cap length only — no format/validity rules here (whether a
    // code is real, active, or self-referring is entirely the
    // database's decision, not the browser's).
    const code = amb.trim().slice(0, 40);
    if (!code || readStored()) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ code, ts: Date.now() } as StoredAmbassadorCode));
  } catch {
    // best-effort — see readStored()
  }
}

/** The stored Ambassador code, if any and not expired. Pass this as
 *  ambassador_code in a /api/signup-requests submission. Never treat this
 *  as authoritative on its own — the server always re-validates via
 *  ambassador_attribute_sale(). */
export function getAmbassadorCode(): string | null {
  return readStored()?.code ?? null;
}

export function clearAmbassadorCode() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // best-effort
  }
}
