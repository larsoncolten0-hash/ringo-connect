// Browser-side helpers for the Meta Pixel / TikTok Pixel integration —
// used only by ProfileView.tsx (the public profile page).

const VID_COOKIE = "ringo_vid";
const TTCLID_COOKIE = "ringo_ttclid";

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function writeCookie(name: string, value: string, days: number) {
  document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${days * 24 * 60 * 60}; Path=/; SameSite=Lax`;
}

export function newEventId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    // Non-HTTPS localhost, or a very old browser — crypto.randomUUID is
    // only exposed in secure contexts. A weaker id is fine here since
    // it's just an event-dedup key, not anything security-sensitive.
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

/** Persistent anonymous visitor id, sent to Meta/TikTok as external_id
 *  (always pre-hashed server-side before it leaves us) so a returning
 *  visitor matches to the same "person" across sessions. Stored as a
 *  plain cookie rather than localStorage specifically so the server
 *  (page-view CAPI call, /api/track) can read it too — it rides along
 *  automatically on same-origin requests. Never anything identifying,
 *  just a random id. */
export function ensureVisitorId(): string {
  const existing = readCookie(VID_COOKIE);
  if (existing) return existing;
  const id = newEventId();
  writeCookie(VID_COOKIE, id, 365);
  return id;
}

/** Captures TikTok's ad-click id from the landing URL into a cookie.
 *  Meta's own Pixel script does this automatically for `fbclid` (persists
 *  it as `_fbc`); TikTok's Pixel doesn't do the equivalent, so without
 *  this, /api/track's server-side event would lose `ttclid` the moment
 *  the visitor clicks further into the page and it's no longer the
 *  current URL's query string. */
export function captureTtclid(): void {
  const ttclid = new URLSearchParams(window.location.search).get("ttclid");
  if (ttclid) writeCookie(TTCLID_COOKIE, ttclid, 28);
}
